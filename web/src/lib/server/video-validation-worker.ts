import type { VideoValidationItem } from "@/lib/video-validation";
import { getFreshAuthSettings } from "@/lib/auth/store";
import { toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { createPostgresRepositories, getDatabaseProvider } from "@/lib/server/database";
import { maintenanceWorkerContext } from "@/lib/server/maintenance-auth";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { createUpstream } from "@/lib/server/video-generation-application";
import { queryVideoTaskUpstream } from "@/lib/server/video-task-runtime";
import { requestUpstreamGenerationCancellation } from "@/lib/server/generation-task-cancellation-service";
import type { VideoTask } from "@/lib/server/video-task-store";
import type { VideoGenerationReference } from "@/lib/video-reference-contract";
import { videoPollingPolicy } from "@/lib/server/provider-task-config";
import { resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { buildVideoValidationPreview } from "@/lib/server/video-validation-service";
import { validationFixtureUrl } from "@/lib/server/video-validation-fixtures";
import { postDflopSpecialVideoStep, submitDflopSpecialVideoSteps } from "@/lib/server/dflop-special-video-worker";
import { buildValidationExecutionSnapshot, type ValidationFingerprintV1 } from "@/lib/server/video-validation-fingerprint";
import { canonicalJson } from "@/lib/server/video-validation-fingerprint";

type SubmitResult = { taskId: string; status: string; resultUrl?: string };
type QueryResult = { status: "pending" | "running" | "completed" | "failed"; resultUrl?: string; actualCostHotxCredits?: string; errorCode?: string; errorMessage?: string; retryAfterMs?: number };
type WorkerDependencies = {
    submit: (input: { item: VideoValidationItem; idempotencyKey: string }) => Promise<SubmitResult>;
    query: (input: { item: VideoValidationItem; providerTaskId: string }) => Promise<QueryResult>;
    cancel: (input: { item: VideoValidationItem; providerTaskId: string }) => Promise<{ supported: boolean; status?: string }>;
    saveSubmittedTask: (itemId: string, input: { providerTaskId: string; providerStatus: string; submittedAt: string; nextAttemptAt: string }) => Promise<unknown>;
    saveSubmissionUncertain?: (itemId: string, nextAttemptAt: string, errorMessage?: string) => Promise<unknown>;
    savePolling?: (itemId: string, providerStatus: string, nextAttemptAt: string) => Promise<unknown>;
    saveItemTerminal: (
        itemId: string,
        input: {
            status: "passed" | "failed" | "cancelled";
            providerStatus?: string;
            actualCostHotxCredits?: string;
            actualCostProvenance?: Record<string, unknown>;
            noChargeProof?: string;
            resultSummary?: Record<string, unknown>;
            errorCode?: string;
            errorMessage?: string;
            testedAt: string;
        },
    ) => Promise<unknown>;
    now: () => string;
};

type BatchDependencies = {
    claimNextItems: (input: { workerId: string; now: string; leaseUntil: string; limit: number }) => Promise<VideoValidationItem[]>;
    reserveItemBudget: (input: { runId: string; itemId: string; executionSnapshotHash: string; now: string }) => Promise<"RESERVED" | "BUDGET_EXCEEDED" | "SNAPSHOT_CHANGED" | "NOT_ELIGIBLE">;
    processItem: (item: VideoValidationItem) => Promise<{ status: string; providerTaskId?: string }>;
    skipItem: (itemId: string, reasonCode: string, testedAt: string) => Promise<unknown>;
    aggregateRun: (runId: string) => Promise<unknown>;
    now: () => string;
};

export async function processVideoValidationBatchWithDependencies(input: { workerId: string; limit: number }, dependencies: BatchDependencies) {
    const now = dependencies.now();
    const leaseUntil = new Date(new Date(now).getTime() + 4 * 60_000).toISOString();
    const items = await dependencies.claimNextItems({ workerId: input.workerId, now, leaseUntil, limit: input.limit });
    let processed = 0;
    let skippedBudget = 0;
    const runIds = new Set<string>();
    for (const item of items) {
        runIds.add(item.runId);
        if (item.status === "queued") {
            const reserved = await dependencies.reserveItemBudget({ runId: item.runId, itemId: item.id, executionSnapshotHash: item.executionSnapshotHash || "", now });
            if (reserved !== "RESERVED") {
                await dependencies.skipItem(item.id, reserved === "BUDGET_EXCEEDED" ? "SKIPPED_BUDGET_EXHAUSTED" : reserved, now);
                skippedBudget += 1;
                continue;
            }
        }
        await dependencies.processItem({ ...item, status: item.status === "queued" ? "reserved" : item.status });
        processed += 1;
    }
    await Promise.all([...runIds].map((runId) => dependencies.aggregateRun(runId)));
    return { claimed: items.length, processed, skippedBudget };
}

export async function processVideoValidationItem(item: VideoValidationItem, dependencies: WorkerDependencies) {
    let providerTaskId = item.providerTaskId;
    if (!providerTaskId) {
        if (item.submissionStartedAt || item.status === "submission_unknown" || item.reasonCode === "SUBMISSION_UNCERTAIN") {
            await dependencies.saveSubmissionUncertain?.(item.id, dependencies.now(), "创建结果不明确，需要按上游任务或幂等键人工核对");
            return { status: "submission_unknown" } as const;
        }
        let submitted: SubmitResult;
        try {
            submitted = await dependencies.submit({ item, idempotencyKey: item.idempotencyKey });
        } catch (error) {
            if (isSubmissionUncertain(error) && dependencies.saveSubmissionUncertain) {
                const nextAttemptAt = dependencies.now();
                await dependencies.saveSubmissionUncertain(item.id, nextAttemptAt, sanitizeError(error instanceof Error ? error.message : String(error)));
                return { status: "submission_unknown" } as const;
            }
            throw error;
        }
        providerTaskId = submitted.taskId;
        const now = dependencies.now();
        await dependencies.saveSubmittedTask(item.id, { providerTaskId, providerStatus: submitted.status, submittedAt: now, nextAttemptAt: now });
        if (submitted.resultUrl) {
            await dependencies.saveItemTerminal(item.id, { status: "passed", providerStatus: submitted.status, resultSummary: { hasResult: true }, testedAt: dependencies.now() });
            return { status: "passed", providerTaskId } as const;
        }
    }
    const result = await dependencies.query({ item, providerTaskId });
    if (result.status === "pending" || result.status === "running") {
        const current = dependencies.now();
        const nextAttemptAt = result.retryAfterMs ? new Date(new Date(current).getTime() + result.retryAfterMs).toISOString() : current;
        await dependencies.savePolling?.(item.id, result.status, nextAttemptAt);
        return { status: result.status, providerTaskId } as const;
    }
    const testedAt = dependencies.now();
    if (result.status === "completed" && result.resultUrl) {
        await dependencies.saveItemTerminal(item.id, {
            status: "passed",
            providerStatus: result.status,
            ...(result.actualCostHotxCredits ? { actualCostHotxCredits: result.actualCostHotxCredits, actualCostProvenance: { source: "QUERY_RESULT", field: "actualCostHotxCredits", providerTaskId, observedAt: testedAt } } : {}),
            resultSummary: { hasResult: true },
            testedAt,
        });
        return { status: "passed", providerTaskId } as const;
    }
    await dependencies.saveItemTerminal(item.id, { status: "failed", providerStatus: result.status, errorCode: result.errorCode || "UPSTREAM_REJECTED", errorMessage: sanitizeError(result.errorMessage), testedAt });
    return { status: "failed", providerTaskId } as const;
}

export async function processVideoValidationBatch(input: { origin: string; workerId: string; limit: number }) {
    if (getDatabaseProvider() !== "postgres") return { claimed: 0, processed: 0, skippedBudget: 0 };
    const repository = createPostgresRepositories().videoValidation;
    return processVideoValidationBatchWithDependencies(input, {
        claimNextItems: (claim) => repository.claimNextItems(claim),
        reserveItemBudget: (reservation) => repository.reserveItemBudget(reservation),
        skipItem: (itemId, reasonCode, testedAt) => repository.skipItem(itemId, reasonCode, testedAt),
        processItem: async (item) => processProductionItem(item, input.origin, repository),
        aggregateRun: (runId) => repository.aggregateRunFromItems(runId, new Date().toISOString()),
        now: () => new Date().toISOString(),
    });
}

async function processProductionItem(item: VideoValidationItem, publicOrigin: string, repository: ReturnType<typeof createPostgresRepositories>["videoValidation"]) {
    try {
        const dependencies: WorkerDependencies = {
            submit: ({ item: current, idempotencyKey }) => submitProductionItem(current, publicOrigin, idempotencyKey),
            query: ({ item: current, providerTaskId }) => queryProductionItem(current, publicOrigin, providerTaskId),
            cancel: ({ item: current, providerTaskId }) => cancelProductionItem(current, publicOrigin, providerTaskId),
            saveSubmittedTask: (itemId, value) => repository.saveSubmittedTask(itemId, value),
            saveSubmissionUncertain: (itemId, nextAttemptAt, errorMessage) => repository.saveSubmissionUncertain(itemId, nextAttemptAt, errorMessage),
            savePolling: (itemId, status, nextAttemptAt) => repository.savePolling(itemId, status, nextAttemptAt),
            saveItemTerminal: (itemId, value) => repository.saveItemTerminal(itemId, value),
            now: () => new Date().toISOString(),
        };
        return item.reasonCode === "CANCEL_REQUESTED" ? await cancelVideoValidationItem(item, dependencies) : await processVideoValidationItem(item, dependencies);
    } catch (error) {
        if (item.providerTaskId) {
            if (error instanceof Error && error.message === "VALIDATION_RUNTIME_CONFIG_MISSING") {
                await repository.saveSubmissionUncertain(item.id, new Date().toISOString(), "已提交任务的渠道或绑定配置缺失，需要人工核对终态与费用");
                return { status: "submission_unknown" as const };
            }
            const interval = videoPollingPolicy(false).intervalMs;
            await repository.savePolling(item.id, "query_error", new Date(Date.now() + interval).toISOString());
            return { status: "polling" as const };
        }
        if (error instanceof Error && ["VALIDATION_EXECUTION_SNAPSHOT_CHANGED", "VALIDATION_RUNTIME_CONFIG_MISSING"].includes(error.message)) {
            try {
                await repository.finalizeItem(item.id, { status: "failed", errorCode: "RUNTIME_CONTRACT_CHANGED", noChargeProof: "NO_SUBMISSION_STARTED", testedAt: new Date().toISOString() });
                return { status: "failed" as const };
            } catch {
                // A concurrent submission marker means the provider outcome must be reconciled.
            }
        }
        await repository.saveSubmissionUncertain(item.id, new Date().toISOString(), sanitizeError(error instanceof Error ? error.message : String(error)));
        return { status: "submission_unknown" as const };
    }
}

async function validationRuntime(item: VideoValidationItem, allowInactive = false) {
    const settings = await getFreshAuthSettings();
    const logicalModel = settings.logicalModels.find((model) => model.id === item.logicalModelId && (allowInactive || model.enabled) && model.capability === "video");
    const binding = logicalModel?.bindings.find((candidate) => candidate.id === item.bindingId && (allowInactive || candidate.enabled) && candidate.channelId === item.channelId && candidate.upstreamModel === item.upstreamModelId);
    const channel = settings.systemChannels.find((candidate) => candidate.id === item.channelId && (allowInactive || candidate.enabled));
    if (!logicalModel || !binding || !channel || !item.normalizedContext) throw new Error("VALIDATION_RUNTIME_CONFIG_MISSING");
    const config = toSystemGenerationChannel({ logicalModelId: logicalModel.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, logicalModel, binding, generationParameters: binding.generationParameters });
    return { settings, config, context: item.normalizedContext, channel };
}

async function submitProductionItem(item: VideoValidationItem, publicOrigin: string, idempotencyKey: string) {
    const runtime = await validationRuntime(item);
    const current = await buildVideoValidationPreview({
        request: { mode: "all_models_minimum", modelIds: [item.logicalModelId], bindingIds: [item.bindingId], maxBudgetHotxCredits: "0", concurrency: 1, readyPricingOnly: true },
        logicalModels: runtime.settings.logicalModels,
        channels: runtime.settings.systemChannels,
        pricingPolicyVersion: runtime.settings.pricingPolicy.version,
    });
    const previewItem = current.items.find((candidate) => candidate.bindingId === item.bindingId && candidate.caseId === item.caseId);
    if (!previewItem?.liveSelected || !previewItem.normalizedContext || !previewItem.fingerprintHash || !previewItem.fingerprintSnapshot || !previewItem.requestPayloadDigest || !item.executionSnapshotHash)
        throw new Error("VALIDATION_EXECUTION_SNAPSHOT_CHANGED");
    const currentSnapshot = buildValidationExecutionSnapshot({
        fingerprint: { fingerprintVersion: 1, fingerprintHashAlgorithm: "sha256", fingerprintHash: previewItem.fingerprintHash, fingerprintSnapshot: previewItem.fingerprintSnapshot as unknown as ValidationFingerprintV1 },
        bindingId: item.bindingId,
        channelId: item.channelId,
        normalizedContext: previewItem.normalizedContext,
        pricingRevision: previewItem.pricingRevision,
        conversionRevision: runtime.settings.pricingPolicy.version,
        requestPayloadDigest: previewItem.requestPayloadDigest,
        idempotencyKey,
    });
    if (currentSnapshot.hash !== item.executionSnapshotHash || canonicalJson(previewItem.normalizedContext) !== canonicalJson(item.normalizedContext)) throw new Error("VALIDATION_EXECUTION_SNAPSHOT_CHANGED");
    const repository = createPostgresRepositories().videoValidation;
    if (!(await repository.markSubmissionStarted(item.id, item.executionSnapshotHash, new Date().toISOString()))) throw new Error("VALIDATION_SUBMISSION_ALREADY_STARTED");
    if (runtime.context.special) {
        try {
            return await submitDflopSpecialVideoSteps({
                steps: runtime.context.special.steps,
                expectedDigest: item.requestPayloadDigest || "",
                idempotencyKey,
                send: (step, key) => postDflopSpecialVideoStep({ baseUrl: runtime.channel.baseUrl, apiKey: runtime.channel.apiKey, step, idempotencyKey: key }),
            });
        } catch (error) {
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), { outcome: "unknown" as const });
        }
    }
    const references = validationReferences(runtime.context.references);
    let upstream: Awaited<ReturnType<typeof createUpstream>>;
    try {
        upstream = await createUpstream(
            "video-validation-worker",
            resolveInternalOrigin(publicOrigin),
            maintenanceWorkerContext("video-validation-worker"),
            runtime.config,
            "A simple static scene with gentle natural motion.",
            { size: runtime.context.aspectRatio, vquality: runtime.context.resolution, videoSeconds: runtime.context.durationSeconds, videoGenerateAudio: runtime.context.generateAudio, videoWatermark: runtime.context.watermark },
            references,
            runtime.settings.generationPointMultipliers,
            item.id,
            "",
            1,
            "",
            { mode: "validation", idempotencyKey, validationItemId: item.id, expectedPayloadDigest: item.requestPayloadDigest },
        );
    } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { outcome: "unknown" as const });
    }
    return { taskId: upstream.id, status: upstream.resultUrl ? "completed" : "pending", resultUrl: upstream.resultUrl };
}

