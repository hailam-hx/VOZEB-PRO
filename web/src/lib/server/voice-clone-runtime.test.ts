import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getTask: vi.fn(),
    updateTask: vi.fn(),
    transitionTask: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    finalizeDelete: vi.fn(),
    schedule: vi.fn(),
    sign: vi.fn(),
    attach: vi.fn(),
    finalize: vi.fn(),
    fetch: vi.fn(),
    cleanup: vi.fn(),
}));

vi.mock("@/lib/server/voice-profile-store", async (importOriginal) => ({
    ...(await importOriginal()),
    getVoiceCloneTask: mocks.getTask,
    updateVoiceCloneTask: mocks.updateTask,
    transitionVoiceCloneTask: mocks.transitionTask,
    getVoiceProfile: mocks.getProfile,
    updateVoiceProfile: mocks.updateProfile,
    finalizeVoiceDeleteTask: mocks.finalizeDelete,
}));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/reference-asset-access", () => ({ createSignedReferenceAssetUrl: mocks.sign }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.fetch }));
vi.mock("@/lib/server/maintenance-auth", () => ({ maintenanceWorkerHeaders: () => ({ "x-worker": "signed" }) }));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ attachSystemAiUsageUpstreamTask: mocks.attach, finalizeUsageBillingForBusiness: mocks.finalize }));
vi.mock("@/lib/server/local-media-storage", () => ({ deleteUserLocalMediaAssets: mocks.cleanup }));

import { createVoiceCloneUpstreamStep, markVoiceCloneFailed, queryVoiceCloneUpstreamStep, sanitizeProviderTrace } from "./voice-clone-runtime";
import type { VoiceCloneTask, VoiceProfile } from "./voice-profile-store";

