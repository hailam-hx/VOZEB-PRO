import { randomUUID } from "node:crypto";

import { withFileAuthDatabaseLock } from "@/lib/auth/store-repository";
import { readJsonDataFile, withJsonDataFileLocks, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ensurePostgresSchema, getDatabaseProvider, postgresQuery, withPostgresTransaction, type QueryExecutor } from "@/lib/server/database";
import { getStoredGenerationTask, mutateStoredGenerationTask, transitionStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";
import { GENERATION_TASK_RETENTION_MS } from "@/lib/server/generation-task-retention";
import type { StoredGenerationTaskRecord } from "@/lib/server/generation-task-types";

export type VoiceProfileStatus = "pending" | "ready" | "failed" | "deleting" | "deleted";

export type VoiceProfile = {
    id: string;
    userId: string;
    name: string;
    status: VoiceProfileStatus;
    sourceStorageKey: string;
    sourceMimeType: string;
    sourceDurationSeconds: number;
    provider: "dflop";
    channelId?: string;
    providerVoiceId?: string;
    upstreamStatus?: string;
    providerTrace?: string;
    previewStorageKey?: string;
    consentVersion: string;
    consentedAt: string;
    clientRequestId: string;
    cloneTaskId: string;
    error?: string;
    lastUsedAt?: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
};

export type VoiceCloneCandidateConfig = {
    channelId: string;
    logicalModel: string;
    upstreamModel: string;
    baseUrl: string;
    createPath: string;
    queryPath: string;
    deletePath?: string;
    catalogPath?: string;
    requestTemplate: string;
    resultField?: string;
    statusField?: string;
    timeoutMs: number;
    capabilityProfile?: import("@/lib/auth/store").LogicalModelCapabilityProfile;
    usagePricing?: import("@/lib/server/generation-channel").SystemGenerationChannelConfig["usagePricing"];
};

export type VoiceCloneTask = GenerationTaskContext & {
    id: string;
    userId: string;
    voiceProfileId: string;
    operation: "clone" | "delete";
    status: "pending" | "running" | "success" | "error" | "cancelled";
    config: VoiceCloneCandidateConfig;
    candidateConfigs?: VoiceCloneCandidateConfig[];
    providerVoiceId?: string;
    upstream?: { id: string; createPath: string };
    deletePreviousStatus?: "ready" | "failed";
    attempts?: GenerationAttempt[];
    attemptNo?: number;
    billing?: { pointsCost: number; pointsRecordId?: string; refunded: boolean };
    error?: string;
    createdAt: number;
    updatedAt: number;
};

export type PublicVoiceProfile = {
    id: string;
    name: string;
    status: VoiceProfileStatus;
    source: { mimeType: string; durationSeconds: number };
    hasPreview: boolean;
    error?: string;
    lastUsedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export class VoiceProfileIdempotencyConflictError extends Error {
    override name = "VoiceProfileIdempotencyConflictError";
}

export class VoiceProfileUserDeletionConflictError extends Error {
    override name = "VoiceProfileUserDeletionConflictError";
}

export type VoiceDeleteFinalization = { status: "success"; attempts: GenerationAttempt[]; providerTrace?: string } | { status: "error"; attempts: GenerationAttempt[]; error: string };

type VoiceProfileDatabase = { version: 1; profiles: VoiceProfile[] };
type CreateVoiceProfileBundleInput = {
    userId: string;
    name: string;
    sourceStorageKey: string;
    sourceMimeType: string;
    sourceDurationSeconds: number;
    consentVersion: string;
    consentedAt: string;
    clientRequestId: string;
    taskConfig: { candidates: VoiceCloneCandidateConfig[] };
};

const PROFILE_FILE = "voice-profiles.json";
const TASK_FILE = "generation-tasks.json";

export async function createVoiceProfileBundle(input: CreateVoiceProfileBundleInput): Promise<{ profile: VoiceProfile; task: VoiceCloneTask }> {
    const normalized = normalizeCreateInput(input);
    if (!normalized.taskConfig.candidates.length) throw new Error("声音克隆模型尚未配置");
    if (getDatabaseProvider() === "postgres") return createPostgresBundle(normalized);
    return withJsonDataFileLocks([PROFILE_FILE, TASK_FILE], async () => {
        return withFileAuthDatabaseLock(async (authDatabase) => {
            if (!authDatabase.users.some((user) => user.id === normalized.userId)) throw new Error("用户不可用");
            const [database, tasks] = await Promise.all([readProfileDatabase(), readJsonDataFile<StoredGenerationTaskRecord[]>(TASK_FILE, [])]);
            const existing = database.profiles.find((profile) => profile.userId === normalized.userId && profile.clientRequestId === normalized.clientRequestId);
            if (existing) {
                assertSameCreateRequest(existing, normalized);
                const record = tasks.find((task) => task.type === "voice-clone" && task.id === existing.cloneTaskId);
                if (!record) throw new Error("声音克隆任务数据不完整");
                return { profile: existing, task: record.payload as VoiceCloneTask };
            }
            const bundle = buildBundle(normalized);
            const nextDatabase: VoiceProfileDatabase = { version: 1, profiles: [bundle.profile, ...database.profiles] };
            const nextTasks = [taskRecord(bundle.task), ...tasks];
            try {
                await writeJsonDataFile(PROFILE_FILE, nextDatabase);
                await writeJsonDataFile(TASK_FILE, nextTasks);
            } catch (error) {
                await Promise.allSettled([writeJsonDataFile(PROFILE_FILE, database), writeJsonDataFile(TASK_FILE, tasks)]);
                throw error;
            }
            return bundle;
        });
    });
}

export async function deleteFileVoiceProfilesWithUserAccount<T>(userId: string, deleteAccount: () => Promise<T>) {
    const owner = requiredText(userId, 160, "用户不能为空");
    if (getDatabaseProvider() === "postgres") throw new Error("PostgreSQL 用户删除必须使用数据库事务");
    return withJsonDataFileLocks([PROFILE_FILE, TASK_FILE], async () => {
        const [database, tasks] = await Promise.all([readProfileDatabase(), readJsonDataFile<StoredGenerationTaskRecord[]>(TASK_FILE, [])]);
        if (database.profiles.some((profile) => dangerousForUserDeletion(profile, owner))) throw new VoiceProfileUserDeletionConflictError("请先删除该用户的声音档案并等待上游清理完成");
        const nextDatabase: VoiceProfileDatabase = { version: 1, profiles: database.profiles.filter((profile) => profile.userId !== owner) };
        const nextTasks = tasks.filter((task) => task.type !== "voice-clone" || task.userId !== owner);
        try {
            await writeJsonDataFile(PROFILE_FILE, nextDatabase);
            await writeJsonDataFile(TASK_FILE, nextTasks);
            return await deleteAccount();
        } catch (error) {
            await Promise.allSettled([writeJsonDataFile(PROFILE_FILE, database), writeJsonDataFile(TASK_FILE, tasks)]);
            throw error;
        }
    });
}

export async function createVoiceDeleteTask(profile: VoiceProfile, config: VoiceCloneCandidateConfig): Promise<{ profile: VoiceProfile; task: VoiceCloneTask }> {
    if (!profile.providerVoiceId || !profile.channelId || config.channelId !== profile.channelId || !config.deletePath) throw new Error("声音档案缺少可用的上游删除配置");
    if (profile.status !== "ready" && profile.status !== "failed") throw new Error("当前声音档案无法删除");
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (executor) => {
            const result = await executor.query<Record<string, unknown>>("SELECT * FROM voice_profiles WHERE id=$1 AND user_id=$2 FOR UPDATE", [profile.id, profile.userId]);
            const current = result.rows[0] ? mapVoiceProfile(result.rows[0]) : null;
            if (!current || (current.status !== "ready" && current.status !== "failed")) throw new Error("当前声音档案无法删除");
            const bundle = buildDeleteBundle(current, config);
            await executor.query("UPDATE voice_profiles SET status='deleting', updated_at=$2 WHERE id=$1", [current.id, bundle.profile.updatedAt]);
            await insertPostgresVoiceTask(executor, bundle.task);
            return bundle;
        });
    }
    return withJsonDataFileLocks([PROFILE_FILE, TASK_FILE], async () => {
        const [database, tasks] = await Promise.all([readProfileDatabase(), readJsonDataFile<StoredGenerationTaskRecord[]>(TASK_FILE, [])]);
        const current = database.profiles.find((item) => item.id === profile.id && item.userId === profile.userId);
        if (!current || (current.status !== "ready" && current.status !== "failed")) throw new Error("当前声音档案无法删除");
        const bundle = buildDeleteBundle(current, config);
        const nextDatabase = { version: 1 as const, profiles: database.profiles.map((item) => (item.id === current.id ? bundle.profile : item)) };
        try {
            await writeJsonDataFile(PROFILE_FILE, nextDatabase);
            await writeJsonDataFile(TASK_FILE, [taskRecord(bundle.task), ...tasks]);
        } catch (error) {
            await Promise.allSettled([writeJsonDataFile(PROFILE_FILE, database), writeJsonDataFile(TASK_FILE, tasks)]);
            throw error;
        }
        return bundle;
    });
}

