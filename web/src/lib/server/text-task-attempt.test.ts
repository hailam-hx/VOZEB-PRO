import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ records: [] as unknown[] }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: () => "file" }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: async () => structuredClone(data.records),
    writeJsonDataFile: async (_name: string, records: unknown[]) => {
        data.records = structuredClone(records);
    },
    withJsonDataFileLock: async (_name: string, callback: () => Promise<unknown>) => callback(),
}));

import * as store from "./text-task-store";

describe("text attempt persistence", () => {
    beforeEach(() => {
        data.records = [];
    });

    const create = () => store.createTextTask({ userId: "user", messages: [], config: { baseUrl: "https://fixture.example", apiKey: "fixture", apiFormat: "openai", model: "model" }, executionContext: { runId: "run", parentTaskId: "parent" } });

    it("creates a stable task execution identity and task_created milestone", async () => {
        const task = await create();
        expect(task.executionContext).toEqual({ runId: "run", parentTaskId: "parent", taskId: task.id });
        expect(task.milestones).toEqual({ task_created: task.createdAt });
    });

    it("rejects stale revisions and closed attempts without replacing a prior visible partial on retry", async () => {
        const task = await create();
        const opened = await store.openTextTaskAttempt(task, task.config, "chat", []);
        const firstId = opened!.activeAttemptId!;
        const accepted = await store.acceptTextTaskSnapshot(task.id, firstId, 0, { content: "旧的部分" });
        expect(accepted?.visibleTextSnapshot).toMatchObject({ attemptId: firstId, revision: 1, content: "旧的部分" });
        expect(await store.acceptTextTaskSnapshot(task.id, firstId, 0, { content: "过期回调" })).toBeNull();
        await store.closeTextTaskAttempt(task.id, firstId, "failed", { error: "中断" });
        const closed = (await store.getTextTask(task.id))!.attempts![0];
        const retried = await store.openTextTaskAttempt((await store.getTextTask(task.id))!, task.config, "chat", []);
        expect(retried!.activeAttemptId).not.toBe(firstId);
        expect(retried!.executionContext).toMatchObject({ taskId: task.id, runId: "run", parentTaskId: "parent", attemptId: retried!.activeAttemptId });
        expect(retried!.visibleTextSnapshot?.attemptId).toBe(firstId);
        expect(await store.acceptTextTaskSnapshot(task.id, firstId, 1, { content: "晚到" })).toBeNull();
        expect(await store.closeTextTaskAttempt(task.id, firstId, "succeeded")).toBeNull();
        await store.acceptTextTaskSnapshot(task.id, retried!.activeAttemptId!, 0, { content: "" });
        expect((await store.getTextTask(task.id))!.visibleTextSnapshot?.attemptId).toBe(firstId);
        const replacement = await store.acceptTextTaskSnapshot(task.id, retried!.activeAttemptId!, 1, { content: "新的部分" });
        expect(replacement!.visibleTextSnapshot).toMatchObject({ attemptId: retried!.activeAttemptId, revision: 2, content: "新的部分" });
        expect(replacement!.attempts![0]).toEqual(closed);
    });

    it("serializes simultaneous snapshot CAS mutations", async () => {
        const task = await create();
        const opened = await store.openTextTaskAttempt(task, task.config, "responses", []);
        const results = await Promise.all(["一", "二"].map((content) => store.acceptTextTaskSnapshot(task.id, opened!.activeAttemptId!, 0, { content })));
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await store.getTextTask(task.id))!.visibleTextSnapshot?.revision).toBe(1);
    });

    it("does not close an attempt from a stale revision", async () => {
        const task = await create();
        const opened = await store.openTextTaskAttempt(task, task.config, "chat", []);
        await store.acceptTextTaskSnapshot(task.id, opened!.activeAttemptId!, 0, { content: "新快照" });
        expect(await store.closeTextTaskAttempt(task.id, opened!.activeAttemptId!, "failed", {}, 0)).toBeNull();
    });

    it("rejects a terminal transition from an earlier attempt and records task completion only at terminal state", async () => {
        const task = await create();
        const first = await store.openTextTaskAttempt(task, task.config, "chat", []);
        await store.closeTextTaskAttempt(task.id, first!.activeAttemptId!, "failed");
        const next = await store.openTextTaskAttempt((await store.getTextTask(task.id))!, task.config, "chat", []);
        expect(await store.transitionTextTask(first!, ["pending"], { status: "success", result: { content: "迟到结果" } })).toBeNull();
        const completed = await store.transitionTextTask(next!, ["pending"], { status: "success" });
        expect(completed!.milestones?.task_completed).toEqual(expect.any(Number));
    });
});
