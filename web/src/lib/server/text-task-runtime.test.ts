import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string | URL, init?: RequestInit) => fetch(url, init) }));

const mocks = vi.hoisted(() => ({
    getTask: vi.fn(),
    updateTask: vi.fn(),
    transitionTask: vi.fn(),
    schedule: vi.fn(),
    refund: vi.fn(),
    finishUsage: vi.fn(),
    releaseUsage: vi.fn(),
    attachUpstream: vi.fn(),
    mutateTask: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ refundUserPoints: mocks.refund }));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/generation-task-store", () => ({ mutateStoredGenerationTask: mocks.mutateTask }));
vi.mock("@/lib/server/text-task-store", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./text-task-store")>()),
    getTextTask: mocks.getTask,
    updateTextTask: mocks.updateTask,
    transitionTextTask: mocks.transitionTask,
}));
vi.mock("@/lib/server/usage-billing-runtime", () => ({
    attachSystemAiUsageUpstreamTask: mocks.attachUpstream,
    finishSystemAiTextAttempt: mocks.finishUsage,
    releaseUsageBillingForBusiness: mocks.releaseUsage,
}));

import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { maintenanceWorkerContext } from "./maintenance-auth";
import { markTextTaskFailed, runTextTaskStep, taskHeaders } from "./text-task-runtime";
import { cancelTextTaskAttempt } from "./text-task-stream-control";
import { acceptTextTaskSnapshot, closeTextTaskAttempt, openTextTaskAttempt, type TextTask, type TextTaskConfig } from "./text-task-store";

