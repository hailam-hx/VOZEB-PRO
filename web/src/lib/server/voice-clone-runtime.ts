import { finishGenerationAttempt, startGenerationAttempt } from "@/lib/server/generation-attempt";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { maintenanceWorkerHeaders } from "@/lib/server/maintenance-auth";
import { deleteUserLocalMediaAssets } from "@/lib/server/local-media-storage";
import { buildProviderRequest, isProviderBusinessError, providerTaskPath, readProviderError, readProviderString } from "@/lib/server/provider-task-config";
import { createSignedReferenceAssetUrl } from "@/lib/server/reference-asset-access";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError, generationSubmissionResponseError, generationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { generationSystemAiUsageContext } from "@/lib/server/generation-usage-context";
import { systemAiBillingHeaders } from "@/lib/server/system-ai-billing";
import { attachSystemAiUsageUpstreamTask, finalizeUsageBillingForBusiness } from "@/lib/server/usage-billing-runtime";
import { finalizeVoiceDeleteTask, getVoiceCloneTask, getVoiceProfile, transitionVoiceCloneTask, updateVoiceCloneTask, updateVoiceProfile, type VoiceCloneCandidateConfig, type VoiceCloneTask } from "@/lib/server/voice-profile-store";

export type VoiceCloneUpstreamStep = { state: "pending"; status: string; upstreamTaskId: string } | { state: "completed"; status: string } | { state: "failed"; status: string; error: string };

