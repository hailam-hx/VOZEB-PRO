import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ files: new Map<string, unknown>() }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: () => "file" }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: async (name: string, fallback: unknown) => structuredClone(data.files.get(name) ?? fallback),
    writeJsonDataFile: async (name: string, value: unknown) => {
        data.files.set(name, structuredClone(value));
    },
    withJsonDataFileLock: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));

import * as agent from "./agent-run-store";
import * as text from "./text-task-store";
import { listCreativeRunEvents } from "./creative-runtime-store";
import { publicAgentRunSnapshot, publicAgentRunEvent } from "./agent-run-public";

describe("durable Agent text snapshots", () => {
    beforeEach(() => data.files.clear());

    async function fixture() {
        const { run } = await agent.createAgentRun("user", { clientRequestId: "request", surface: "chat", prompt: "写文案", assetIds: [], skillIds: [], modelIds: [] });
        await agent.updateAgentRunById(run.id, { status: "running", tasks: [{ id: "parent", type: "text", title: "文案", prompt: "internal-secret", status: "running", count: 1, attempts: 1, dependencies: [] }] });
        const task = await text.createTextTask({ userId: "user", messages: [], config: { baseUrl: "https://fixture.example", apiKey: "secret", model: "internal-model", apiFormat: "openai" }, executionContext: { runId: run.id, parentTaskId: "parent" } });
        return { run, task };
    }

    it("atomically saves accumulated text and a safe replay event; ignores duplicate and stale snapshots", async () => {
        const { run, task } = await fixture();
        const opened = (await text.openTextTaskAttempt(task, task.config, "chat", []))!;
        await agent.mirrorAgentTextTaskSnapshot(opened);
        const first = (await text.acceptTextTaskSnapshot(task.id, opened.activeAttemptId!, 0, { content: "第一段" }))!;
        await agent.mirrorAgentTextTaskSnapshot(first);
        await agent.mirrorAgentTextTaskSnapshot(first);
        const second = (await text.acceptTextTaskSnapshot(task.id, opened.activeAttemptId!, 1, { content: "第一段\n第二段" }))!;
        await agent.mirrorAgentTextTaskSnapshot(second);
        await agent.mirrorAgentTextTaskSnapshot(first);
        const saved = (await agent.getAgentRun(run.id))!;
        expect(publicAgentRunSnapshot(saved).tasks[0]).toMatchObject({ activeAttemptId: opened.activeAttemptId, textRevision: 2, visibleTextSnapshot: { attemptId: opened.activeAttemptId, revision: 2, content: "第一段\n第二段", status: "streaming" } });
        const events = (await listCreativeRunEvents(run.id)).filter((event) => event.type === "task.text.updated");
        expect(events.map((event) => event.data)).toEqual([
            { runId: run.id, taskId: task.id, parentTaskId: "parent", attemptId: opened.activeAttemptId, revision: 1, content: "第一段", status: "streaming" },
            { runId: run.id, taskId: task.id, parentTaskId: "parent", attemptId: opened.activeAttemptId, revision: 2, content: "第一段\n第二段", status: "streaming" },
        ]);
        expect((await listCreativeRunEvents(run.id, events[0].id)).filter((event) => event.type === "task.text.updated")).toEqual([events[1]]);
        expect(publicAgentRunEvent({ ...events[1], data: { ...(events[1].data as object), provider: "secret", prompt: "secret" } }).data).toEqual(events[1].data);
    });

    it("keeps failed visible content through empty retries and replaces it on the first new text", async () => {
        const { run, task } = await fixture();
        const opened = (await text.openTextTaskAttempt(task, task.config, "chat", []))!;
        const partial = (await text.acceptTextTaskSnapshot(task.id, opened.activeAttemptId!, 0, { content: "旧的部分" }))!;
        await agent.mirrorAgentTextTaskSnapshot(partial);
        const closed = (await text.closeTextTaskAttempt(task.id, opened.activeAttemptId!, "failed"))!;
        expect(closed.attempts![0].revision).toBe(2);
        await agent.mirrorAgentTextTaskSnapshot(closed);
        const next = (await text.openTextTaskAttempt(closed, task.config, "chat", []))!;
        await agent.mirrorAgentTextTaskSnapshot(next);
        expect((await agent.getAgentRun(run.id))!.tasks[0]).toMatchObject({ activeAttemptId: next.activeAttemptId, textRevision: 0, visibleTextSnapshot: { attemptId: opened.activeAttemptId, content: "旧的部分", status: "failed", revision: 2 } });
        const emptyFailure = (await text.closeTextTaskAttempt(task.id, next.activeAttemptId!, "failed"))!;
        await agent.mirrorAgentTextTaskSnapshot(emptyFailure);
        expect((await agent.getAgentRun(run.id))!.tasks[0].visibleTextSnapshot?.content).toBe("旧的部分");
        const third = (await text.openTextTaskAttempt(emptyFailure, task.config, "chat", []))!;
        await agent.mirrorAgentTextTaskSnapshot(third);
        await agent.mirrorAgentTextTaskSnapshot(partial);
        const replacement = (await text.acceptTextTaskSnapshot(task.id, third.activeAttemptId!, 0, { content: "新的" }))!;
        await agent.mirrorAgentTextTaskSnapshot(replacement);
        expect((await agent.getAgentRun(run.id))!.tasks[0].visibleTextSnapshot).toMatchObject({ attemptId: third.activeAttemptId, content: "新的", status: "streaming" });
    });

    it("authorizes server execution context and retries the same durable child with all prior attempts", async () => {
        const { run, task } = await fixture();
        await agent.updateAgentRunById(run.id, { executionId: "private-executor" });
        expect(await agent.resolveAgentTextTaskContext("user", { runId: run.id, parentTaskId: "parent", executionId: "wrong" })).toBeNull();
        expect(await agent.resolveAgentTextTaskContext("other-user", { runId: run.id, parentTaskId: "parent", executionId: "private-executor" })).toBeNull();
        expect(await agent.resolveAgentTextTaskContext("user", { runId: run.id, parentTaskId: "parent", executionId: "private-executor", taskId: "spoofed", attemptId: "spoofed" })).toEqual({ runId: run.id, parentTaskId: "parent" });
        const first = (await text.openTextTaskAttempt(task, task.config, "chat", []))!;
        await text.acceptTextTaskSnapshot(task.id, first.activeAttemptId!, 0, { content: "部分" });
        const closed = (await text.closeTextTaskAttempt(task.id, first.activeAttemptId!, "failed"))!;
        const failed = (await text.transitionTextTask(closed, ["pending"], { status: "error", messages: [], error: "断流" }))!;
        const retried = await text.retryTextTask(failed, { config: task.config, candidateConfigs: [], messages: [{ role: "user", content: "新的执行内容" }] });
        expect(retried).toMatchObject({ id: task.id, status: "pending", visibleTextSnapshot: { content: "部分" }, attempts: [{ id: first.activeAttemptId, status: "failed" }], messages: [{ content: "新的执行内容" }] });
        expect(await text.retryTextTask(failed, { config: task.config, candidateConfigs: [], messages: [] })).toBeNull();
        const next = (await text.openTextTaskAttempt(retried!, task.config, "chat", []))!;
        expect(next.attempts).toHaveLength(2);
        expect(next.activeAttemptId).not.toBe(first.activeAttemptId);
    });
});