describe("text task runtime recovery", () => {
    let state: TextTask;

    beforeEach(() => {
        vi.clearAllMocks();
        state = textTask(customConfig("channel-one", "https://one.example"));
        mocks.getTask.mockImplementation(async () => state);
        mocks.mutateTask.mockImplementation(async (_type: string, _id: string, _ttl: number, mutate: (task: TextTask) => TextTask | null) => {
            const next = mutate(state);
            if (next) state = next;
            return next;
        });
        mocks.updateTask.mockImplementation(async (_id: string, patch: Partial<TextTask>) => {
            state = { ...state, ...patch };
            return state;
        });
        mocks.transitionTask.mockImplementation(async (task: TextTask, allowed: string[], patch: Partial<TextTask>) => {
            const revision = (value: TextTask) => value.attempts?.find((attempt) => attempt.id === value.activeAttemptId)?.revision;
            if (!allowed.includes(state.status) || state.activeAttemptId !== task.activeAttemptId || revision(state) !== revision(task)) return null;
            state = { ...state, ...patch };
            return state;
        });
    });

    it.each(["attempt", "revision"])("leaves a newer %s untouched when a delayed failure loses ownership", async (conflict) => {
        const original = (await openTextTaskAttempt(state, state.config, "custom", [state.config]))!;
        if (conflict === "attempt") {
            await closeTextTaskAttempt(state.id, state.activeAttemptId!, "failed");
            await openTextTaskAttempt(state, state.config, "custom", [state.config]);
        } else await acceptTextTaskSnapshot(state.id, state.activeAttemptId!, 0, { content: "newer snapshot" });
        state = { ...state, billing: { pointsCost: 3, pointsRecordId: "newer-charge", refunded: false } };
        const before = structuredClone(state);

        await markTextTaskFailed(original, "delayed old failure");

        expect(state).toEqual(before);
        expect(mocks.refund).not.toHaveBeenCalled();
        expect(mocks.releaseUsage).not.toHaveBeenCalled();
    });

    it("does not clean up or refund after losing terminal revision CAS", async () => {
        const original = (await openTextTaskAttempt(state, state.config, "custom", [state.config]))!;
        state = { ...state, billing: { pointsCost: 3, pointsRecordId: "charge", refunded: false } };
        mocks.transitionTask.mockImplementationOnce(async () => {
            await acceptTextTaskSnapshot(state.id, state.activeAttemptId!, 0, { content: "concurrent snapshot" });
            return null;
        });

        await markTextTaskFailed({ ...original, billing: state.billing }, "old failure");

        expect(state.status).toBe("pending");
        expect(state.attempts?.[0].status).toBe("running");
        expect(state.config.apiKey).toBe(original.config.apiKey);
        expect(state.candidateConfigs).toEqual([original.config]);
        expect(state.billing?.refunded).toBe(false);
        expect(mocks.refund).not.toHaveBeenCalled();
        expect(mocks.releaseUsage).not.toHaveBeenCalled();
    });

    it("does not close or fail a newer execution while old provider billing settles", async () => {
        state = textTask(openAiConfig("one", "https://one.example"), [openAiConfig("two", "https://two.example")]);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(chatFrame("partial") + 'data: {"error":{"message":"fixture failure"}}\n\n')));
        let newer!: TextTask;
        mocks.finishUsage.mockImplementationOnce(async () => {
            await closeTextTaskAttempt(state.id, state.activeAttemptId!, "failed");
            newer = (await openTextTaskAttempt(state, state.config, "chat", state.candidateConfigs || []))!;
        });

        await runTextTaskStep(state, "http://internal", "");

        expect(state).toEqual(newer);
        expect(mocks.releaseUsage).not.toHaveBeenCalled();
        expect(mocks.refund).not.toHaveBeenCalled();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.useRealTimers();
    });

    it("publishes persisted attempt start and terminal revisions independently of text snapshots", async () => {
        state = textTask(openAiConfig("one", "https://one.example"));
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(chatFrame("正文") + "data: [DONE]\n\n")));
        const lifecycle: TextTask[] = [];
        await runTextTaskStep(state, "http://internal", "", {
            onAttemptState: (task: TextTask) => {
                lifecycle.push(structuredClone(task));
            },
        });
        expect(lifecycle.map((task) => task.attempts!.at(-1)!.status)).toEqual(["running", "succeeded"]);
        expect(lifecycle[0].attempts![0]).toMatchObject({ revision: 0, content: "" });
        expect(lifecycle[1].attempts![0].revision).toBe(state.visibleTextSnapshot!.revision);
    });

    it("publishes incremental snapshots before EOF with stable execution identity", async () => {
        state = { ...textTask(openAiConfig("channel-one", "https://one.example")), executionContext: { runId: "run", parentTaskId: "parent" } };
        let output!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                output = controller;
                controller.enqueue(new TextEncoder().encode(chatFrame("第一段")));
            },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })));
        let snapshot!: (task: TextTask) => void;
        const first = new Promise<TextTask>((resolve) => {
            snapshot = resolve;
        });
        const execution = runTextTaskStep(state, "http://internal", "", { onSnapshot: snapshot });
        const partial = await Promise.race([first, execution.then(() => state)]);
        expect(partial.status).toBe("running");
        expect(partial.visibleTextSnapshot).toMatchObject({ content: "第一段", revision: 1, attemptId: partial.activeAttemptId });
        expect(partial.executionContext).toMatchObject({ runId: "run", parentTaskId: "parent", taskId: state.id, attemptId: partial.activeAttemptId });
        output.enqueue(new TextEncoder().encode(chatFrame("第二段") + 'data: {"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}\n\ndata: [DONE]\n\n'));
        output.close();
        await expect(execution).resolves.toEqual({ state: "completed" });
        expect(state.result).toEqual({ content: "第一段第二段" });
        expect(state.attempts?.[0]).toMatchObject({
            status: "succeeded",
            transport: "stream",
            usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
            milestones: { task_created: 1, first_text: expect.any(Number), first_byte: expect.any(Number), upstream_started: expect.any(Number), stream_completed: expect.any(Number), task_completed: expect.any(Number) },
        });
    });

    it("fails over before public text with a new attempt, but locks the provider after partial text", async () => {
        state = textTask(openAiConfig("one", "https://one.example"), [openAiConfig("two", "https://two.example")]);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(sse('data: {"error":{"message":"private detail"}}\n\n'))
            .mockResolvedValueOnce(sse(chatFrame("备用成功") + "data: [DONE]\n\n"));
        vi.stubGlobal("fetch", fetchMock);
        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(state.attempts?.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
        expect(new Set(state.attempts?.map((attempt) => attempt.id)).size).toBe(2);
        state = textTask(openAiConfig("one", "https://one.example"), [openAiConfig("two", "https://two.example")]);
        fetchMock.mockClear().mockResolvedValue(sse(chatFrame("保留部分") + 'data: {"error":{"message":"private detail"}}\n\n'));
        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "failed" });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(state.visibleTextSnapshot?.content).toBe("保留部分");
        expect(state.error).not.toContain("private detail");
    });

    it("cancels the upstream body, flushes partial text, and settles cancellation once", async () => {
        state = textTask(openAiConfig("one", "https://one.example"), [openAiConfig("two", "https://two.example")]);
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(chatFrame("取消前的部分")));
            },
            cancel() {
                cancelled = true;
            },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })));
        await expect(
            runTextTaskStep(state, "http://internal", "", {
                onSnapshot(task) {
                    cancelTextTaskAttempt(task.id, task.activeAttemptId!);
                },
            }),
        ).resolves.toMatchObject({ state: "failed" });
        expect(cancelled).toBe(true);
        expect(state.status).toBe("cancelled");
        expect(state.visibleTextSnapshot?.content).toBe("取消前的部分");
        expect(state.attempts?.[0].status).toBe("cancelled");
        expect(mocks.finishUsage.mock.calls.map(([, input]) => input.status)).toEqual(["canceled"]);
        expect(mocks.releaseUsage).not.toHaveBeenCalled();
    });

    it("keeps Custom buffered and emits exactly one final public snapshot", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { output: "自定义结果" } })));
        const snapshots: string[] = [];
        await expect(
            runTextTaskStep(state, "http://internal", "", {
                onSnapshot(task) {
                    snapshots.push(task.visibleTextSnapshot!.content);
                },
            }),
        ).resolves.toEqual({ state: "completed" });
        expect(snapshots).toEqual(["自定义结果"]);
        expect(state.attempts?.[0]).toMatchObject({ transport: "buffered", protocol: "custom", revision: 2, milestones: { first_text: expect.any(Number) }, latency: { generationMs: expect.any(Number), finalizationMs: expect.any(Number) } });
    });

    it("keeps trailing usage and first-byte evidence on failure", async () => {
        state = textTask(openAiConfig("one", "https://one.example"));
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(chatFrame("部分") + 'data: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\ndata: {"error":{"message":"fixture failure"}}\n\n')));
        await runTextTaskStep(state, "http://internal", "");
        expect(state.attempts?.[0]).toMatchObject({ content: "部分", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, milestones: { first_byte: expect.any(Number) } });
    });

    it.each([
        {
            protocol: "claude",
            path: "/messages",
            frames: 'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"部分"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
        },
        { protocol: "responses", path: "/responses", frames: 'data: {"type":"response.output_text.delta","delta":"部分"}\n\ndata: {"type":"response.incomplete","response":{"usage":{"input_tokens":7,"output_tokens":4}}}\n\n' },
    ])("retains $protocol cumulative usage and partial text when native generation fails", async ({ path, frames }) => {
        state = textTask({ ...openAiConfig("one", "https://one.example"), advancedConfig: { ...emptyAdvancedConfig(), createPath: path }, capabilityProfile: { maxOutputTokens: 128 } as TextTaskConfig["capabilityProfile"] });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(frames + 'data: {"error":{"message":"private fixture detail"}}\n\n')));

        await runTextTaskStep(state, "http://internal", "");

        expect(state.status).toBe("error");
        expect(state.visibleTextSnapshot?.content).toBe("部分");
        expect(state.attempts?.[0]).toMatchObject({ status: "failed", usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 } });
        expect(state.error).not.toContain("private fixture detail");
    });

    it("closes and settles a cancellation that wins the terminal persistence race", async () => {
        state = textTask(openAiConfig("one", "https://one.example"));
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(chatFrame("部分") + "data: [DONE]\n\n")));
        await runTextTaskStep(state, "http://internal", "", {
            onSnapshot() {
                state = { ...state, status: "cancelled" };
            },
        });
        expect(state.attempts?.[0].status).toBe("cancelled");
        expect(mocks.finishUsage.mock.calls.map(([, input]) => input.status)).toEqual(["canceled"]);
    });

    it("does not expose Custom upstream diagnostic bodies", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "secret fixture prompt and token" } }, { status: 422 })));
        await runTextTaskStep(state, "http://internal", "");
        expect(state.error).not.toContain("secret");
    });

    it("retains Custom failure usage evidence for the existing billing authority", async () => {
        const payload = { error: { message: "fixture business failure" }, usage: { prompt_tokens: 5, completion_tokens: 2 } };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
        await runTextTaskStep(state, "http://internal", "");
        expect(mocks.finishUsage).toHaveBeenCalledWith(expect.any(Headers), expect.objectContaining({ status: "failed", payload }));
    });

    it("persists first-byte and upstream-start evidence when configured first-text timeout fires", async () => {
        vi.useFakeTimers();
        state = textTask({ ...openAiConfig("one", "https://one.example"), capabilityProfile: { streamingTimeouts: { firstTextMs: 50 } } as TextTaskConfig["capabilityProfile"] });
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
            },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })));
        const execution = runTextTaskStep(state, "http://internal", "");
        await vi.advanceTimersByTimeAsync(50);
        expect(state.status).toBe("error");
        await execution;
        expect(state.attempts?.[0]).toMatchObject({ status: "failed", content: "", milestones: { first_byte: expect.any(Number), upstream_started: expect.any(Number) } });
        expect(state.visibleTextSnapshot).toBeUndefined();
        vi.useRealTimers();
    });

    it("stops upstream timers at EOF while a final snapshot is still flushing", async () => {
        vi.useFakeTimers();
        state = textTask({ ...openAiConfig("one", "https://one.example"), capabilityProfile: { streamingTimeouts: { idleMs: 50 } } as TextTaskConfig["capabilityProfile"] });
        const fetchMock = vi.fn().mockResolvedValue(sse(chatFrame("完成") + "data: [DONE]\n\n"));
        vi.stubGlobal("fetch", fetchMock);
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const execution = runTextTaskStep(state, "http://internal", "", { onSnapshot: () => blocked });
        await vi.advanceTimersByTimeAsync(100);
        const aborted = (fetchMock.mock.calls[0][1].signal as AbortSignal).aborted;
        release();
        await execution;
        expect(aborted).toBe(false);
        expect(state.status).toBe("success");
    });

    it("preserves maintenance authorization for the internal system proxy", () => {
        const token = "m".repeat(32);
        vi.stubEnv("VOZEB_PRO_MAINTENANCE_TOKEN", `${token}-maintenance`);
        vi.stubEnv("VOZEB_PRO_WORKER_TOKEN", token);

        const headers = taskHeaders({ ...openAiConfig("channel-one", "/api/ai/system/channel-one"), apiKey: "system" }, maintenanceWorkerContext("user-one"), "text-task:test:attempt:1");

        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(headers.get("x-vozeb-pro-worker-user-id")).toBe("user-one");
        expect(headers.get("x-vozeb-pro-logical-model")).toBe("text-model");
        expect(headers.get("x-vozeb-pro-points-idempotency-key")).toBe("text-task:test:attempt:1");
    });

    it("completes through a live OpenAI-compatible fixture", async () => {
        const requests: Array<{ path: string; method?: string; authorization?: string; body: string }> = [];
        const server = createServer(async (request, response) => {
            let body = "";
            for await (const chunk of request) body += chunk.toString();
            requests.push({ path: request.url!, method: request.method, authorization: request.headers.authorization, body });
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end(chatFrame("协议测试文本返回成功") + "data: [DONE]\n\n");
        });
        const fixture = { server, requests };
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = `http://127.0.0.1:${address.port}`;
        state = textTask(openAiConfig("fixture-text", `${origin}/v1`));

        try {
            await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
            expect(state).toMatchObject({ status: "success", result: { content: "协议测试文本返回成功" } });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0]).toMatchObject({ method: "POST", path: "/v1/chat/completions" });
            expect(fixture.requests[0]?.authorization).toBe("Bearer key");
            expect(JSON.parse(fixture.requests[0].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it.each([
        { kind: "responses", path: "/v1/responses", frames: 'data: {"type":"response.output_text.delta","delta":"原生结果"}\n\ndata: {"type":"response.completed"}\n\n' },
        { kind: "gemini", path: "/v1beta/models/text-model:streamGenerateContent?alt=sse", frames: 'data: {"candidates":[{"content":{"parts":[{"text":"原生结果"}]},"finishReason":"STOP"}]}\n\n' },
        { kind: "claude", path: "/v1/messages", frames: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"原生结果"}}\n\ndata: {"type":"message_stop"}\n\n' },
    ])("uses the native $kind path, body, and authentication over TCP", async ({ kind, path, frames }) => {
        const requests: Array<{ path: string; body: Record<string, unknown>; headers: import("node:http").IncomingHttpHeaders }> = [];
        const server = createServer(async (request, response) => {
            let body = "";
            for await (const chunk of request) body += chunk.toString();
            requests.push({ path: request.url!, body: JSON.parse(body), headers: request.headers });
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end(frames);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("fixture did not bind");
        const config = openAiConfig("fixture", `http://127.0.0.1:${address.port}`);
        if (kind === "responses") config.advancedConfig = { ...emptyAdvancedConfig(), createPath: "/responses" };
        if (kind === "gemini") config.apiFormat = "gemini";
        if (kind === "claude") {
            config.advancedConfig = { ...emptyAdvancedConfig(), createPath: "/messages" };
            config.capabilityProfile = { maxOutputTokens: 1024 } as TextTaskConfig["capabilityProfile"];
        }
        state = textTask(config);
        try {
            await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
            expect(state.result?.content).toBe("原生结果");
            expect(requests).toHaveLength(1);
            expect(requests[0].path).toBe(path);
            if (kind === "gemini") {
                expect(requests[0].body).toMatchObject({ contents: [{ role: "user", parts: [{ text: "test" }] }] });
                expect(requests[0].headers["x-goog-api-key"]).toBe("key");
            } else {
                expect(requests[0].body.stream).toBe(true);
                if (kind === "claude") {
                    expect(requests[0].headers["x-api-key"]).toBe("key");
                    expect(requests[0].headers["anthropic-version"]).toBe("2023-06-01");
                    expect(requests[0].body.max_tokens).toBe(1024);
                } else expect(requests[0].headers.authorization).toBe("Bearer key");
            }
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it("persists an asynchronous task ID and queries only one step per worker run", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ task_id: "upstream-one", status: "queued" }))
            .mockResolvedValueOnce(Response.json({ status: "processing" }))
            .mockResolvedValueOnce(Response.json({ status: "completed", data: { output: "最终结果" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "pending", upstreamTaskId: "upstream-one" });
        expect(state.upstream).toEqual({ id: "upstream-one", createPath: "/jobs" });
        expect(state.attempts?.[0]).toMatchObject({ upstreamModel: "text-model", milestones: { upstream_started: expect.any(Number), first_byte: expect.any(Number) } });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "pending", status: "processing" });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(state.status).toBe("success");
        expect(state.result?.content).toBe("最终结果");
        expect(state.attempts?.[0]).toMatchObject({ milestones: { first_text: expect.any(Number) }, latency: { generationMs: 0, finalizationMs: expect.any(Number) } });
    });

    it("aborts a Custom polling read through the active attempt registry", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ task_id: "upstream", status: "queued" })));
        await runTextTaskStep(state, "http://internal", "");
        let release!: ReadableStreamDefaultController<Uint8Array>;
        let started!: () => void;
        const queried = new Promise<void>((resolve) => {
            started = resolve;
        });
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                release = controller;
            },
        });
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(async () => {
                started();
                return new Response(body);
            }),
        );
        const execution = runTextTaskStep(state, "http://internal", "");
        await queried;
        try {
            expect(cancelTextTaskAttempt(state.id, state.activeAttemptId!)).toBe(true);
        } finally {
            release.close();
        }
        await execution;
        expect(state.status).toBe("cancelled");
        expect(state.upstream?.id).toBe("upstream");
    });

    it("retains a confirmed Custom upstream ID when cancellation arrives before its snapshot flush", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ task_id: "confirmed", status: "queued" })));
        mocks.attachUpstream.mockImplementationOnce(() => {
            cancelTextTaskAttempt(state.id, state.activeAttemptId!);
        });
        await runTextTaskStep(state, "http://internal", "");
        expect(state.status).toBe("cancelled");
        expect(state.upstream?.id).toBe("confirmed");
    });

    it("does not create through another channel after a network-uncertain submission", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        const fetchMock = vi.fn().mockRejectedValueOnce(new Error("socket closed"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "failed" });
        expect(state.error).not.toContain("socket closed");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(state.config.channelId).toBe("channel-one");
        expect(state.candidateConfigs).toHaveLength(0);
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed"]);
        expect(state.status).toBe("error");
    });

    it("automatically switches to the next text model after a timeout", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error("request timed out"), { name: "TimeoutError" }))
            .mockResolvedValueOnce(sse(chatFrame("备用文本结果") + "data: [DONE]\n\n"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://one.example/v1/chat/completions");
        expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://two.example/v1/chat/completions");
        expect(state.config.channelId).toBe("channel-two");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
    });

    it("switches channels after a deterministic 422 rejection", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [{ ...openAiConfig("channel-two", "https://two.example"), apiFormat: "gemini" }]);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ error: { message: "参数不受支持" } }, { status: 422 }))
            .mockResolvedValueOnce(sse('data: {"candidates":[{"content":{"parts":[{"text":"备用渠道结果"}]},"finishReason":"STOP"}]}\n\n'));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(state.config.channelId).toBe("channel-two");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
        expect(state.result?.content).toBe("备用渠道结果");
    });

    it("switches channels after an explicit synchronous 5xx response", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ error: { message: "渠道暂不可用" } }, { status: 503 }))
            .mockResolvedValueOnce(sse(chatFrame("备用渠道成功") + "data: [DONE]\n\n"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(state.config.channelId).toBe("channel-two");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
    });

    it("fails a 200 business error without charging and permits failover", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(sse('data: {"error":{"message":"业务失败"}}\n\n'))
                .mockResolvedValueOnce(sse(chatFrame("备用成功") + "data: [DONE]\n\n")),
        );

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });

        expect(mocks.finishUsage).toHaveBeenNthCalledWith(1, expect.any(Headers), expect.objectContaining({ status: "failed" }));
        expect(mocks.finishUsage).toHaveBeenLastCalledWith(expect.any(Headers), expect.objectContaining({ status: "succeeded" }));
        expect(mocks.releaseUsage).not.toHaveBeenCalled();
    });

    it("fails an empty 200 response without charging and permits failover", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(sse("data: [DONE]\n\n"))
                .mockResolvedValueOnce(sse(chatFrame("备用成功") + "data: [DONE]\n\n")),
        );

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });

        expect(mocks.finishUsage.mock.calls.map(([, input]) => input.status)).toEqual(["failed", "succeeded"]);
    });

    it("settles validated success only after the terminal task state is persisted", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "成功" } }] })));

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });

        expect(mocks.transitionTask.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.finishUsage.mock.invocationCallOrder.at(-1)!);
        expect(mocks.finishUsage).toHaveBeenCalledOnce();
        expect(mocks.finishUsage).toHaveBeenCalledWith(expect.any(Headers), expect.objectContaining({ status: "succeeded" }));
    });

    it("switches models instead of trying another protocol on the same model", async () => {
        state = textTask(responsesConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ error: { message: "/backend-api/conversation failed: status=422, body=" } }, { status: 422 }))
            .mockResolvedValueOnce(sse(chatFrame("Chat 兼容返回") + "data: [DONE]\n\n"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://one.example/v1/responses");
        expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://two.example/v1/chat/completions");
        expect(state.config.channelId).toBe("channel-two");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
        expect(state.result?.content).toBe("Chat 兼容返回");
    });

    it("fails a Custom 2xx invalid JSON response without trying another channel", async () => {
        state = textTask(customConfig("channel-one", "https://one.example"), [customConfig("channel-two", "https://two.example")]);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })));

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "failed" });
        expect(state.config.channelId).toBe("channel-one");
        expect(state.status).toBe("error");
    });

    it("refunds a zero-point recorded charge when the upstream task fails", async () => {
        const headers = { "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "record-zero" };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ task_id: "upstream-zero", status: "queued" }, { headers }))
            .mockResolvedValueOnce(Response.json({ status: "failed", error: { message: "upstream failed" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "pending" });
        expect(state.billing).toMatchObject({ pointsCost: 0, pointsRecordId: "record-zero", refunded: false });
        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "failed" });

        expect(mocks.refund).toHaveBeenCalledWith("user-one", "text-model", 0, "text", 1, undefined, "record-zero");
    });
});