describe("voice clone runtime", () => {
    let task: VoiceCloneTask;
    let profile: VoiceProfile;

    beforeEach(() => {
        vi.clearAllMocks();
        task = voiceTask();
        profile = voiceProfile();
        mocks.getTask.mockImplementation(async () => task);
        mocks.getProfile.mockImplementation(async () => profile);
        mocks.updateTask.mockImplementation(async (_id: string, patch: Partial<VoiceCloneTask>) => (task = { ...task, ...patch }));
        mocks.transitionTask.mockImplementation(async (_task: VoiceCloneTask, allowed: string[], patch: Partial<VoiceCloneTask>) => {
            if (!allowed.includes(task.status)) return null;
            return (task = { ...task, ...patch });
        });
        mocks.updateProfile.mockImplementation(async (_id: string, patch: Partial<VoiceProfile>) => (profile = { ...profile, ...patch }));
        mocks.finalizeDelete.mockImplementation(async (_current: VoiceCloneTask, outcome: { status: "success" | "error"; attempts: VoiceCloneTask["attempts"]; error?: string; providerTrace?: string }) => {
            task = { ...task, status: outcome.status, attempts: outcome.attempts, error: outcome.error || "" };
            profile = {
                ...profile,
                status: outcome.status === "success" ? "deleted" : task.deletePreviousStatus || "ready",
                error: outcome.error || "",
                ...(outcome.status === "success" ? { upstreamStatus: "deleted", providerTrace: outcome.providerTrace, deletedAt: new Date().toISOString() } : {}),
            };
            return { task, profile };
        });
        mocks.sign.mockReturnValue("https://vozeb.example/api/reference-assets/source.wav?signed=1");
        mocks.finalize.mockResolvedValue(undefined);
        mocks.cleanup.mockResolvedValue({ deleted: 1, blocked: [] });
    });

    it("removes URLs and credential-shaped values from stored gateway traces", () => {
        expect(sanitizeProviderTrace("trace-123 https://private.example/path api_key=secret-value\nnext")).toBe("trace-123 [redacted-url] api_key=[redacted] next");
    });

    it("submits the configured Dflop template with a stable idempotency key and pins the ready profile", async () => {
        mocks.fetch.mockResolvedValue(Response.json({ data: { voice_id: "provider-secret-voice" }, status: "completed" }, { headers: { "x-gateway-trace": "trace-secret", "x-vozeb-pro-points-cost": "3.5", "x-vozeb-pro-points-record-id": "hold-one" } }));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toEqual({ state: "completed", status: "completed" });

        const request = mocks.fetch.mock.calls[0] as [string, RequestInit];
        expect(request[0]).toBe("http://internal/api/ai/system/dflop/voice/clone");
        expect(JSON.parse(String(request[1].body))).toEqual({ name: "我的声音", audio_url: "https://vozeb.example/api/reference-assets/source.wav?signed=1", async: true });
        expect(new Headers(request[1].headers).get("idempotency-key")).toBe("voice-clone-task:task-one:attempt:1");
        expect(mocks.sign).toHaveBeenCalledWith("permanent/source.wav", "https://vozeb.example", task.createdAt, 180_000);
        expect(profile).toMatchObject({ status: "ready", channelId: "dflop", providerVoiceId: "provider-secret-voice", providerTrace: "trace-secret" });
        expect(task.attempts?.[0]).toMatchObject({ status: "succeeded", providerTrace: "trace-secret" });
        expect(mocks.finalize).toHaveBeenCalledWith({ userId: "user-one", businessId: "voice-clone-task:task-one" });
    });

    it("persists an upstream task then resolves its provider voice id by querying the configured path", async () => {
        mocks.fetch.mockResolvedValueOnce(Response.json({ task_id: "upstream-one", status: "queued" }, { headers: { "x-gateway-trace": "trace-one" } }));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toMatchObject({ state: "pending", upstreamTaskId: "upstream-one" });
        expect(task.upstream).toEqual({ id: "upstream-one", createPath: "/voice/clone" });

        mocks.fetch.mockResolvedValueOnce(Response.json({ result: { voice_id: "provider-voice" }, status: "success" }, { headers: { "x-gateway-trace": "trace-two" } }));
        await expect(queryVoiceCloneUpstreamStep(task, "http://internal", "user-one")).resolves.toEqual({ state: "completed", status: "success" });
        expect(mocks.fetch.mock.calls[1]?.[0]).toBe("http://internal/api/ai/system/dflop/voice/tasks/upstream-one");
        expect(profile).toMatchObject({ status: "ready", providerVoiceId: "provider-voice", channelId: "dflop", providerTrace: "trace-two" });
    });

    it("treats the canonical Dflop id as pending until the same voice resource becomes ready", async () => {
        task = { ...task, config: { ...task.config, createPath: "/audio/voices", queryPath: "/audio/voices/:task_id", resultField: "id" } };
        mocks.fetch.mockResolvedValueOnce(Response.json({ id: "dflop-voice-one", status: "pending" }));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toEqual({ state: "pending", status: "pending", upstreamTaskId: "dflop-voice-one" });
        expect(task.upstream).toEqual({ id: "dflop-voice-one", createPath: "/audio/voices" });
        expect(profile).toMatchObject({ status: "pending", channelId: "dflop", providerVoiceId: "dflop-voice-one", upstreamStatus: "pending" });

        mocks.fetch.mockResolvedValueOnce(Response.json({ id: "dflop-voice-one", status: "ready" }));
        await expect(queryVoiceCloneUpstreamStep(task, "http://internal", "user-one")).resolves.toEqual({ state: "completed", status: "ready" });
        expect(profile).toMatchObject({ status: "ready", channelId: "dflop", providerVoiceId: "dflop-voice-one", upstreamStatus: "ready" });
    });

    it("deletes only the pinned provider voice then tombstones the profile and cleans unreferenced media", async () => {
        task = { ...task, operation: "delete", providerVoiceId: "provider-voice", deletePreviousStatus: "ready" };
        profile = { ...profile, status: "deleting", channelId: "dflop", providerVoiceId: "provider-voice", previewStorageKey: "permanent/preview.wav" };
        mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toEqual({ state: "completed", status: "deleted" });

        expect(mocks.fetch.mock.calls[0]?.[0]).toBe("http://internal/api/ai/system/dflop/voice/provider-voice");
        expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
        expect(profile).toMatchObject({ status: "deleted", deletedAt: expect.any(String) });
        expect(mocks.cleanup).toHaveBeenCalledWith("user-one", ["permanent/source.wav", "permanent/preview.wav"]);
    });

    it("keeps an upstream-confirmed tombstone when deferred media cleanup fails", async () => {
        task = { ...task, operation: "delete", providerVoiceId: "provider-voice", deletePreviousStatus: "ready" };
        profile = { ...profile, status: "deleting", channelId: "dflop", providerVoiceId: "provider-voice" };
        mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
        mocks.cleanup.mockRejectedValueOnce(new Error("storage unavailable"));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toEqual({ state: "completed", status: "deleted" });
        expect(profile).toMatchObject({ status: "deleted" });
    });

    it("repairs a terminal profile journal without sending another provider delete", async () => {
        task = {
            ...task,
            operation: "delete",
            providerVoiceId: "provider-voice",
            deletePreviousStatus: "ready",
            attemptNo: 1,
            attempts: [{ attemptNo: 1, channelId: "dflop", model: "voice-clone", capability: "audio", status: "running", startedAt: 1 }],
        };
        profile = { ...profile, status: "deleted", channelId: "dflop", providerVoiceId: "provider-voice", upstreamStatus: "deleted", deletedAt: "2026-09-03T01:00:00.000Z" };

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toEqual({ state: "completed", status: "deleted" });

        expect(mocks.finalizeDelete).toHaveBeenCalledWith(expect.objectContaining({ operation: "delete" }), { status: "success", attempts: task.attempts, providerTrace: undefined });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("treats an upstream 404 during delete as an idempotent confirmed deletion", async () => {
        task = { ...task, operation: "delete", providerVoiceId: "provider-voice", deletePreviousStatus: "ready" };
        profile = { ...profile, status: "deleting", channelId: "dflop", providerVoiceId: "provider-voice" };
        mocks.fetch.mockResolvedValue(Response.json({ error: "not found" }, { status: 404, headers: { "x-vozeb-pro-upstream-response": "1" } }));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toEqual({ state: "completed", status: "deleted" });
        expect(profile).toMatchObject({ status: "deleted", deletedAt: expect.any(String) });
    });

    it("does not tombstone a profile when a local proxy policy returns 404 before reaching Dflop", async () => {
        task = { ...task, operation: "delete", providerVoiceId: "provider-voice", deletePreviousStatus: "ready" };
        profile = { ...profile, status: "deleting", channelId: "dflop", providerVoiceId: "provider-voice" };
        mocks.fetch.mockResolvedValue(Response.json({ error: "channel unavailable" }, { status: 404 }));

        await expect(createVoiceCloneUpstreamStep(task, "http://internal", "https://vozeb.example", "user-one")).resolves.toMatchObject({ state: "failed", status: "delete_failed" });
        expect(profile).toMatchObject({ status: "ready" });
        expect(mocks.cleanup).not.toHaveBeenCalled();
    });

    it("redacts infrastructure details before persisting a public failure", async () => {
        task = { ...task, attempts: [{ attemptNo: 1, channelId: "dflop", model: "voice-clone-pro", capability: "audio", status: "running", startedAt: 1 }] };
        await markVoiceCloneFailed(task, "provider rejected https://private.example/audio?token=secret api_key=also-secret");

        expect(profile).toMatchObject({ status: "failed", error: "生成渠道暂时无法连接，请稍后重试或联系管理员。" });
        expect(task).toMatchObject({ status: "error", error: "生成渠道暂时无法连接，请稍后重试或联系管理员。" });
        expect(task.attempts?.[0]?.error).toBe("生成渠道暂时无法连接，请稍后重试或联系管理员。");
    });
});

function voiceTask(): VoiceCloneTask {
    return {
        id: "task-one",
        userId: "user-one",
        voiceProfileId: "profile-one",
        operation: "clone",
        status: "pending",
        createdAt: 1,
        updatedAt: 1,
        config: {
            channelId: "dflop",
            logicalModel: "clone",
            upstreamModel: "voice-clone-pro",
            baseUrl: "/api/ai/system/dflop",
            createPath: "/voice/clone",
            queryPath: "/voice/tasks/:task_id",
            deletePath: "/voice/:voice_id",
            requestTemplate: '{"name":"{{name}}","audio_url":"{{audio_url}}","async":true}',
            resultField: "data.voice_id / result.voice_id",
            statusField: "status",
            timeoutMs: 180_000,
            capabilityProfile: { supportsIdempotency: true, timeoutMs: 180_000 },
            usagePricing: { logicalModelId: "clone", bindingId: "clone-binding" },
        },
    };
}

function voiceProfile(): VoiceProfile {
    return {
        id: "profile-one",
        userId: "user-one",
        name: "我的声音",
        status: "pending",
        sourceStorageKey: "permanent/source.wav",
        sourceMimeType: "audio/wav",
        sourceDurationSeconds: 8,
        provider: "dflop",
        consentVersion: "voice-cloning-v1",
        consentedAt: "2026-09-03T00:00:00.000Z",
        clientRequestId: "request-one",
        cloneTaskId: "task-one",
        createdAt: "2026-09-03T00:00:00.000Z",
        updatedAt: "2026-09-03T00:00:00.000Z",
    };
}
