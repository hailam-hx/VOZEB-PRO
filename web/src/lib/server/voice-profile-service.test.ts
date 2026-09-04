import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    settings: vi.fn(),
    inspect: vi.fn(),
    createBundle: vi.fn(),
    schedule: vi.fn(),
    cleanup: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    getCloneTask: vi.fn(),
    createDeleteTask: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/server/voice-profile-source", () => ({ inspectVoiceProfileSource: mocks.inspect }));
vi.mock("@/lib/server/voice-profile-store", async (importOriginal) => ({
    ...(await importOriginal()),
    createVoiceProfileBundle: mocks.createBundle,
    getVoiceProfileForUser: mocks.getProfile,
    updateVoiceProfile: mocks.updateProfile,
    getVoiceCloneTask: mocks.getCloneTask,
    createVoiceDeleteTask: mocks.createDeleteTask,
}));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/local-media-storage", () => ({ deleteUserLocalMediaAssets: mocks.cleanup }));

import { VoiceProfileIdempotencyConflictError } from "./voice-profile-store";
import { createVoiceProfile, deleteVoiceProfile, renameVoiceProfile } from "./voice-profile-service";

describe("voice profile service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cleanup.mockResolvedValue({ deleted: 1, blocked: [] });
        mocks.inspect.mockResolvedValue({ storageKey: "permanent/source.wav", mimeType: "audio/wav", durationSeconds: 8 });
        mocks.createBundle.mockResolvedValue({
            profile: { id: "profile-one", name: "我的声音", status: "pending", sourceMimeType: "audio/wav", sourceDurationSeconds: 8, createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" },
            task: { id: "task-one", config: { channelId: "dflop" } },
        });
        mocks.settings.mockResolvedValue(settings());
        mocks.updateProfile.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
            ...mocks.getProfile.mock.results.at(-1)?.value,
            id: "profile-one",
            name: "我的声音",
            status: "ready",
            sourceMimeType: "audio/wav",
            sourceDurationSeconds: 8,
            createdAt: "2026-09-03T00:00:00.000Z",
            updatedAt: "2026-09-03T00:00:00.000Z",
            ...patch,
        }));
    });

    it("requires explicit consent and a configured voice-clone binding", async () => {
        await expect(createVoiceProfile("user-one", { name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: false })).rejects.toMatchObject({ status: 400 });

        mocks.settings.mockResolvedValue({ ...settings(), defaultModels: { ...settings().defaultModels, voiceCloneModel: "" } });
        await expect(createVoiceProfile("user-one", { name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true })).rejects.toThrow("尚未配置");

        const unsafe = settings();
        unsafe.logicalModels[0].bindings[0].capabilityProfile.supportsIdempotency = false;
        mocks.settings.mockResolvedValue(unsafe);
        await expect(createVoiceProfile("user-one", { name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true })).rejects.toThrow("尚未配置可用");
    });

    it("validates source media, persists atomically and schedules the clone task", async () => {
        const result = await createVoiceProfile("user-one", { name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true });

        expect(mocks.inspect).toHaveBeenCalledWith("user-one", "permanent/source.wav");
        expect(mocks.createBundle).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: "user-one",
                clientRequestId: "request-one",
                taskConfig: {
                    candidates: [expect.objectContaining({ channelId: "dflop", logicalModel: "clone", upstreamModel: "voice-clone-pro", createPath: "/voice/clone", queryPath: "/voice/tasks/:task_id", deletePath: "/voice/:voice_id" })],
                },
            }),
        );
        expect(mocks.schedule).toHaveBeenCalledWith("voice-clone", "task-one", expect.objectContaining({ channelId: "dflop" }));
        expect(result).toMatchObject({ id: "profile-one", status: "pending" });
    });

    it("cleans an unreferenced source when atomic creation fails", async () => {
        mocks.createBundle.mockRejectedValueOnce(new Error("write failed"));
        await expect(createVoiceProfile("user-one", { name: "我的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true })).rejects.toThrow("write failed");
        expect(mocks.cleanup).toHaveBeenCalledWith("user-one", ["permanent/source.wav"]);
    });

    it("maps a reused client request id with different inputs to a public conflict", async () => {
        mocks.createBundle.mockRejectedValueOnce(new VoiceProfileIdempotencyConflictError("conflict"));

        await expect(createVoiceProfile("user-one", { name: "新的声音", sourceAssetToken: "permanent/source.wav", clientRequestId: "request-one", consentConfirmed: true })).rejects.toMatchObject({ status: 409 });
        expect(mocks.cleanup).toHaveBeenCalledWith("user-one", ["permanent/source.wav"]);
    });

    it("renames only an owned non-deleted profile", async () => {
        mocks.getProfile.mockResolvedValue({ id: "profile-one", userId: "user-one", name: "Old", status: "ready" });
        mocks.updateProfile.mockResolvedValue({ id: "profile-one", name: "New", status: "ready", sourceMimeType: "audio/wav", sourceDurationSeconds: 8, createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" });

        await expect(renameVoiceProfile("user-one", "profile-one", "New")).resolves.toMatchObject({ name: "New" });
        expect(mocks.updateProfile).toHaveBeenCalledWith("profile-one", { name: "New" });
    });

    it("tombstones a local failed profile but schedules pinned provider deletion", async () => {
        mocks.getProfile.mockResolvedValueOnce({ id: "failed", userId: "user-one", status: "failed", sourceStorageKey: "permanent/failed.wav", previewStorageKey: "permanent/preview.wav" });
        mocks.updateProfile.mockResolvedValue({ id: "failed", name: "Failed", status: "deleted", sourceMimeType: "audio/wav", sourceDurationSeconds: 8, createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" });
        await expect(deleteVoiceProfile("user-one", "failed")).resolves.toMatchObject({ status: "deleted" });
        expect(mocks.cleanup).toHaveBeenCalledWith("user-one", ["permanent/failed.wav", "permanent/preview.wav"]);

        const ready = { id: "ready", userId: "user-one", status: "ready", channelId: "dflop", providerVoiceId: "secret", cloneTaskId: "clone-task", sourceStorageKey: "permanent/ready.wav" };
        mocks.getProfile.mockResolvedValueOnce(ready);
        mocks.getCloneTask.mockResolvedValue({ config: { channelId: "dflop", deletePath: "/voice/:voice_id" } });
        mocks.createDeleteTask.mockResolvedValue({
            profile: { ...ready, name: "Ready", status: "deleting", sourceMimeType: "audio/wav", sourceDurationSeconds: 8, createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" },
            task: { id: "delete-task", config: { channelId: "dflop" } },
        });

        await expect(deleteVoiceProfile("user-one", "ready")).resolves.toMatchObject({ status: "deleting" });
        expect(mocks.schedule).toHaveBeenLastCalledWith("voice-clone", "delete-task", expect.objectContaining({ channelId: "dflop" }));
    });

    it("keeps a completed local tombstone when deferred media cleanup fails", async () => {
        mocks.getProfile.mockResolvedValue({ id: "failed", userId: "user-one", status: "failed", sourceStorageKey: "permanent/failed.wav" });
        mocks.updateProfile.mockResolvedValue({ id: "failed", name: "Failed", status: "deleted", sourceMimeType: "audio/wav", sourceDurationSeconds: 8, createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" });
        mocks.cleanup.mockRejectedValueOnce(new Error("storage unavailable"));

        await expect(deleteVoiceProfile("user-one", "failed")).resolves.toMatchObject({ status: "deleted" });
    });
});

function settings() {
    return {
        defaultModels: { textModel: "", imageModel: "", videoModel: "", audioModel: "speech", voiceCloneModel: "clone" },
        logicalModels: [
            {
                id: "clone",
                name: "声音克隆",
                capability: "audio",
                enabled: true,
                bindings: [
                    {
                        id: "clone-binding",
                        channelId: "dflop",
                        upstreamModel: "voice-clone-pro",
                        enabled: true,
                        priority: 1,
                        capabilityProfile: { supportsIdempotency: true },
                        generationParameters: { audioOperation: "voice-clone" },
                    },
                ],
            },
        ],
        systemChannels: [
            {
                id: "dflop",
                name: "Dflop",
                baseUrl: "https://api.dflop.example",
                apiKey: "secret",
                apiFormat: "openai",
                models: ["voice-clone-pro"],
                enabled: true,
                advancedConfig: {
                    protocol: "custom",
                    textModel: "",
                    imageModel: "",
                    videoModel: "",
                    createPath: "/voice/clone",
                    queryPath: "/voice/tasks/:task_id",
                    deletePath: "/voice/:voice_id",
                    catalogPath: "/voices",
                    requestTemplate: '{"name":"{{name}}","audio_url":"{{audio_url}}","async":true}',
                    resultField: "voice_id",
                    statusField: "status",
                    durationRange: "",
                    referenceRule: "",
                    supportsReferenceImage: false,
                    supportsReferenceVideo: false,
                    supportsReferenceAudio: true,
                },
            },
        ],
    };
}