function chatFrame(text: string) {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}
function sse(body: string) {
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function textTask(config: TextTaskConfig, candidateConfigs: TextTaskConfig[] = []): TextTask {
    return {
        id: "text-one",
        userId: "user-one",
        status: "pending",
        createdAt: 1,
        updatedAt: 1,
        config,
        candidateConfigs,
        messages: [{ role: "user", content: "test" }],
    };
}

function customConfig(channelId: string, baseUrl: string): TextTaskConfig {
    return {
        baseUrl,
        apiKey: "key",
        apiFormat: "openai",
        model: "text-model",
        channelId,
        advancedConfig: {
            ...emptyAdvancedConfig(),
            protocol: "custom",
            createPath: "/jobs",
            queryPath: "/jobs/{taskId}",
            requestTemplate: '{"prompt":"{{prompt}}"}',
            resultField: "data.output",
            statusField: "status",
        },
    };
}

function openAiConfig(channelId: string, baseUrl: string): TextTaskConfig {
    return { baseUrl, apiKey: "key", apiFormat: "openai", model: "text-model", channelId };
}

function responsesConfig(channelId: string, baseUrl: string): TextTaskConfig {
    return {
        ...openAiConfig(channelId, baseUrl),
        advancedConfig: {
            ...emptyAdvancedConfig(),
            protocol: "compatible",
            createPath: "/responses",
        },
    };
}
