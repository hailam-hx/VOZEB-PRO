import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import type { StoredGenerationTaskRecord } from "@/lib/server/generation-task-types";

vi.mock("@/lib/auth/store-repository", async (importOriginal) => ({
    ...(await importOriginal()),
    withFileAuthDatabaseLock: (callback: (database: { users: Array<{ id: string }> }) => unknown) => callback({ users: [{ id: "user-one" }, { id: "user-two" }] }),
}));

import {
    createVoiceDeleteTask,
    createVoiceProfileBundle,
    deleteFileVoiceProfilesWithUserAccount,
    finalizeVoiceDeleteTask,
    getActiveVoiceCloneTaskForProfile,
    getVoiceCloneTask,
    hasProviderVoiceProfilesForUser,
    getVoiceProfileForUser,
    listVoiceProfilesForUser,
    publicVoiceProfile,
    updateVoiceCloneTask,
    updateVoiceProfile,
    userOwnsVoiceProfileProviderVoice,
} from "./voice-profile-store";

const originalDataDir = process.env.VOZEB_PRO_DATA_DIR;
const originalDatabaseProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;

describe("file voice profile store", () => {
    let dataDir = "";

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "vozeb-voice-profile-"));
        vi.stubEnv("VOZEB_PRO_DATA_DIR", dataDir);
        vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", "file");
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
        else process.env.VOZEB_PRO_DATA_DIR = originalDataDir;
        if (originalDatabaseProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
        else process.env.VOZEB_PRO_DATABASE_PROVIDER = originalDatabaseProvider;
    });

    it("creates one profile and clone task for repeated client requests", async () => {
        const first = await createVoiceProfileBundle(input("request-one", "Original"));
        const repeated = await createVoiceProfileBundle(input("request-one", "Original"));

        expect(repeated.profile).toEqual(first.profile);
        expect(repeated.task).toEqual(first.task);
        expect(await getVoiceProfileForUser("user-one", first.profile.id)).toEqual(first.profile);
    });

    it("rejects reuse of a client request id with different clone inputs", async () => {
        await createVoiceProfileBundle(input("request-one", "Original"));

        await expect(createVoiceProfileBundle(input("request-one", "Changed"))).rejects.toMatchObject({ name: "VoiceProfileIdempotencyConflictError" });
        await expect(createVoiceProfileBundle({ ...input("request-one", "Original"), sourceStorageKey: "permanent/other.mp3" })).rejects.toMatchObject({ name: "VoiceProfileIdempotencyConflictError" });
    });

    it("pages only the owner's profiles and applies an explicit status filter", async () => {
        const ready = await createVoiceProfileBundle(input("ready", "Ready"));
        await updateVoiceProfile(ready.profile.id, { status: "ready", providerVoiceId: "provider-secret", channelId: "channel-secret" });
        await createVoiceProfileBundle(input("pending", "Pending"));
        await createVoiceProfileBundle({ ...input("other", "Other"), userId: "user-two" });

        await expect(listVoiceProfilesForUser("user-one", { page: 1, pageSize: 1 })).resolves.toMatchObject({ total: 2, page: 1, pageSize: 1, items: [expect.objectContaining({ userId: "user-one" })] });
        await expect(listVoiceProfilesForUser("user-one", { page: 1, pageSize: 20, status: "ready" })).resolves.toMatchObject({ total: 1, items: [{ name: "Ready", status: "ready" }] });
    });

    it("removes provider binding details from the public profile", async () => {
        const created = await createVoiceProfileBundle(input("public", "Public"));
        const stored = await updateVoiceProfile(created.profile.id, { status: "ready", providerVoiceId: "provider-secret", channelId: "channel-secret", providerTrace: "trace-secret" });

        expect(publicVoiceProfile(stored!)).toEqual(expect.objectContaining({ id: created.profile.id, name: "Public", status: "ready", source: { mimeType: "audio/mpeg", durationSeconds: 12 } }));
        expect(JSON.stringify(publicVoiceProfile(stored!))).not.toMatch(/provider-secret|channel-secret|trace-secret/);
    });

    it("authorizes provider voice operations only through the owning pinned profile", async () => {
        const created = await createVoiceProfileBundle(input("owned", "Owned"));
        await updateVoiceProfile(created.profile.id, { status: "deleting", providerVoiceId: "provider-secret", channelId: "dflop" });

        await expect(userOwnsVoiceProfileProviderVoice("user-one", "dflop", "provider-secret")).resolves.toBe(true);
        await expect(userOwnsVoiceProfileProviderVoice("user-two", "dflop", "provider-secret")).resolves.toBe(false);
        await expect(userOwnsVoiceProfileProviderVoice("user-one", "other", "provider-secret")).resolves.toBe(false);
    });

    it("blocks user removal while a clone can still create or own an upstream voice", async () => {
        const created = await createVoiceProfileBundle(input("pending-removal", "Pending"));
        await expect(hasProviderVoiceProfilesForUser("user-one")).resolves.toBe(true);

        await updateVoiceProfile(created.profile.id, { status: "failed" });
        await expect(hasProviderVoiceProfilesForUser("user-one")).resolves.toBe(false);

        await updateVoiceProfile(created.profile.id, { providerVoiceId: "provider-secret" });
        await expect(hasProviderVoiceProfilesForUser("user-one")).resolves.toBe(true);
    });

    it("atomically marks a profile deleting and persists its delete operation", async () => {
        const created = await createVoiceProfileBundle(input("delete", "Delete"));
        const ready = await updateVoiceProfile(created.profile.id, { status: "ready", providerVoiceId: "provider-secret", channelId: "dflop" });

        const deletion = await createVoiceDeleteTask(ready!, created.task.config);

        expect(deletion.profile.status).toBe("deleting");
        expect(deletion.task).toMatchObject({ operation: "delete", status: "pending", voiceProfileId: ready!.id, providerVoiceId: "provider-secret", deletePreviousStatus: "ready" });
        await expect(getActiveVoiceCloneTaskForProfile("user-one", ready!.id, "delete")).resolves.toMatchObject({ id: deletion.task.id, operation: "delete" });
        await updateVoiceCloneTask(deletion.task.id, { status: "error" });
        await expect(getActiveVoiceCloneTaskForProfile("user-one", ready!.id, "delete")).resolves.toBeNull();
    });

    it("atomically finalizes both sides of a successful or failed delete operation", async () => {
        const successful = await createVoiceProfileBundle(input("delete-success", "Delete success"));
        const successfulReady = await updateVoiceProfile(successful.profile.id, { status: "ready", providerVoiceId: "provider-success", channelId: "dflop" });
        const successfulDelete = await createVoiceDeleteTask(successfulReady!, successful.task.config);
        const succeeded = await finalizeVoiceDeleteTask(successfulDelete.task, { status: "success", attempts: [], providerTrace: "trace-one" });

        expect(succeeded).toMatchObject({ task: { status: "success" }, profile: { status: "deleted", upstreamStatus: "deleted", providerTrace: "trace-one", deletedAt: expect.any(String) } });
        await expect(getVoiceProfileForUser("user-one", successful.profile.id)).resolves.toMatchObject({ status: "deleted" });

        const failed = await createVoiceProfileBundle(input("delete-failed", "Delete failed"));
        const failedReady = await updateVoiceProfile(failed.profile.id, { status: "ready", providerVoiceId: "provider-failed", channelId: "dflop" });
        const failedDelete = await createVoiceDeleteTask(failedReady!, failed.task.config);
        const rejected = await finalizeVoiceDeleteTask(failedDelete.task, { status: "error", attempts: [], error: "上游拒绝删除" });

        expect(rejected).toMatchObject({ task: { status: "error", error: "上游拒绝删除" }, profile: { status: "ready", error: "上游拒绝删除" } });
        await expect(getVoiceProfileForUser("user-one", failed.profile.id)).resolves.toMatchObject({ status: "ready" });
    });

    it("repairs a crash after the terminal profile journal is written but before the task record", async () => {
        const created = await createVoiceProfileBundle(input("delete-crash", "Delete crash"));
        const ready = await updateVoiceProfile(created.profile.id, { status: "ready", providerVoiceId: "provider-crash", channelId: "dflop" });
        const deletion = await createVoiceDeleteTask(ready!, created.task.config);
        const running = await updateVoiceCloneTask(deletion.task.id, {
            status: "running",
            attemptNo: 1,
            attempts: [{ attemptNo: 1, channelId: "dflop", model: "voice-clone", capability: "audio", status: "running", startedAt: 1 }],
        });
        const database = await readJsonDataFile<{ version: 1; profiles: Array<Record<string, unknown>> }>("voice-profiles.json", { version: 1, profiles: [] });
        await writeJsonDataFile("voice-profiles.json", {
            version: 1,
            profiles: database.profiles.map((profile) => (profile.id === ready!.id ? { ...profile, status: "deleted", upstreamStatus: "deleted", deletedAt: "2026-09-03T01:00:00.000Z" } : profile)),
        });
        const pendingRecords = await readJsonDataFile<StoredGenerationTaskRecord[]>("generation-tasks.json", []);
        expect(pendingRecords.find((record) => record.id === deletion.task.id)?.status).toBe("running");

        const repaired = await finalizeVoiceDeleteTask(running!, { status: "success", attempts: running!.attempts || [] });

        expect(repaired).toMatchObject({ task: { status: "success", attempts: [{ status: "succeeded", completedAt: expect.any(Number) }] }, profile: { status: "deleted" } });
        await expect(getVoiceCloneTask(deletion.task.id)).resolves.toMatchObject({ status: "success" });
    });

    it("repairs a crash after a failed profile journal and closes the running attempt", async () => {
        const created = await createVoiceProfileBundle(input("delete-error-crash", "Delete error crash"));
        const ready = await updateVoiceProfile(created.profile.id, { status: "ready", providerVoiceId: "provider-error-crash", channelId: "dflop" });
        const deletion = await createVoiceDeleteTask(ready!, created.task.config);
        const running = await updateVoiceCloneTask(deletion.task.id, {
            status: "running",
            attemptNo: 1,
            attempts: [{ attemptNo: 1, channelId: "dflop", model: "voice-clone", capability: "audio", status: "running", startedAt: 1 }],
        });
        const database = await readJsonDataFile<{ version: 1; profiles: Array<Record<string, unknown>> }>("voice-profiles.json", { version: 1, profiles: [] });
        await writeJsonDataFile("voice-profiles.json", {
            version: 1,
            profiles: database.profiles.map((profile) => (profile.id === ready!.id ? { ...profile, status: "ready", error: "上游拒绝删除" } : profile)),
        });

        const repaired = await finalizeVoiceDeleteTask(running!, { status: "error", attempts: running!.attempts || [], error: "恢复检查" });

        expect(repaired).toMatchObject({ task: { status: "error", error: "上游拒绝删除", attempts: [{ status: "failed", completedAt: expect.any(Number), error: "上游拒绝删除" }] }, profile: { status: "ready", error: "上游拒绝删除" } });
    });

    it("holds the voice files while deleting an eligible file-backed account and removes its local records", async () => {
        const created = await createVoiceProfileBundle(input("account-delete", "Account delete"));
        await updateVoiceProfile(created.profile.id, { status: "failed" });
        const deleteAccount = vi.fn(async () => ({ ok: true }));

        await expect(deleteFileVoiceProfilesWithUserAccount("user-one", deleteAccount)).resolves.toEqual({ ok: true });

        expect(deleteAccount).toHaveBeenCalledOnce();
        await expect(getVoiceProfileForUser("user-one", created.profile.id)).resolves.toBeNull();
        await expect(getVoiceCloneTask(created.task.id)).resolves.toBeNull();
    });

    it("keeps the account and voice records when file-backed deletion is unsafe", async () => {
        const created = await createVoiceProfileBundle(input("account-blocked", "Account blocked"));
        const deleteAccount = vi.fn(async () => ({ ok: true }));

        await expect(deleteFileVoiceProfilesWithUserAccount("user-one", deleteAccount)).rejects.toMatchObject({ name: "VoiceProfileUserDeletionConflictError" });
        expect(deleteAccount).not.toHaveBeenCalled();
        await expect(getVoiceProfileForUser("user-one", created.profile.id)).resolves.toBeTruthy();
    });
});

function input(clientRequestId: string, name: string) {
    return {
        userId: "user-one",
        name,
        sourceStorageKey: `permanent/2026/09/03/audio/${clientRequestId}.mp3`,
        sourceMimeType: "audio/mpeg",
        sourceDurationSeconds: 12,
        consentVersion: "1.0",
        consentedAt: "2026-09-03T00:00:00.000Z",
        clientRequestId,
        taskConfig: {
            candidates: [
                {
                    channelId: "dflop",
                    logicalModel: "voice-clone",
                    upstreamModel: "voice-clone-pro",
                    baseUrl: "/api/ai/system/dflop",
                    createPath: "/audio/voices",
                    queryPath: "/audio/voices/:task_id",
                    deletePath: "/audio/voices/:voice_id",
                    requestTemplate: '{"name":"{{name}}","audio_url":"{{audioUrl}}","async":true}',
                    timeoutMs: 120_000,
                },
            ],
        },
    };
}
