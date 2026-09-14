import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), getTextTask: vi.fn(), getSchedule: vi.fn(), recover: vi.fn(), records: [] as unknown[] }));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/text-task-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/text-task-store")>()), getTextTask: mocks.getTextTask }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.recover }));
vi.mock("@/lib/server/generation-task-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/generation-task-store")>()), getStoredGenerationTaskRecord: mocks.getSchedule }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: () => "file" }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: async () => structuredClone(mocks.records),
    writeJsonDataFile: async (_name: string, records: unknown[]) => {
        mocks.records = structuredClone(records);
    },
    withJsonDataFileLock: async (_name: string, callback: () => Promise<unknown>) => callback(),
}));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/points-response", () => ({ pointsResponseHeaders: vi.fn(() => new Headers()) }));
vi.mock("@/lib/server/generation-channel", () => ({ generationModelId: vi.fn(() => "text-model") }));

import { after } from "next/server";
import { GET, PATCH } from "./route";
import { createTextTask, openTextTaskAttempt, closeTextTaskAttempt } from "@/lib/server/text-task-store";
import { getStoredGenerationTask } from "@/lib/server/generation-task-store";
import { registerTextTaskAttempt } from "@/lib/server/text-task-stream-control";

describe("GET /api/text-tasks/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.records = [];
        mocks.currentUser.mockResolvedValue({ id: "user", role: "user" });
        mocks.getTextTask.mockResolvedValue({ id: "text-one", userId: "user", status: "running", config: { model: "text-model" } });
        mocks.getSchedule.mockResolvedValue({ executionPhase: "polling" });
    });

    it("rejects stale PATCH cancellation without changing the newer attempt or its execution metadata", async () => {
        const task = await createTextTask({ userId: "user", messages: [], config: { baseUrl: "https://fixture.example", apiKey: "fixture", apiFormat: "openai", model: "text-model" } });
        const first = (await openTextTaskAttempt(task, task.config, "chat", []))!;
        await closeTextTaskAttempt(task.id, first.activeAttemptId!, "failed");
        const latest = (await getStoredGenerationTask<typeof task>("text", task.id))!;
        const next = await openTextTaskAttempt(latest, task.config, "chat", []);
        mocks.getTextTask.mockResolvedValue(first);
        const before = structuredClone(mocks.records);

        const response = await PATCH(new Request(`http://localhost/api/text-tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }), {
            params: Promise.resolve({ id: task.id }),
        });

        expect(response.status).toBe(409);
        expect(after).not.toHaveBeenCalled();
        expect(mocks.records).toEqual(before);
        expect((await getStoredGenerationTask<typeof task>("text", task.id))?.activeAttemptId).toBe(next?.activeAttemptId);
    });

    it("aborts the current in-process attempt when cancellation is accepted", async () => {
        const task = await createTextTask({ userId: "user", messages: [], config: { baseUrl: "https://fixture.example", apiKey: "fixture", apiFormat: "openai", model: "text-model" } });
        const opened = (await openTextTaskAttempt(task, task.config, "chat", []))!;
        const active = registerTextTaskAttempt(task.id, opened.activeAttemptId!, {}, true);
        const stale = registerTextTaskAttempt(task.id, "previous", {}, true);
        mocks.getTextTask.mockResolvedValue(opened);
        const record = mocks.records[0] as Record<string, unknown>;
        record.workerId = "stream-worker";
        record.leaseUntil = Date.now() + 90_000;
        const leaseUntil = record.leaseUntil;
        try {
            const response = await PATCH(new Request(`http://localhost/api/text-tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }), {
                params: Promise.resolve({ id: task.id }),
            });
            expect(response.status).toBe(200);
            expect((await response.json()).task).toMatchObject({ status: "running", executionPhase: "cancel_requested" });
            expect(mocks.records[0]).toMatchObject({ workerId: "stream-worker", leaseUntil });
            expect(active.signal.aborted).toBe(true);
            expect(stale.signal.aborted).toBe(false);
        } finally {
            active.dispose();
            stale.dispose();
        }
    });

    it("rejects a cancellation explicitly addressed to a previous attempt", async () => {
        const task = await createTextTask({ userId: "user", messages: [], config: { baseUrl: "https://fixture.example", apiKey: "fixture", apiFormat: "openai", model: "text-model" } });
        const opened = (await openTextTaskAttempt(task, task.config, "chat", []))!;
        const active = registerTextTaskAttempt(task.id, opened.activeAttemptId!, {}, true);
        mocks.getTextTask.mockResolvedValue(opened);
        try {
            const response = await PATCH(new Request(`http://localhost/api/text-tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled", attemptId: "previous" }) }), {
                params: Promise.resolve({ id: task.id }),
            });
            expect(response.status).toBe(409);
            expect(active.signal.aborted).toBe(false);
            expect((await getStoredGenerationTask<typeof task>("text", task.id))?.status).toBe("pending");
        } finally {
            active.dispose();
        }
    });

    it("schedules a low-cost recovery wakeup for a running task", async () => {
        const response = await GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });

        expect(response.status).toBe(200);
        expect(after).toHaveBeenCalledOnce();
    });

    it.each(["success", "error", "cancelled"])("withholds %s from parent polling until durable terminal publication completes", async (status) => {
        mocks.getTextTask.mockResolvedValue({ id: "text-one", userId: "user", status, result: { content: "最终正文" }, error: "失败", config: { model: "text-model" } });
        mocks.getSchedule.mockResolvedValue({ executionPhase: status === "cancelled" ? "cancel_requested" : "submitting" });
        const read = () => GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });
        expect((await (await read()).json()).task).toMatchObject({ status: "running" });
        expect(after).toHaveBeenCalledOnce();
        mocks.getSchedule.mockResolvedValue({ executionPhase: "completed" });
        expect((await (await read()).json()).task.status).toBe(status);
    });

    it("does not wake a completed task", async () => {
        mocks.getTextTask.mockResolvedValue({ id: "text-one", userId: "user", status: "success", config: { model: "text-model" } });
        mocks.getSchedule.mockResolvedValue({ executionPhase: "completed" });

        await GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });

        expect(after).not.toHaveBeenCalled();
    });

    it("returns an uncertain submission as an ordinary terminal error", async () => {
        mocks.getTextTask.mockResolvedValue({ id: "text-one", userId: "user", status: "error", error: "文本提交结果无法确认", config: { model: "text-model" } });
        mocks.getSchedule.mockResolvedValue({ executionPhase: "completed" });

        const response = await GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });

        expect(after).not.toHaveBeenCalled();
        const payload = (await response.json()).task;
        expect(payload).toMatchObject({ status: "error", error: "文本提交结果无法确认", executionPhase: "completed" });
        expect(payload).not.toHaveProperty("needsReview");
        expect(payload).not.toHaveProperty("reviewReason");
    });
});