async function queryProductionItem(item: VideoValidationItem, publicOrigin: string, providerTaskId: string) {
    const runtime = await validationRuntime(item, true);
    const task = validationVideoTask(item, runtime.config, providerTaskId);
    const result = await queryVideoTaskUpstream(task, resolveInternalOrigin(publicOrigin), "", "video-validation-worker", { mode: "validation", validationItemId: item.id });
    if (result.state === "pending") return { status: "pending" as const, retryAfterMs: videoPollingPolicy(Boolean(resolveGlobalAiOpcPreset(runtime.config.advancedConfig, runtime.config.model))).intervalMs };
    if (result.state === "failed") return { status: "failed" as const, errorCode: "UPSTREAM_REJECTED", errorMessage: result.error };
    return { status: "completed" as const, resultUrl: result.resultUrl };
}

async function cancelProductionItem(item: VideoValidationItem, publicOrigin: string, providerTaskId: string) {
    const runtime = await validationRuntime(item, true);
    const result = await requestUpstreamGenerationCancellation(
        { type: "video", taskId: item.id, userId: "video-validation-worker", executionPhase: "submitted", upstreamTaskId: providerTaskId, config: runtime.config },
        resolveInternalOrigin(publicOrigin),
        "",
        "video-validation-worker",
        { mode: "validation", validationItemId: item.id },
    );
    return { supported: result !== "unsupported" && result !== "not_submitted", status: result };
}

