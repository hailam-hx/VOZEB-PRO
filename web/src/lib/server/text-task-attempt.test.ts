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
import { getStoredGenerationTaskRecord } from "./generation-task-store";
import { scheduleGenerationTask } from "./generation-task-scheduler";

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

    it("clears failed payload and scheduler state atomically on explicit retry while retaining the attempt audit", async () => {
        const task = await create();
        const opened = (await store.openTextTaskAttempt(task, task.config, "custom", []))!;
        const closed = (await store.closeTextTaskAttempt(task.id, opened.activeAttemptId!, "failed", { error: "old error", pointsCost: 1, pointsRecordId: "old charge" }))!;
        const failed = (await store.transitionTextTask(closed, ["pending"], {
            status: "error",
            result: { content: "old result" },
            error: "old error",
            upstream: { id: "old upstream", createPath: "/jobs" },
            billing: { pointsCost: 1, pointsRecordId: "old charge", refunded: true },
        }))!;
        await scheduleGenerationTask("text", task.id, {
            executionPhase: "completed",
            upstreamTaskId: "old upstream",
            submittedAt: 100,
            lastPollAt: 200,
            resultPayload: { text: "old result" },
            queryPath: "/jobs/old",
            channelId: "old channel",
            provider: "old provider",
        });

        await store.retryTextTask(failed, { config: task.config, messages: [], candidateConfigs: [] });
        const retried = (await store.getTextTask(task.id))!;
        expect(retried).toMatchObject({ id: task.id, status: "pending", attempts: closed.attempts });
        for (const key of ["result", "error", "upstream", "billing"]) expect(retried).not.toHaveProperty(key);
        const record = (await getStoredGenerationTaskRecord("text", task.id))!;
        expect(record.executionPhase).toBe("created");
        for (const key of ["upstreamTaskId", "submittedAt", "lastPollAt", "resultPayload", "queryPath", "channelId", "provider"]) expect(record[key as keyof typeof record]).toBeUndefined();
        expect(await store.transitionTextTask(failed, ["pending"], { status: "error", error: "late previous cycle" })).toBeNull();
    });

    it("rejects an attempt opened from an earlier explicit retry cycle", async () => {
        const task = await create();
        const failed = (await store.transitionTextTask(task, ["pending"], { status: "error" }))!;
        await store.retryTextTask(failed, { config: task.config, messages: [] });
        expect(await store.openTextTaskAttempt(failed, task.config, "custom", [])).toBeNull();
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

    it("derives generation and finalization latency only from available milestones", async () => {
        const task = await create();
        const opened = (await store.openTextTaskAttempt(task, task.config, "chat", []))!;
        await store.acceptTextTaskSnapshot(task.id, opened.activeAttemptId!, 0, { content: "complete", milestones: { first_text: 200, stream_completed: 550 } });
        const closed = (await store.closeTextTaskAttempt(task.id, opened.activeAttemptId!, "succeeded"))!;
        expect(closed.attempts![0].latency).toMatchObject({ generationMs: 350, finalizationMs: closed.attempts![0].milestones.task_completed! - 550 });
        const next = (await store.openTextTaskAttempt(closed, task.config, "chat", []))!;
        const failed = (await store.closeTextTaskAttempt(task.id, next.activeAttemptId!, "failed"))!;
        expect(failed.attempts![1].latency).not.toHaveProperty("generationMs");
        expect(failed.attempts![1].latency).not.toHaveProperty("finalizationMs");
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

    it("guards cancellation and execution metadata atomically against stale attempts and revisions", async () => {
        const task = await create();
        const first = await store.openTextTaskAttempt(task, task.config, "chat", []);
        await store.closeTextTaskAttempt(task.id, first!.activeAttemptId!, "failed");
        const next = await store.openTextTaskAttempt((await store.getTextTask(task.id))!, task.config, "chat", []);
        const executionPatch = { executionPhase: "cancel_requested" as const, lastUpstreamStatus: "cancel_requested" };
        expect(await store.transitionTextTask(first!, ["pending"], { status: "cancelled" }, executionPatch)).toBeNull();
        const accepted = await store.acceptTextTaskSnapshot(task.id, next!.activeAttemptId!, 0, { content: "new" });
        expect(await store.transitionTextTask(next!, ["pending"], { status: "cancelled" }, executionPatch)).toBeNull();
        expect((await getStoredGenerationTaskRecord("text", task.id))!.executionPhase).toBe("created");
        expect(await store.transitionTextTask(accepted!, ["pending"], { status: "cancelled" }, executionPatch)).not.toBeNull();
        expect(await getStoredGenerationTaskRecord("text", task.id)).toMatchObject({ status: "cancelled", executionPhase: "cancel_requested", lastUpstreamStatus: "cancel_requested" });
    });
});