export async function createVoiceCloneUpstreamStep(task: VoiceCloneTask, origin: string, publicOrigin: string, workerUserId = ""): Promise<VoiceCloneUpstreamStep> {
    const current = await getVoiceCloneTask(task.id);
    if (!current || current.status === "cancelled") return { state: "failed", status: "cancelled", error: "任务已取消" };
    const running = current.status === "pending" ? await transitionVoiceCloneTask(current, ["pending"], { status: "running" }) : current;
    if (!running) return { state: "failed", status: "conflict", error: "声音克隆任务状态已变化" };
    if (running.operation === "delete") return deleteVoiceCloneUpstreamStep(running, origin, workerUserId);
    if (running.upstream?.id) return queryVoiceCloneUpstreamStep(running, origin, workerUserId);
    const profile = await getVoiceProfile(running.voiceProfileId);
    if (!profile || profile.userId !== running.userId || profile.status !== "pending") return { state: "failed", status: "profile_invalid", error: "声音档案状态无效" };

    const candidates = [running.config, ...(running.candidateConfigs || [])];
    let attempts = running.attempts || [];
    let latestError = "没有可用的声音克隆渠道";
    for (const [index, config] of candidates.entries()) {
        const existingAttempt = index === 0 ? attempts.find((attempt) => attempt.attemptNo === running.attemptNo && attempt.status === "running") : undefined;
        const started = existingAttempt ? { attempt: existingAttempt, attempts } : startGenerationAttempt(attempts, { channelId: config.channelId, model: config.logicalModel, capability: "audio" });
        attempts = started.attempts;
        const candidate = { ...running, config, candidateConfigs: candidates.slice(index + 1), attempts, attemptNo: started.attempt.attemptNo, upstream: undefined };
        await updateVoiceCloneTask(task.id, { config, candidateConfigs: candidate.candidateConfigs, attempts, attemptNo: candidate.attemptNo, upstream: undefined });
        await scheduleGenerationTask("voice-clone", task.id, { executionPhase: "submitting", nextPollAt: Date.now(), channelId: config.channelId, provider: "dflop", lastUpstreamStatus: "submitting" });
        try {
            const sourceUrl = createSignedReferenceAssetUrl(profile.sourceStorageKey, publicOrigin, running.createdAt, config.timeoutMs);
            if (!sourceUrl) throw new GenerationSubmissionSafeFailure("站点尚未配置可供上游读取的声音样本地址");
            const values = { model: config.upstreamModel, name: profile.name, audio_url: sourceUrl, audioUrl: sourceUrl, audio: sourceUrl, audios: [sourceUrl], async: true };
            const payload = buildProviderRequest(config.requestTemplate, values, values);
            const idempotencyKey = `voice-clone-task:${task.id}:attempt:${candidate.attemptNo || 1}`;
            const response = await providerFetch(candidate, origin, config.createPath, workerUserId, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "idempotency-key": idempotencyKey,
                    "x-client-request-id": idempotencyKey,
                    ...systemAiBillingHeaders(config.logicalModel, generationSystemAiUsageContext(pricedConfig(config), "audio", idempotencyKey, task.userId) || idempotencyKey, config.upstreamModel),
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(config.timeoutMs),
            });
            if (!response.ok) throw generationSubmissionResponseError(response.status, await responseError(response));
            let data: unknown;
            try {
                data = await response.json();
            } catch {
                throw new GenerationSubmissionUncertainError("声音克隆接口返回了无效 JSON，创建结果待确认");
            }
            if (isProviderBusinessError(data)) throw new GenerationSubmissionSafeFailure(readProviderError(data) || "声音克隆接口返回失败");
            const trace = providerTrace(response.headers);
            const status = providerStatus(data, config);
            const billing = readBilling(response.headers);
            if (billing.pointsRecordId) await updateVoiceCloneTask(task.id, { billing: { pointsCost: billing.pointsCost || 0, pointsRecordId: billing.pointsRecordId, refunded: false } });
            if (FAILED.has(status)) throw new GenerationSubmissionSafeFailure(readProviderError(data) || "声音克隆失败");
            const providerVoiceId = readProviderString(data, config.resultField, VOICE_ID_KEYS);
            const resourceVoiceId = readProviderString(data, undefined, ["id"]);
            if (READY.has(status)) {
                const readyVoiceId = providerVoiceId || resourceVoiceId;
                if (!readyVoiceId) throw new GenerationSubmissionUncertainError("声音克隆已完成但没有返回声音 ID");
                return completeVoiceClone(candidate, profile.id, readyVoiceId, status, trace, billing);
            }
            if (!status && providerVoiceId) return completeVoiceClone(candidate, profile.id, providerVoiceId, "completed", trace, billing);
            const upstreamTaskId = readProviderString(data, undefined, TASK_ID_KEYS);
            if (!upstreamTaskId) throw new GenerationSubmissionUncertainError("声音克隆接口没有返回声音或任务 ID，创建结果待确认");
            await attachSystemAiUsageUpstreamTask(response.headers, upstreamTaskId);
            await updateVoiceCloneTask(task.id, { upstream: { id: upstreamTaskId, createPath: config.createPath }, attempts: trace ? withTrace(attempts, candidate.attemptNo || 1, trace) : attempts });
            if (resourceVoiceId) await updateVoiceProfile(profile.id, { channelId: config.channelId, providerVoiceId: resourceVoiceId, upstreamStatus: status || "submitted", providerTrace: trace });
            return { state: "pending", status: status || "submitted", upstreamTaskId };
        } catch (error) {
            if (!(error instanceof GenerationSubmissionSafeFailure)) throw generationSubmissionUncertainError(error, "声音克隆任务创建结果未知");
            latestError = toSafeGenerationErrorMessage(error, "声音克隆失败");
            attempts = finishGenerationAttempt(attempts, candidate.attemptNo || 1, { status: "failed", error: latestError });
            await updateVoiceCloneTask(task.id, { attempts, candidateConfigs: candidate.candidateConfigs, attemptNo: candidate.attemptNo, upstream: undefined });
        }
    }
    return { state: "failed", status: "failed", error: latestError };
}

export async function queryVoiceCloneUpstreamStep(task: VoiceCloneTask, origin: string, workerUserId = ""): Promise<VoiceCloneUpstreamStep> {
    if (!task.upstream?.id) return { state: "failed", status: "missing_upstream_id", error: "声音克隆任务缺少上游任务 ID" };
    const response = await providerFetch(task, origin, providerTaskPath(task.config.queryPath, task.upstream.id), workerUserId, { cache: "no-store", signal: AbortSignal.timeout(task.config.timeoutMs) });
    if (!response.ok) throw new Error(await responseError(response));
    const data = (await response.json()) as unknown;
    const status = providerStatus(data, task.config);
    const trace = providerTrace(response.headers);
    if (FAILED.has(status)) return { state: "failed", status, error: readProviderError(data) || "声音克隆失败" };
    const providerVoiceId = readProviderString(data, task.config.resultField, VOICE_ID_KEYS);
    if (READY.has(status)) {
        const readyVoiceId = providerVoiceId || readProviderString(data, undefined, ["id"]) || task.upstream.id;
        return completeVoiceClone(task, task.voiceProfileId, readyVoiceId, status, trace, readBilling(response.headers));
    }
    if (!status && providerVoiceId) return completeVoiceClone(task, task.voiceProfileId, providerVoiceId, "completed", trace, readBilling(response.headers));
    return { state: "pending", status: status || "processing", upstreamTaskId: task.upstream.id };
}

