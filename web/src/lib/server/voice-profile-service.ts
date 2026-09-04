import { getAuthSettings } from "@/lib/auth/store";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { deleteUserLocalMediaAssets } from "@/lib/server/local-media-storage";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { inspectVoiceProfileSource, VoiceProfileSourceError } from "@/lib/server/voice-profile-source";
import { createVoiceDeleteTask, createVoiceProfileBundle, getVoiceCloneTask, getVoiceProfileForUser, publicVoiceProfile, updateVoiceProfile, VoiceProfileIdempotencyConflictError, type VoiceCloneCandidateConfig } from "@/lib/server/voice-profile-store";

const CONSENT_VERSION = "voice-cloning-v1";

export class VoiceProfileServiceError extends Error {
    constructor(
        message: string,
        readonly status = 400,
    ) {
        super(message);
    }
}

export async function createVoiceProfile(userId: string, input: { name?: unknown; sourceAssetToken?: unknown; clientRequestId?: unknown; consentConfirmed?: unknown }) {
    const name = requiredText(input.name, 120, "请填写声音名称");
    const sourceAssetToken = requiredText(input.sourceAssetToken, 1_000, "请选择声音样本");
    const clientRequestId = requiredText(input.clientRequestId, 160, "缺少请求标识");
    if (input.consentConfirmed !== true) throw new VoiceProfileServiceError("请确认您拥有声音样本的合法授权");

    const settings = await getAuthSettings();
    const logicalModel = settings.defaultModels.voiceCloneModel?.trim();
    if (!logicalModel) throw new VoiceProfileServiceError("管理员尚未配置声音克隆模型", 503);
    const candidates = resolveLogicalModelCandidates(settings, "audio", logicalModel)
        .filter((candidate) => (candidate.generationParameters?.audioOperation || "speech") === "voice-clone")
        .map(toVoiceCloneCandidate)
        .filter((candidate): candidate is VoiceCloneCandidateConfig => Boolean(candidate));
    if (!candidates.length) throw new VoiceProfileServiceError("管理员尚未配置可用的声音克隆渠道", 503);

    let source;
    try {
        source = await inspectVoiceProfileSource(userId, sourceAssetToken);
    } catch (error) {
        if (error instanceof VoiceProfileSourceError) throw new VoiceProfileServiceError(error.message, error.status);
        throw error;
    }
    try {
        const { profile, task } = await createVoiceProfileBundle({
            userId,
            name,
            sourceStorageKey: source.storageKey,
            sourceMimeType: source.mimeType,
            sourceDurationSeconds: source.durationSeconds,
            consentVersion: CONSENT_VERSION,
            consentedAt: new Date().toISOString(),
            clientRequestId,
            taskConfig: { candidates },
        });
        await scheduleGenerationTask("voice-clone", task.id, {
            executionPhase: "created",
            nextPollAt: Date.now(),
            channelId: task.config.channelId,
            provider: "dflop",
        });
        return publicVoiceProfile(profile);
    } catch (error) {
        await deleteUserLocalMediaAssets(userId, [source.storageKey]).catch(() => undefined);
        if (error instanceof VoiceProfileIdempotencyConflictError) throw new VoiceProfileServiceError(error.message, 409);
        throw error;
    }
}

export async function renameVoiceProfile(userId: string, profileId: string, name: unknown) {
    const profile = await getVoiceProfileForUser(userId, profileId);
    if (!profile || profile.status === "deleted") throw new VoiceProfileServiceError("声音档案不存在", 404);
    const updated = await updateVoiceProfile(profile.id, { name: requiredText(name, 120, "请填写声音名称") });
    if (!updated) throw new VoiceProfileServiceError("声音档案不存在", 404);
    return publicVoiceProfile(updated);
}

export async function deleteVoiceProfile(userId: string, profileId: string) {
    const profile = await getVoiceProfileForUser(userId, profileId);
    if (!profile || profile.status === "deleted") throw new VoiceProfileServiceError("声音档案不存在", 404);
    if (profile.status === "pending") throw new VoiceProfileServiceError("声音仍在克隆中，暂时无法删除", 409);
    if (profile.status === "deleting") throw new VoiceProfileServiceError("声音正在删除，请稍后刷新", 409);
    if (!profile.providerVoiceId) {
        const deleted = await updateVoiceProfile(profile.id, { status: "deleted", deletedAt: new Date().toISOString(), error: "" });
        if (!deleted) throw new VoiceProfileServiceError("声音档案不存在", 404);
        await deleteUserLocalMediaAssets(userId, [profile.sourceStorageKey, profile.previewStorageKey || ""]).catch(() => undefined);
        return publicVoiceProfile(deleted);
    }
    const cloneTask = await getVoiceCloneTask(profile.cloneTaskId);
    if (!cloneTask || cloneTask.config.channelId !== profile.channelId || !cloneTask.config.deletePath) throw new VoiceProfileServiceError("当前声音缺少上游删除配置，请联系管理员", 409);
    const deletion = await createVoiceDeleteTask(profile, cloneTask.config);
    await scheduleGenerationTask("voice-clone", deletion.task.id, { executionPhase: "created", nextPollAt: Date.now(), channelId: deletion.task.config.channelId, provider: "dflop" });
    return publicVoiceProfile(deletion.profile);
}

function toVoiceCloneCandidate(candidate: ReturnType<typeof resolveLogicalModelCandidates>[number]): VoiceCloneCandidateConfig | null {
    const config = toSystemGenerationChannel(candidate);
    const advanced = config.advancedConfig;
    const createPath = advanced?.createPath?.trim() || "";
    const queryPath = advanced?.queryPath?.trim() || "";
    const requestTemplate = advanced?.requestTemplate?.trim() || "";
    if (!createPath || !queryPath || !requestTemplate || config.capabilityProfile?.supportsIdempotency !== true) return null;
    return {
        channelId: candidate.channelId,
        logicalModel: candidate.logicalModelId,
        upstreamModel: candidate.upstreamModel,
        baseUrl: config.baseUrl,
        createPath,
        queryPath,
        ...(advanced?.catalogPath ? { catalogPath: advanced.catalogPath } : {}),
        ...(advanced?.deletePath ? { deletePath: advanced.deletePath } : {}),
        requestTemplate,
        ...(advanced?.resultField ? { resultField: advanced.resultField } : {}),
        ...(advanced?.statusField ? { statusField: advanced.statusField } : {}),
        timeoutMs: resolveModelRequestTimeoutMs(config, "audio"),
        capabilityProfile: config.capabilityProfile,
        usagePricing: config.usagePricing,
    };
}

function requiredText(value: unknown, maxLength: number, message: string) {
    const normalized = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
    if (!normalized) throw new VoiceProfileServiceError(message);
    return normalized;
}
