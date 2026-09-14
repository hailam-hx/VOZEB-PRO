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

    it("schedules a low-cost recovery wakeup for a running task", async () => {
        const response = await GET(new Request("http://localhost/api/text-tasks/text-one"), { params: Promise.resolve({ id: "text-one" }) });

        expect(response.status).toBe(200);
        expect(after).toHaveBeenCalledOnce();
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