export async function getVoiceProfile(id: string) {
    const profileId = text(id, 160);
    if (!profileId) return null;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>("SELECT * FROM voice_profiles WHERE id = $1", [profileId]);
        return result.rows[0] ? mapVoiceProfile(result.rows[0]) : null;
    }
    return (await readProfileDatabase()).profiles.find((profile) => profile.id === profileId) || null;
}

export async function getVoiceProfileForUser(userId: string, id: string) {
    const owner = text(userId, 160);
    const profileId = text(id, 160);
    if (!owner || !profileId) return null;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>("SELECT * FROM voice_profiles WHERE id = $1 AND user_id = $2", [profileId, owner]);
        return result.rows[0] ? mapVoiceProfile(result.rows[0]) : null;
    }
    return (await readProfileDatabase()).profiles.find((profile) => profile.id === profileId && profile.userId === owner) || null;
}

export async function getVoiceProfileByClientRequestId(userId: string, clientRequestId: string) {
    const owner = text(userId, 160);
    const requestId = text(clientRequestId, 160);
    if (!owner || !requestId) return null;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>("SELECT * FROM voice_profiles WHERE user_id = $1 AND client_request_id = $2", [owner, requestId]);
        return result.rows[0] ? mapVoiceProfile(result.rows[0]) : null;
    }
    return (await readProfileDatabase()).profiles.find((profile) => profile.userId === owner && profile.clientRequestId === requestId) || null;
}

