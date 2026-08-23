import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@/lib/auth/store", () => ({ refundUserPoints: mocks.refund }));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/text-task-store", () => ({
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
import { createProtocolFixtureServer } from "../../../scripts/protocol-fixture-server.mjs";
import { maintenanceWorkerContext } from "./maintenance-auth";
import { runTextTaskStep, taskHeaders } from "./text-task-runtime";
import type { TextTask, TextTaskConfig } from "./text-task-store";

describe("text task runtime recovery", () => {
    let state: TextTask;

    beforeEach(() => {
        vi.clearAllMocks();
        state = textTask(customConfig("channel-one", "https://one.example"));
        mocks.getTask.mockImplementation(async () => state);
        mocks.updateTask.mockImplementation(async (_id: string, patch: Partial<TextTask>) => {
            state = { ...state, ...patch };
            return state;
        });
        mocks.transitionTask.mockImplementation(async (_task: TextTask, allowed: string[], patch: Partial<TextTask>) => {
            if (!allowed.includes(state.status)) return null;
            state = { ...state, ...patch };
            return state;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
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
        const fixture = createProtocolFixtureServer();
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
            expect(fixture.requests[0]?.headers.authorization).toBe("Bearer key");
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
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
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "pending", status: "processing" });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(state.status).toBe("success");
        expect(state.result?.content).toBe("最终结果");
    });

    it("does not create through another channel after a network-uncertain submission", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        const fetchMock = vi.fn().mockRejectedValueOnce(new Error("socket closed"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "needs_review" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(state.config.channelId).toBe("channel-one");
        expect(state.candidateConfigs).toHaveLength(1);
        expect(state.attempts?.map(({ status }) => status)).toEqual(["running"]);
    });

    it("automatically switches to the next text model after a timeout", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(Object.assign(new Error("request timed out"), { name: "TimeoutError" }))
            .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "备用文本结果" } }] }));
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
            .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: "备用渠道结果" }] } }] }));
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
            .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "备用渠道成功" } }] }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(state.config.channelId).toBe("channel-two");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
    });

    it("fails a 200 business error without charging and permits failover", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "业务失败" } })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "备用成功" } }] })));

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });

        expect(mocks.finishUsage).toHaveBeenNthCalledWith(1, expect.any(Headers), expect.objectContaining({ status: "failed" }));
        expect(mocks.finishUsage).toHaveBeenLastCalledWith(expect.any(Headers), expect.objectContaining({ status: "succeeded" }));
        expect(mocks.releaseUsage).not.toHaveBeenCalled();
    });

    it("fails an empty 200 response without charging and permits failover", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "" } }] })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "备用成功" } }] })));

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
            .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "Chat 兼容返回" } }] }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toEqual({ state: "completed" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://one.example/v1/responses");
        expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://two.example/v1/chat/completions");
        expect(state.config.channelId).toBe("channel-two");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "succeeded"]);
        expect(state.result?.content).toBe("Chat 兼容返回");
    });

    it("marks a 2xx invalid JSON response for manual review", async () => {
        state = textTask(openAiConfig("channel-one", "https://one.example"), [openAiConfig("channel-two", "https://two.example")]);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })));

        await expect(runTextTaskStep(state, "http://internal", "")).resolves.toMatchObject({ state: "needs_review" });
        expect(state.config.channelId).toBe("channel-one");
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