export async function markVoiceCloneFailed(task: VoiceCloneTask, error: string) {
    const current = (await getVoiceCloneTask(task.id)) || task;
    if (current.status === "success" || current.status === "cancelled") return current;
    const safeError = toSafeGenerationErrorMessage(error, "声音克隆失败").slice(0, 500);
    const attempts = finishGenerationAttempt(current.attempts || [], current.attemptNo || 1, { status: "failed", error: safeError });
    const failed =
        current.operation === "delete"
            ? (await finalizeVoiceDeleteTask(current, { status: "error", error: safeError, attempts }))?.task || null
            : await transitionVoiceCloneTask(current, ["pending", "running"], { status: "error", error: safeError, attempts, candidateConfigs: [] });
    if (current.operation !== "delete") await updateVoiceProfile(current.voiceProfileId, { status: "failed", error: safeError });
    await finalizeUsageBillingForBusiness({ userId: current.userId, businessId: `voice-clone-task:${current.id}` });
    return failed;
}

async function deleteVoiceCloneUpstreamStep(task: VoiceCloneTask, origin: string, workerUserId: string): Promise<VoiceCloneUpstreamStep> {
    const profile = await getVoiceProfile(task.voiceProfileId);
    const providerVoiceId = task.providerVoiceId || profile?.providerVoiceId;
    if (profile?.userId === task.userId && profile.status === "deleted") {
        const finalized = await finalizeVoiceDeleteTask(task, { status: "success", attempts: task.attempts || [], providerTrace: profile.providerTrace });
        return finalized ? { state: "completed", status: "deleted" } : { state: "failed", status: "delete_conflict", error: "声音档案删除状态已变化" };
    }
    if (profile?.userId === task.userId && profile.status === (task.deletePreviousStatus || "ready") && profile.error) {
        const finalized = await finalizeVoiceDeleteTask(task, { status: "error", attempts: task.attempts || [], error: profile.error });
        return { state: "failed", status: "delete_failed", error: finalized?.profile.error || profile.error };
    }
    if (!profile || profile.userId !== task.userId || profile.status !== "deleting" || profile.channelId !== task.config.channelId || !providerVoiceId || !task.config.deletePath) {
        return { state: "failed", status: "profile_invalid", error: "声音档案删除状态无效" };
    }
    const existingAttempt = task.attempts?.find((attempt) => attempt.attemptNo === task.attemptNo && attempt.status === "running");
    const started = existingAttempt ? { attempt: existingAttempt, attempts: task.attempts || [] } : startGenerationAttempt(task.attempts, { channelId: task.config.channelId, model: task.config.logicalModel, capability: "audio" });
    await updateVoiceCloneTask(task.id, { attempts: started.attempts, attemptNo: started.attempt.attemptNo });
    const path = voiceDeletePath(task.config.deletePath, providerVoiceId);
    let response: Response;
    try {
        response = await providerFetch({ ...task, attempts: started.attempts, attemptNo: started.attempt.attemptNo }, origin, path, workerUserId, { method: "DELETE", signal: AbortSignal.timeout(task.config.timeoutMs) });
    } catch (error) {
        throw generationSubmissionUncertainError(error, "声音删除结果未知");
    }
    const upstreamConfirmedNotFound = response.status === 404 && response.headers.get("x-vozeb-pro-upstream-response") === "1";
    if (!response.ok && !upstreamConfirmedNotFound) {
        const error = toSafeGenerationErrorMessage(await responseError(response), "声音删除失败");
        const attempts = finishGenerationAttempt(started.attempts, started.attempt.attemptNo, { status: "failed", error, ...(providerTrace(response.headers) ? { providerTrace: providerTrace(response.headers) } : {}) });
        await finalizeVoiceDeleteTask(task, { status: "error", attempts, error });
        return { state: "failed", status: "delete_failed", error };
    }
    const trace = providerTrace(response.headers);
    const attempts = finishGenerationAttempt(started.attempts, started.attempt.attemptNo, { status: "succeeded", ...(trace ? { providerTrace: trace } : {}) });
    const finalized = await finalizeVoiceDeleteTask(task, { status: "success", attempts, providerTrace: trace });
    if (!finalized) return { state: "failed", status: "delete_conflict", error: "声音档案删除状态已变化" };
    await deleteUserLocalMediaAssets(profile.userId, [profile.sourceStorageKey, profile.previewStorageKey || ""]).catch(() => undefined);
    return { state: "completed", status: "deleted" };
}