export async function hasProviderVoiceProfilesForUser(userId: string, options: { executor?: QueryExecutor } = {}) {
    const owner = text(userId, 160);
    if (!owner) return false;
    if (getDatabaseProvider() === "postgres") {
        if (!options.executor) await ensurePostgresSchema();
        const result = await (options.executor || { query: postgresQuery }).query(
            `SELECT 1 FROM voice_profiles
             WHERE user_id=$1 AND status <> 'deleted'
               AND (status IN ('pending','ready','deleting') OR provider_voice_id IS NOT NULL)
             LIMIT 1`,
            [owner],
        );
        return Boolean(result.rows[0]);
    }
    return (await readProfileDatabase()).profiles.some((profile) => dangerousForUserDeletion(profile, owner));
}

export async function userOwnsVoiceProfileProviderVoice(userId: string, channelId: string, providerVoiceId: string) {
    const owner = text(userId, 160);
    const channel = text(channelId, 160);
    const voice = text(providerVoiceId, 500);
    if (!owner || !channel || !voice) return false;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery(
            `SELECT 1 FROM voice_profiles
             WHERE user_id=$1 AND channel_id=$2 AND provider_voice_id=$3 AND status IN ('ready','deleting')
             LIMIT 1`,
            [owner, channel, voice],
        );
        return Boolean(result.rows[0]);
    }
    return (await readProfileDatabase()).profiles.some((profile) => profile.userId === owner && profile.channelId === channel && profile.providerVoiceId === voice && (profile.status === "ready" || profile.status === "deleting"));
}

export async function getVoiceProfileSourceDurationForBilling(userId: string, sourceStorageKey: string) {
    const owner = text(userId, 160);
    const key = text(sourceStorageKey, 1_000);
    if (!owner || !key) return undefined;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ source_duration_seconds: string | number }>(
            `SELECT source_duration_seconds FROM voice_profiles
             WHERE user_id=$1 AND source_storage_key=$2 AND status IN ('pending','ready')
             ORDER BY created_at DESC LIMIT 1`,
            [owner, key],
        );
        const duration = Number(result.rows[0]?.source_duration_seconds);
        return Number.isFinite(duration) && duration > 0 ? duration : undefined;
    }
    const profile = (await readProfileDatabase()).profiles
        .filter((item) => item.userId === owner && item.sourceStorageKey === key && (item.status === "pending" || item.status === "ready"))
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return profile?.sourceDurationSeconds;
}

export async function listVoiceProfilesForUser(userId: string, input: { page?: number; pageSize?: number; status?: VoiceProfileStatus } = {}) {
    const owner = text(userId, 160);
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 20)));
    const status = voiceProfileStatus(input.status) ? input.status : undefined;
    const offset = (page - 1) * pageSize;
    if (!owner) return { items: [] as VoiceProfile[], total: 0, page, pageSize };
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<Record<string, unknown>>(
            `WITH filtered AS (
                SELECT * FROM voice_profiles
                WHERE user_id = $1 AND ($2::text IS NOT NULL OR status <> 'deleted') AND ($2::text IS NULL OR status = $2)
            ), page_items AS (
                SELECT * FROM filtered ORDER BY updated_at DESC, id DESC LIMIT $3 OFFSET $4
            )
            SELECT page_items.*, totals.total_count
            FROM (SELECT count(*)::integer AS total_count FROM filtered) totals
            LEFT JOIN page_items ON TRUE
            ORDER BY page_items.updated_at DESC NULLS LAST, page_items.id DESC`,
            [owner, status || null, pageSize, offset],
        );
        return { items: result.rows.filter((row) => row.id).map(mapVoiceProfile), total: Number(result.rows[0]?.total_count || 0), page, pageSize };
    }
    const profiles = (await readProfileDatabase()).profiles
        .filter((profile) => profile.userId === owner && (status ? profile.status === status : profile.status !== "deleted"))
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
    return { items: profiles.slice(offset, offset + pageSize), total: profiles.length, page, pageSize };
}

