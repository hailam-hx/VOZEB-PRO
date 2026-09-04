import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    getTask: vi.fn(),
    getActiveTask: vi.fn(),
    recover: vi.fn(),
    settings: vi.fn(),
    checkRate: vi.fn(),
    concurrency: vi.fn(),
    getByRequest: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal()), after: (callback: () => unknown) => callback() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/server/security", () => ({ checkGenerationRateLimit: mocks.checkRate, rateLimitHeaders: () => ({ "Retry-After": "60" }) }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: mocks.concurrency }));
vi.mock("@/lib/server/voice-profile-service", () => ({
    createVoiceProfile: mocks.create,
    VoiceProfileServiceError: class VoiceProfileServiceError extends Error {
        constructor(
            message: string,
            readonly status = 400,
        ) {
            super(message);
        }
    },
}));
vi.mock("@/lib/server/voice-profile-store", () => ({
    listVoiceProfilesForUser: mocks.list,
    getVoiceProfileForUser: mocks.get,
    getVoiceCloneTask: mocks.getTask,
    getActiveVoiceCloneTaskForProfile: mocks.getActiveTask,
    getVoiceProfileByClientRequestId: mocks.getByRequest,
    publicVoiceProfile: (profile: unknown) => profile,
}));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.recover }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: () => "http://internal" }));

import { GET, POST } from "./route";

describe("voice profiles route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one" });
        mocks.create.mockResolvedValue({ id: "profile-one", name: "我的声音", status: "pending" });
        mocks.get.mockResolvedValue({ id: "profile-one", cloneTaskId: "task-one" });
        mocks.getTask.mockResolvedValue(null);
        mocks.getActiveTask.mockResolvedValue(null);
        mocks.getByRequest.mockResolvedValue(null);
        mocks.settings.mockResolvedValue({ generationConcurrency: { audio: 2 } });
        mocks.checkRate.mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 });
        mocks.concurrency.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.list.mockResolvedValue({ items: [{ id: "profile-one", name: "我的声音", status: "ready" }], total: 1, page: 1, pageSize: 20 });
    });

    it("creates an authorized profile and starts its persisted task", async () => {
        const response = await POST(
            new Request("https://vozeb.example/api/voice-profiles", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true }),
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ code: 0, data: { profile: { id: "profile-one", name: "我的声音", status: "pending" } }, msg: "声音克隆任务已创建" });
        expect(mocks.recover).toHaveBeenCalledWith(expect.objectContaining({ origin: "http://internal", publicOrigin: "https://vozeb.example", taskIds: ["task-one"] }));
        expect(mocks.concurrency).toHaveBeenCalledWith("user-one", "voice-clone", 10 * 60 * 1_000, 2, expect.any(Function), undefined);
    });

    it("returns an owner-scoped paginated list in the common response envelope", async () => {
        const response = await GET(new Request("https://vozeb.example/api/voice-profiles?page=1&pageSize=20&status=ready"));

        expect(mocks.list).toHaveBeenCalledWith("user-one", { page: 1, pageSize: 20, status: "ready" });
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { total: 1, items: [{ id: "profile-one" }] }, msg: "" });
    });

    it("derives pending deletion refresh timing from the active delete task", async () => {
        mocks.list.mockResolvedValue({ items: [{ id: "profile-one", name: "我的声音", status: "deleting", cloneTaskId: "clone-task" }], total: 1, page: 1, pageSize: 20 });
        mocks.getActiveTask.mockResolvedValue({ id: "delete-task", nextPollAt: Date.now() + 2_000 });

        const response = await GET(new Request("https://vozeb.example/api/voice-profiles"));

        expect(mocks.getActiveTask).toHaveBeenCalledWith("user-one", "profile-one", "delete");
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    });

    it("does not expose infrastructure details from an unexpected create failure", async () => {
        mocks.create.mockRejectedValue(new Error("fetch https://provider.example failed with api_key=secret"));

        const response = await POST(
            new Request("https://vozeb.example/api/voice-profiles", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true }),
            }),
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({ code: 500, msg: "生成渠道暂时无法连接，请稍后重试或联系管理员。" });
    });

    it("rate-limits clone creation before entering the concurrency guard", async () => {
        mocks.checkRate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

        const response = await POST(
            new Request("https://vozeb.example/api/voice-profiles", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true }),
            }),
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(mocks.concurrency).not.toHaveBeenCalled();
    });

    it("excludes the matching idempotent clone task from the concurrency count", async () => {
        mocks.getByRequest.mockResolvedValue({ cloneTaskId: "existing-task" });

        await POST(
            new Request("https://vozeb.example/api/voice-profiles", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true }),
            }),
        );

        expect(mocks.concurrency).toHaveBeenCalledWith("user-one", "voice-clone", 10 * 60 * 1_000, 2, expect.any(Function), "existing-task");
    });
});