async function completeVoiceClone(task: VoiceCloneTask, profileId: string, providerVoiceId: string, status: string, trace: string, billing: { pointsCost?: number; pointsRecordId?: string }) {
    const current = (await getVoiceCloneTask(task.id)) || task;
    const attempts = finishGenerationAttempt(current.attempts || task.attempts || [], current.attemptNo || task.attemptNo || 1, {
        status: "succeeded",
        pointsCost: billing.pointsCost,
        pointsRecordId: billing.pointsRecordId,
        ...(trace ? { providerTrace: trace } : {}),
    });
    await updateVoiceCloneTask(task.id, { providerVoiceId, attempts, candidateConfigs: [], billing: billing.pointsRecordId ? { pointsCost: billing.pointsCost || 0, pointsRecordId: billing.pointsRecordId, refunded: false } : current.billing });
    await updateVoiceProfile(profileId, { status: "ready", channelId: task.config.channelId, providerVoiceId, upstreamStatus: status, providerTrace: trace, error: "" });
    await transitionVoiceCloneTask(current, ["pending", "running"], { status: "success", providerVoiceId, attempts, candidateConfigs: [] });
    await finalizeUsageBillingForBusiness({ userId: task.userId, businessId: `voice-clone-task:${task.id}` });
    return { state: "completed", status } as const;
}

function providerFetch(task: VoiceCloneTask, origin: string, path: string, workerUserId: string, init: RequestInit) {
    const url = `${origin}${task.config.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers);
    if (workerUserId) Object.entries(maintenanceWorkerHeaders(workerUserId)).forEach(([key, value]) => headers.set(key, value));
    if (init.method !== "POST") Object.entries(systemAiBillingHeaders(task.config.logicalModel, undefined, task.config.upstreamModel)).forEach(([key, value]) => headers.set(key, value));
    return fetchInternalApi(url, { ...init, headers });
}

function pricedConfig(config: VoiceCloneCandidateConfig) {
    return { model: config.upstreamModel, logicalModel: config.logicalModel, channelId: config.channelId, capabilityProfile: config.capabilityProfile, usagePricing: config.usagePricing };
}

function providerStatus(data: unknown, config: VoiceCloneCandidateConfig) {
    return readProviderString(data, config.statusField, STATUS_KEYS).toLowerCase();
}

function providerTrace(headers: Headers) {
    return sanitizeProviderTrace(headers.get("x-gateway-trace") || "");
}

export function sanitizeProviderTrace(value: string) {
    return value
        .trim()
        .slice(0, 1_000)
        .replace(/https?:\/\/\S+/gi, "[redacted-url]")
        .replace(/\b(api[-_ ]?key|authorization|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .replace(/[\r\n\t]+/g, " ")
        .trim();
}

function voiceDeletePath(template: string, providerVoiceId: string) {
    const encoded = encodeURIComponent(providerVoiceId);
    return template.replace(/\{\{\s*(?:voiceId|voice_id)\s*\}\}|\{(?:voiceId|voice_id)\}|:(?:voiceId|voice_id)\b/gi, encoded);
}

function withTrace(attempts: NonNullable<VoiceCloneTask["attempts"]>, attemptNo: number, trace: string) {
    return attempts.map((attempt) => (attempt.attemptNo === attemptNo ? { ...attempt, providerTrace: trace } : attempt));
}

function readBilling(headers: Headers) {
    const raw = headers.get("x-vozeb-pro-points-cost");
    const pointsCost = raw === null ? undefined : Number(raw);
    return { pointsCost: pointsCost !== undefined && Number.isFinite(pointsCost) && pointsCost >= 0 ? pointsCost : undefined, pointsRecordId: headers.get("x-vozeb-pro-points-record-id") || undefined };
}

async function responseError(response: Response) {
    const value = await response.text();
    try {
        return readProviderError(JSON.parse(value)) || `声音克隆请求失败（${response.status}）`;
    } catch {
        return value.trim().slice(0, 500) || `声音克隆请求失败（${response.status}）`;
    }
}

const TASK_ID_KEYS = ["task_id", "taskId", "job_id", "jobId", "generation_id", "generationId", "id"];
const VOICE_ID_KEYS = ["voice_id", "voiceId", "speaker_id", "speakerId"];
const STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
const FAILED = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired"]);
const READY = new Set(["ready", "completed", "complete", "success", "succeeded"]);