export async function updateVoiceProfile(id: string, patch: Partial<Omit<VoiceProfile, "id" | "userId" | "clientRequestId" | "cloneTaskId" | "createdAt">>) {
    const profileId = text(id, 160);
    if (!profileId) return null;
    const normalizedPatch = normalizePatch(patch);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const current = await getVoiceProfile(profileId);
        if (!current) return null;
        const next = normalizeProfile({ ...current, ...normalizedPatch, updatedAt: new Date().toISOString() });
        const result = await postgresQuery<Record<string, unknown>>(
            `UPDATE voice_profiles SET name=$2, status=$3, channel_id=$4, provider_voice_id=$5, upstream_status=$6, provider_trace=$7,
                preview_storage_key=$8, error=$9, last_used_at=$10, updated_at=$11, deleted_at=$12
             WHERE id=$1 RETURNING *`,
            [
                next.id,
                next.name,
                next.status,
                next.channelId || null,
                next.providerVoiceId || null,
                next.upstreamStatus || null,
                next.providerTrace || null,
                next.previewStorageKey || null,
                next.error || null,
                next.lastUsedAt || null,
                next.updatedAt,
                next.deletedAt || null,
            ],
        );
        return result.rows[0] ? mapVoiceProfile(result.rows[0]) : null;
    }
    return withJsonDataFileLocks([PROFILE_FILE], async () => {
        const database = await readProfileDatabase();
        const current = database.profiles.find((profile) => profile.id === profileId);
        if (!current) return null;
        const next = normalizeProfile({ ...current, ...normalizedPatch, updatedAt: new Date().toISOString() });
        await writeJsonDataFile(PROFILE_FILE, { version: 1, profiles: database.profiles.map((profile) => (profile.id === profileId ? next : profile)) } satisfies VoiceProfileDatabase);
        return next;
    });
}

export async function finalizeVoiceDeleteTask(task: VoiceCloneTask, outcome: VoiceDeleteFinalization): Promise<{ profile: VoiceProfile; task: VoiceCloneTask } | null> {
    if (task.operation !== "delete") return null;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (executor) => {
            const taskResult = await executor.query<{ status: string; payload: VoiceCloneTask }>("SELECT status,payload FROM generation_tasks WHERE id=$1 AND user_id=$2 AND task_type='voice-clone' FOR UPDATE", [task.id, task.userId]);
            const profileResult = await executor.query<Record<string, unknown>>("SELECT * FROM voice_profiles WHERE id=$1 AND user_id=$2 FOR UPDATE", [task.voiceProfileId, task.userId]);
            const currentTask = taskResult.rows[0]?.payload ? ({ ...taskResult.rows[0].payload, status: taskResult.rows[0].status } as VoiceCloneTask) : null;
            const currentProfile = profileResult.rows[0] ? mapVoiceProfile(profileResult.rows[0]) : null;
            const finalized = buildDeleteFinalization(currentTask, currentProfile, outcome);
            if (!finalized) return null;
            if (isMatchingDeleteFinalization(currentTask!, currentProfile!, outcome)) return finalized;
            await executor.query("UPDATE generation_tasks SET status=$3,payload=$4::jsonb,updated_at=$5,expires_at=$6 WHERE id=$1 AND user_id=$2 AND task_type='voice-clone'", [
                finalized.task.id,
                finalized.task.userId,
                finalized.task.status,
                JSON.stringify(finalized.task),
                new Date(finalized.task.updatedAt),
                new Date(finalized.task.updatedAt + GENERATION_TASK_RETENTION_MS),
            ]);
            const updatedProfile = await updatePostgresVoiceProfile(executor, finalized.profile);
            return { task: finalized.task, profile: updatedProfile };
        });
    }
    return withJsonDataFileLocks([PROFILE_FILE, TASK_FILE], async () => {
        const [database, records] = await Promise.all([readProfileDatabase(), readJsonDataFile<StoredGenerationTaskRecord[]>(TASK_FILE, [])]);
        const record = records.find((item) => item.type === "voice-clone" && item.id === task.id && item.userId === task.userId);
        const currentTask = record ? ({ ...(record.payload as VoiceCloneTask), status: record.status } as VoiceCloneTask) : null;
        const currentProfile = database.profiles.find((profile) => profile.id === task.voiceProfileId && profile.userId === task.userId) || null;
        const finalized = buildDeleteFinalization(currentTask, currentProfile, outcome);
        if (!finalized) return null;
        if (isMatchingDeleteFinalization(currentTask!, currentProfile!, outcome)) return finalized;
        const nextDatabase: VoiceProfileDatabase = { version: 1, profiles: database.profiles.map((profile) => (profile.id === finalized.profile.id ? finalized.profile : profile)) };
        const nextRecords = records.map((item) =>
            item.id === finalized.task.id && item.type === "voice-clone"
                ? { ...item, status: finalized.task.status, payload: finalized.task as unknown as Record<string, unknown>, updatedAt: finalized.task.updatedAt, expiresAt: finalized.task.updatedAt + GENERATION_TASK_RETENTION_MS }
                : item,
        );
        try {
            await writeJsonDataFile(PROFILE_FILE, nextDatabase);
            await writeJsonDataFile(TASK_FILE, nextRecords);
        } catch (error) {
            await Promise.allSettled([writeJsonDataFile(PROFILE_FILE, database), writeJsonDataFile(TASK_FILE, records)]);
            throw error;
        }
        return finalized;
    });
}