function validationVideoTask(item: VideoValidationItem, config: Awaited<ReturnType<typeof validationRuntime>>["config"], providerTaskId: string): VideoTask {
    const now = Date.now();
    return {
        id: item.id,
        userId: "video-validation-worker",
        status: "running",
        createdAt: now,
        updatedAt: now,
        config,
        upstream: { id: providerTaskId, provider: "generation", model: item.upstreamModelId, pollPath: config.advancedConfig?.createPath },
        requestedDurationSeconds: Number(item.normalizedContext?.durationSeconds || 0),
    };
}

function validationReferences(references: NonNullable<VideoValidationItem["normalizedContext"]>["references"]): VideoGenerationReference[] {
    return references.map((reference) => {
        const url = validationFixtureUrl(reference);
        if (!url || !/^https:\/\//i.test(url)) throw new Error(`缺少 ${reference.fixture} 验收素材 URL 配置`);
        return { type: reference.fixture, role: reference.role, url };
    });
}

export async function cancelVideoValidationItem(item: VideoValidationItem, dependencies: WorkerDependencies) {
    if (!item.providerTaskId) {
        if (item.submissionStartedAt) {
            await dependencies.saveSubmissionUncertain?.(item.id, dependencies.now(), "取消时创建结果不明确，需要人工核对是否产生费用");
            return { status: "submission_unknown" } as const;
        }
        await dependencies.saveItemTerminal(item.id, { status: "cancelled", errorCode: "CANCELLED_BEFORE_SUBMIT", noChargeProof: "NO_SUBMISSION_STARTED", testedAt: dependencies.now() });
        return { status: "cancelled" } as const;
    }
    const result = await dependencies.cancel({ item, providerTaskId: item.providerTaskId });
    if (!result.supported) {
        await dependencies.savePolling?.(item.id, "cancel_unsupported", dependencies.now());
        return { status: "polling", reasonCode: "CANCEL_UNSUPPORTED" } as const;
    }
    await dependencies.savePolling?.(item.id, "cancel_requested", dependencies.now());
    return { status: "polling", reasonCode: "CANCEL_REQUESTED" } as const;
}

function sanitizeError(value: string | undefined) {
    if (!value) return undefined;
    return value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000);
}

function isSubmissionUncertain(error: unknown): error is Error & { outcome: "unknown" } {
    return error instanceof Error && (error as Error & { outcome?: unknown }).outcome === "unknown";
}
