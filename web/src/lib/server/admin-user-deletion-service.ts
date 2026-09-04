import { deleteUserByAdmin, getAuthSettings } from "@/lib/auth/store";
import { getDatabaseProvider } from "@/lib/server/database";
import { deleteGenerationLogsByUserId } from "@/lib/server/generation-log-store";
import { deleteRegisteredLocalMediaSnapshots } from "@/lib/server/local-media-storage";
import { listLocalMediaRegistrationsForDeletion, type LocalMediaRegistration } from "@/lib/server/local-media-registry";
import { deleteFileVoiceProfilesWithUserAccount, hasProviderVoiceProfilesForUser, VoiceProfileUserDeletionConflictError } from "@/lib/server/voice-profile-store";

export class AdminUserDeletionError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export async function deleteAdminUserWithMediaCleanup(actorIdValue: unknown, userIdValue: unknown) {
    const actorId = normalizeId(actorIdValue);
    const userId = normalizeId(userIdValue);
    if (!actorId || !userId) throw new Error("管理员和用户标识不能为空");

    const { dataLifecycle } = await getAuthSettings();
    let snapshots: LocalMediaRegistration[] = [];
    if (getDatabaseProvider() === "postgres") {
        await deleteUserByAdmin(actorId, userId, {
            beforeDelete: async (client, lockedUserId) => {
                if (await hasProviderVoiceProfilesForUser(lockedUserId, { executor: client })) throw new AdminUserDeletionError("请先删除该用户的声音档案并等待上游清理完成", 409);
                snapshots = await listLocalMediaRegistrationsForDeletion(lockedUserId, { batchSize: dataLifecycle.maintenanceBatchSize, executor: client, forUpdate: true });
            },
        });
        await deleteRegisteredLocalMediaSnapshots(snapshots);
        return { ok: true };
    }

    try {
        await deleteFileVoiceProfilesWithUserAccount(userId, async () => {
            snapshots = await listLocalMediaRegistrationsForDeletion(userId, { batchSize: dataLifecycle.maintenanceBatchSize });
            return deleteUserByAdmin(actorId, userId);
        });
    } catch (error) {
        if (error instanceof VoiceProfileUserDeletionConflictError || (error instanceof Error && error.name === "VoiceProfileUserDeletionConflictError")) {
            throw new AdminUserDeletionError("请先删除该用户的声音档案并等待上游清理完成", 409);
        }
        throw error;
    }
    try {
        await deleteGenerationLogsByUserId(userId);
    } finally {
        await deleteRegisteredLocalMediaSnapshots(snapshots);
    }
    return { ok: true };
}

function normalizeId(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