export function getVoiceCloneTask(id: string) {
    return getStoredGenerationTask<VoiceCloneTask>("voice-clone", id);
}

export async function getActiveVoiceCloneTaskForProfile(userId: string, profileId: string, operation: VoiceCloneTask["operation"]) {
    const owner = text(userId, 160);
    const id = text(profileId, 160);
    if (!owner || !id) return null;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ id: string }>(
            `SELECT id FROM generation_tasks
             WHERE user_id=$1 AND task_type='voice-clone' AND status IN ('pending','running') AND payload->>'voiceProfileId'=$2 AND payload->>'operation'=$3
             ORDER BY updated_at DESC, id DESC LIMIT 1`,
            [owner, id, operation],
        );
        return result.rows[0]?.id ? getVoiceCloneTask(result.rows[0].id) : null;
    }
    const records = await readJsonDataFile<StoredGenerationTaskRecord[]>(TASK_FILE, []);
    const active = records
        .filter((record) => record.userId === owner && record.type === "voice-clone" && (record.status === "pending" || record.status === "running") && record.payload.voiceProfileId === id && record.payload.operation === operation)
        .toSorted((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))[0];
    return active ? getVoiceCloneTask(active.id) : null;
}

export function updateVoiceCloneTask(id: string, patch: Partial<Pick<VoiceCloneTask, "status" | "config" | "candidateConfigs" | "providerVoiceId" | "deletePreviousStatus" | "upstream" | "attempts" | "attemptNo" | "billing" | "error">>) {
    return mutateStoredGenerationTask<VoiceCloneTask>("voice-clone", id, GENERATION_TASK_RETENTION_MS, (task) => ({ ...task, ...patch }));
}

export function transitionVoiceCloneTask(
    task: VoiceCloneTask,
    allowedStatuses: VoiceCloneTask["status"][],
    patch: Partial<VoiceCloneTask> & { status: VoiceCloneTask["status"] },
    executionPatch?: import("@/lib/server/generation-task-scheduler").GenerationTaskSchedulePatch,
) {
    return transitionStoredGenerationTask<VoiceCloneTask>("voice-clone", task.id, task.userId, allowedStatuses, patch, GENERATION_TASK_RETENTION_MS, executionPatch);
}

export function publicVoiceProfile(profile: VoiceProfile): PublicVoiceProfile {
    return {
        id: profile.id,
        name: profile.name,
        status: profile.status,
        source: { mimeType: profile.sourceMimeType, durationSeconds: profile.sourceDurationSeconds },
        hasPreview: Boolean(profile.previewStorageKey),
        ...(profile.error ? { error: profile.error } : {}),
        ...(profile.lastUsedAt ? { lastUsedAt: profile.lastUsedAt } : {}),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
    };
}

async function createPostgresBundle(input: ReturnType<typeof normalizeCreateInput>) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (executor) => {
        await executor.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`vozeb-pro:voice-profile:${input.userId}:${input.clientRequestId}`]);
        const existingResult = await executor.query<Record<string, unknown>>("SELECT * FROM voice_profiles WHERE user_id = $1 AND client_request_id = $2 FOR UPDATE", [input.userId, input.clientRequestId]);
        if (existingResult.rows[0]) {
            const profile = mapVoiceProfile(existingResult.rows[0]);
            assertSameCreateRequest(profile, input);
            const taskResult = await executor.query<{ payload: VoiceCloneTask }>("SELECT payload FROM generation_tasks WHERE id = $1 AND task_type = 'voice-clone'", [profile.cloneTaskId]);
            if (!taskResult.rows[0]?.payload) throw new Error("声音克隆任务数据不完整");
            return { profile, task: taskResult.rows[0].payload };
        }
        const bundle = buildBundle(input);
        await insertPostgresProfile(executor, bundle.profile);
        await insertPostgresVoiceTask(executor, bundle.task);
        return bundle;
    });
}

function buildDeleteFinalization(currentTask: VoiceCloneTask | null, currentProfile: VoiceProfile | null, outcome: VoiceDeleteFinalization) {
    if (!currentTask || !currentProfile || currentTask.operation !== "delete" || currentTask.voiceProfileId !== currentProfile.id || currentTask.userId !== currentProfile.userId) return null;
    if (isMatchingDeleteFinalization(currentTask, currentProfile, outcome)) return { task: currentTask, profile: currentProfile };
    const active = currentTask.status === "pending" || currentTask.status === "running";
    if (active && currentProfile.status === "deleted") {
        const updatedAt = Date.now();
        return { profile: currentProfile, task: { ...currentTask, status: "success" as const, attempts: terminalDeleteAttempts(currentTask, outcome.attempts, "succeeded", updatedAt), error: "", updatedAt } };
    }
    const previousStatus = currentTask.deletePreviousStatus || "ready";
    if (active && currentProfile.status === previousStatus && currentProfile.error) {
        const updatedAt = Date.now();
        return { profile: currentProfile, task: { ...currentTask, status: "error" as const, attempts: terminalDeleteAttempts(currentTask, outcome.attempts, "failed", updatedAt, currentProfile.error), error: currentProfile.error, updatedAt } };
    }
    if (!active || currentProfile.status !== "deleting") return null;
    const updatedAt = Date.now();
    const task: VoiceCloneTask = {
        ...currentTask,
        status: outcome.status,
        attempts: outcome.attempts,
        error: outcome.status === "error" ? outcome.error : "",
        updatedAt,
    };
    const profile = normalizeProfile({
        ...currentProfile,
        status: outcome.status === "success" ? "deleted" : previousStatus,
        error: outcome.status === "error" ? outcome.error : "",
        updatedAt: new Date(updatedAt).toISOString(),
        ...(outcome.status === "success"
            ? {
                  upstreamStatus: "deleted",
                  ...(outcome.providerTrace ? { providerTrace: outcome.providerTrace } : {}),
                  deletedAt: new Date(updatedAt).toISOString(),
              }
            : {}),
    });
    return { task, profile };
}

function isMatchingDeleteFinalization(task: VoiceCloneTask, profile: VoiceProfile, outcome: VoiceDeleteFinalization) {
    return outcome.status === "success" ? task.status === "success" && profile.status === "deleted" : task.status === "error" && profile.status === (task.deletePreviousStatus || "ready");
}

function terminalDeleteAttempts(task: VoiceCloneTask, attempts: GenerationAttempt[], status: "succeeded" | "failed", completedAt: number, error?: string) {
    const attemptNo = task.attemptNo || attempts.at(-1)?.attemptNo;
    return attempts.map((attempt) => (attempt.attemptNo === attemptNo && attempt.status === "running" ? { ...attempt, status, completedAt, ...(error ? { error } : {}) } : attempt));
}

async function updatePostgresVoiceProfile(executor: QueryExecutor, profile: VoiceProfile) {
    const result = await executor.query<Record<string, unknown>>(
        `UPDATE voice_profiles SET status=$3,upstream_status=$4,provider_trace=$5,error=$6,updated_at=$7,deleted_at=$8
         WHERE id=$1 AND user_id=$2 RETURNING *`,
        [profile.id, profile.userId, profile.status, profile.upstreamStatus || null, profile.providerTrace || null, profile.error || null, profile.updatedAt, profile.deletedAt || null],
    );
    if (!result.rows[0]) throw new Error("声音档案删除状态已变化");
    return mapVoiceProfile(result.rows[0]);
}

function dangerousForUserDeletion(profile: VoiceProfile, userId: string) {
    return profile.userId === userId && profile.status !== "deleted" && (profile.status === "pending" || profile.status === "ready" || profile.status === "deleting" || Boolean(profile.providerVoiceId));
}

function assertSameCreateRequest(profile: VoiceProfile, input: ReturnType<typeof normalizeCreateInput>) {
    if (
        profile.name !== input.name ||
        profile.sourceStorageKey !== input.sourceStorageKey ||
        profile.sourceMimeType !== input.sourceMimeType ||
        profile.sourceDurationSeconds !== input.sourceDurationSeconds ||
        profile.consentVersion !== input.consentVersion
    ) {
        throw new VoiceProfileIdempotencyConflictError("相同请求标识不能用于不同的声音克隆参数");
    }
}

async function insertPostgresProfile(executor: QueryExecutor, profile: VoiceProfile) {
    await executor.query(
        `INSERT INTO voice_profiles (
            id,user_id,name,status,source_storage_key,source_mime_type,source_duration_seconds,provider,channel_id,provider_voice_id,
            upstream_status,provider_trace,preview_storage_key,consent_version,consented_at,client_request_id,clone_task_id,error,last_used_at,created_at,updated_at,deleted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
            profile.id,
            profile.userId,
            profile.name,
            profile.status,
            profile.sourceStorageKey,
            profile.sourceMimeType,
            profile.sourceDurationSeconds,
            profile.provider,
            profile.channelId || null,
            profile.providerVoiceId || null,
            profile.upstreamStatus || null,
            profile.providerTrace || null,
            profile.previewStorageKey || null,
            profile.consentVersion,
            profile.consentedAt,
            profile.clientRequestId,
            profile.cloneTaskId,
            profile.error || null,
            profile.lastUsedAt || null,
            profile.createdAt,
            profile.updatedAt,
            profile.deletedAt || null,
        ],
    );
}

async function insertPostgresVoiceTask(executor: QueryExecutor, task: VoiceCloneTask) {
    await executor.query(
        `INSERT INTO generation_tasks (
            id,user_id,task_type,status,payload,created_at,updated_at,expires_at,client_request_id,execution_phase
         ) VALUES ($1,$2,'voice-clone',$3,$4::jsonb,$5,$6,$7,$8,'created')`,
        [task.id, task.userId, task.status, JSON.stringify(task), new Date(task.createdAt), new Date(task.updatedAt), new Date(task.updatedAt + GENERATION_TASK_RETENTION_MS), task.clientRequestId || null],
    );
}

function buildBundle(input: ReturnType<typeof normalizeCreateInput>) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const profileId = randomUUID();
    const taskId = randomUUID();
    const profile: VoiceProfile = normalizeProfile({
        id: profileId,
        userId: input.userId,
        name: input.name,
        status: "pending",
        sourceStorageKey: input.sourceStorageKey,
        sourceMimeType: input.sourceMimeType,
        sourceDurationSeconds: input.sourceDurationSeconds,
        provider: "dflop",
        consentVersion: input.consentVersion,
        consentedAt: input.consentedAt,
        clientRequestId: input.clientRequestId,
        cloneTaskId: taskId,
        createdAt: nowIso,
        updatedAt: nowIso,
    });
    const [config, ...candidates] = input.taskConfig.candidates;
    const task: VoiceCloneTask = {
        id: taskId,
        userId: input.userId,
        voiceProfileId: profileId,
        operation: "clone",
        status: "pending",
        config,
        candidateConfigs: candidates.length ? candidates : undefined,
        clientRequestId: input.clientRequestId,
        createdAt: now,
        updatedAt: now,
    };
    return { profile, task };
}

function buildDeleteBundle(profile: VoiceProfile, config: VoiceCloneCandidateConfig) {
    const now = Date.now();
    const taskId = randomUUID();
    const task: VoiceCloneTask = {
        id: taskId,
        userId: profile.userId,
        voiceProfileId: profile.id,
        operation: "delete",
        status: "pending",
        config,
        providerVoiceId: profile.providerVoiceId,
        deletePreviousStatus: profile.status as "ready" | "failed",
        clientRequestId: `voice-delete:${profile.id}:${taskId}`,
        createdAt: now,
        updatedAt: now,
    };
    return { profile: { ...profile, status: "deleting" as const, updatedAt: new Date(now).toISOString() }, task };
}

function taskRecord(task: VoiceCloneTask): StoredGenerationTaskRecord {
    return {
        id: task.id,
        userId: task.userId,
        type: "voice-clone",
        status: "pending",
        payload: task as unknown as Record<string, unknown>,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        expiresAt: task.updatedAt + GENERATION_TASK_RETENTION_MS,
        executionPhase: "created",
        clientRequestId: task.clientRequestId,
    };
}

function normalizeCreateInput(input: CreateVoiceProfileBundleInput) {
    return {
        userId: requiredText(input.userId, 160, "用户不能为空"),
        name: requiredText(input.name, 120, "声音名称不能为空"),
        sourceStorageKey: requiredText(input.sourceStorageKey, 1000, "声音源文件不能为空"),
        sourceMimeType: requiredText(input.sourceMimeType, 120, "声音源格式不能为空"),
        sourceDurationSeconds: positiveNumber(input.sourceDurationSeconds, "声音源时长无效"),
        consentVersion: requiredText(input.consentVersion, 80, "授权版本不能为空"),
        consentedAt: new Date(input.consentedAt).toISOString(),
        clientRequestId: requiredText(input.clientRequestId, 160, "请求标识不能为空"),
        taskConfig: { candidates: input.taskConfig.candidates.map(normalizeCandidate) },
    };
}

function normalizeCandidate(candidate: VoiceCloneCandidateConfig): VoiceCloneCandidateConfig {
    return {
        channelId: requiredText(candidate.channelId, 160, "渠道不能为空"),
        logicalModel: requiredText(candidate.logicalModel, 160, "逻辑模型不能为空"),
        upstreamModel: requiredText(candidate.upstreamModel, 300, "上游模型不能为空"),
        baseUrl: requiredText(candidate.baseUrl, 2000, "渠道地址不能为空"),
        createPath: requiredText(candidate.createPath, 1000, "创建路径不能为空"),
        queryPath: requiredText(candidate.queryPath, 1000, "查询路径不能为空"),
        ...(text(candidate.deletePath, 1000) ? { deletePath: text(candidate.deletePath, 1000) } : {}),
        ...(text(candidate.catalogPath, 1000) ? { catalogPath: text(candidate.catalogPath, 1000) } : {}),
        requestTemplate: requiredText(candidate.requestTemplate, 20_000, "请求模板不能为空"),
        ...(text(candidate.resultField, 500) ? { resultField: text(candidate.resultField, 500) } : {}),
        ...(text(candidate.statusField, 500) ? { statusField: text(candidate.statusField, 500) } : {}),
        timeoutMs: positiveNumber(candidate.timeoutMs, "请求超时无效"),
        ...(candidate.capabilityProfile ? { capabilityProfile: candidate.capabilityProfile } : {}),
        ...(candidate.usagePricing ? { usagePricing: candidate.usagePricing } : {}),
    };
}

function normalizePatch(patch: Partial<VoiceProfile>) {
    return {
        ...(patch.name !== undefined ? { name: requiredText(patch.name, 120, "声音名称不能为空") } : {}),
        ...(voiceProfileStatus(patch.status) ? { status: patch.status } : {}),
        ...(patch.channelId !== undefined ? { channelId: text(patch.channelId, 160) } : {}),
        ...(patch.providerVoiceId !== undefined ? { providerVoiceId: text(patch.providerVoiceId, 500) } : {}),
        ...(patch.upstreamStatus !== undefined ? { upstreamStatus: text(patch.upstreamStatus, 160) } : {}),
        ...(patch.providerTrace !== undefined ? { providerTrace: text(patch.providerTrace, 1000) } : {}),
        ...(patch.previewStorageKey !== undefined ? { previewStorageKey: text(patch.previewStorageKey, 1000) } : {}),
        ...(patch.error !== undefined ? { error: text(patch.error, 1000) } : {}),
        ...(patch.lastUsedAt !== undefined ? { lastUsedAt: patch.lastUsedAt ? new Date(patch.lastUsedAt).toISOString() : undefined } : {}),
        ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt ? new Date(patch.deletedAt).toISOString() : undefined } : {}),
    };
}

function normalizeProfile(profile: VoiceProfile): VoiceProfile {
    return {
        ...profile,
        name: requiredText(profile.name, 120, "声音名称不能为空"),
        sourceDurationSeconds: positiveNumber(profile.sourceDurationSeconds, "声音源时长无效"),
        status: voiceProfileStatus(profile.status) ? profile.status : "pending",
    };
}

function mapVoiceProfile(row: Record<string, unknown>): VoiceProfile {
    return normalizeProfile({
        id: String(row.id || ""),
        userId: String(row.user_id || ""),
        name: String(row.name || ""),
        status: String(row.status || "pending") as VoiceProfileStatus,
        sourceStorageKey: String(row.source_storage_key || ""),
        sourceMimeType: String(row.source_mime_type || ""),
        sourceDurationSeconds: Number(row.source_duration_seconds),
        provider: "dflop",
        ...(row.channel_id ? { channelId: String(row.channel_id) } : {}),
        ...(row.provider_voice_id ? { providerVoiceId: String(row.provider_voice_id) } : {}),
        ...(row.upstream_status ? { upstreamStatus: String(row.upstream_status) } : {}),
        ...(row.provider_trace ? { providerTrace: String(row.provider_trace) } : {}),
        ...(row.preview_storage_key ? { previewStorageKey: String(row.preview_storage_key) } : {}),
        consentVersion: String(row.consent_version || ""),
        consentedAt: iso(row.consented_at),
        clientRequestId: String(row.client_request_id || ""),
        cloneTaskId: String(row.clone_task_id || ""),
        ...(row.error ? { error: String(row.error) } : {}),
        ...(row.last_used_at ? { lastUsedAt: iso(row.last_used_at) } : {}),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
    });
}

function readProfileDatabase() {
    return readJsonDataFile<VoiceProfileDatabase>(PROFILE_FILE, { version: 1, profiles: [] });
}

function voiceProfileStatus(value: unknown): value is VoiceProfileStatus {
    return value === "pending" || value === "ready" || value === "failed" || value === "deleting" || value === "deleted";
}

function requiredText(value: unknown, maxLength: number, message: string) {
    const normalized = text(value, maxLength);
    if (!normalized) throw new Error(message);
    return normalized;
}

function text(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function positiveNumber(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(message);
    return number;
}

function iso(value: unknown) {
    return new Date(value as string | number | Date).toISOString();
}
