import type { AdminGenerationAttempt, AdminGenerationChannel, AdminGenerationOperationsPayload, AdminGenerationTask } from "@/lib/admin-generation-operations";
import { findPublicUserIdsByKeyword, getAuthSettings, getPublicUsersByIds } from "@/lib/auth/store";
import { getChannelRuntimeHealth, isChannelRuntimeCooling } from "@/lib/server/channel-runtime-health";
import {
    generationTaskPointsCost,
    listStoredGenerationTaskRecords,
    listStoredGenerationTaskRecordsByRunIds,
    summarizeStoredAgentPerformance,
    type GenerationTaskRecordListOptions,
    type StoredGenerationTaskRecord,
} from "@/lib/server/generation-task-store";
import { getTextPlanningRuntime } from "@/lib/server/text-planning-runtime";
import { getDatabaseProvider } from "@/lib/server/database";
import { listAgentRuntimeTraces } from "@/lib/server/agent-runtime-repository";
import { createProviderHealthService } from "@/lib/server/provider-health-store";
import { resolvedProviderRouteIdentity } from "@/lib/server/provider-health-runtime";

export async function listAdminGenerationOperations(options: GenerationTaskRecordListOptions): Promise<AdminGenerationOperationsPayload> {
    const settingsPromise = getAuthSettings();
    const searchUserIds = options.search?.trim() && getDatabaseProvider() === "file" ? await findPublicUserIdsByKeyword(options.search) : [];
    const [result, agentPerformance] = await Promise.all([listStoredGenerationTaskRecords({ ...options, searchUserIds, includeAll: false }), summarizeStoredAgentPerformance({ ...options, searchUserIds })]);
    const agentRunIds = result.items.filter((record) => record.type === "agent").map((record) => record.id);
    const pageUserIds = Array.from(new Set(result.items.map((record) => record.userId)));
    const [settings, users, childRecords, agentTraces] = await Promise.all([settingsPromise, getPublicUsersByIds(pageUserIds), listStoredGenerationTaskRecordsByRunIds(agentRunIds, pageUserIds), listAgentRuntimeTraces(agentRunIds)]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const childrenByRunId = new Map<string, StoredGenerationTaskRecord[]>();
    for (const child of childRecords) {
        if (!child.runId) continue;
        childrenByRunId.set(child.runId, [...(childrenByRunId.get(child.runId) || []), child]);
    }
    const [items, channels] = await Promise.all([Promise.resolve(result.items.map((record) => taskSummary(record, usersById.get(record.userId), childrenByRunId.get(record.id) || [], agentTraces.get(record.id)))), channelSummaries(settings)]);
    return {
        items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        summary: result.summary,
        channels,
        agentPerformance,
    };
}

function taskSummary(record: StoredGenerationTaskRecord, user?: { accountId: string; username: string; displayName: string }, childRecords: StoredGenerationTaskRecord[] = [], agentTasks?: AdminGenerationTask["agentTasks"]): AdminGenerationTask {
    const payload = record.payload;
    const config = object(payload.config);
    const upstream = object(payload.upstream);
    const plannerAudit = agentPlannerAudit(payload.plannerAudit);
    const plannerAttempts = agentPlannerAttempts(payload.plannerAttempts);
    const latestPlannerAttempt = plannerAttempts?.at(-1);
    const plannerFailure = agentPlannerFailure(payload.plannerFailure);
    const planningFinalization = agentPlanningFinalization(payload.planningFinalization);
    const failureStage = agentFailureStage(payload.failureStage);
    const agentTiming = record.type === "agent" ? agentRuntimeTiming(payload.timings) : undefined;
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.map(object) : [];
    const failedTask = tasks.find((task) => task.status === "failed" && text(task.id));
    const model = firstText(
        plannerAudit?.logicalModelId,
        latestPlannerAttempt?.logicalModelId,
        payload.logicalModelId,
        payload.model,
        config.logicalModel,
        config.model,
        config.imageModel,
        config.videoModel,
        config.audioModel,
        upstream.model,
        tasks.find((task) => text(task.model))?.model,
    );
    const ownPointsCost = generationTaskPointsCost(payload);
    const childPointsCost = childRecords.reduce((total, child) => total + generationTaskPointsCost(child.payload), 0);
    const pointsBreakdown =
        record.type === "agent"
            ? {
                  planner: roundedPoints(plannerAudit?.pointsCost ?? ownPointsCost),
                  childTasks: roundedPoints(childPointsCost),
                  total: roundedPoints((plannerAudit?.pointsCost ?? ownPointsCost) + childPointsCost),
              }
            : undefined;
    const pointsCost = pointsBreakdown?.total ?? roundedPoints(ownPointsCost);
    return {
        id: record.id,
        userId: record.userId,
        accountId: user?.accountId,
        username: user?.username || "",
        displayName: user?.displayName || user?.username || "用户信息不可用",
        type: record.type,
        status: record.status,
        surface: record.surface,
        conversationId: record.conversationId,
        runId: record.runId,
        projectId: record.projectId,
        parentTaskId: record.parentTaskId,
        attemptNo: record.attemptNo,
        model,
        channelId: firstText(plannerAudit?.channelId, latestPlannerAttempt?.channelId, payload.channelId, config.channelId, upstream.channelId),
        provider: record.provider,
        queryPath: record.queryPath,
        executionPhase: record.executionPhase,
        workerId: record.workerId,
        leaseUntil: record.leaseUntil,
        lastHeartbeatAt: record.lastHeartbeatAt,
        nextPollAt: record.nextPollAt,
        lastPollAt: record.lastPollAt,
        leaseExpired: isGenerationLeaseExpired(record),
        upstreamTaskId: record.upstreamTaskId || firstText(upstream.id) || undefined,
        lastUpstreamStatus: record.lastUpstreamStatus,
        attempts: generationAttempts(payload.attempts),
        prompt: firstText(payload.prompt, config.prompt, tasks.find((task) => text(task.prompt))?.prompt).slice(0, 500),
        error: firstText(plannerFailure?.message, payload.error, tasks.find((task) => text(task.error))?.error).slice(0, 1000) || undefined,
        durationMs: Math.max(0, record.updatedAt - record.createdAt),
        pointsCost,
        pointsBreakdown,
        plannerAudit,
        plannerAttempts,
        plannerFailure,
        planningFinalization,
        failureStage,
        agentTiming,
        agentTasks,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        canCancel: record.type !== "voice-clone" && (record.status === "pending" || record.status === "running" || record.status === "paused"),
        retryTaskId: record.type === "agent" ? text(failedTask?.id) || undefined : undefined,
    };
}

export function isGenerationLeaseExpired(record: Pick<StoredGenerationTaskRecord, "status" | "leaseUntil">, now = Date.now()) {
    return (record.status === "pending" || record.status === "running") && typeof record.leaseUntil === "number" && Number.isFinite(record.leaseUntil) && record.leaseUntil <= now;
}

async function channelSummaries(settings: Awaited<ReturnType<typeof getAuthSettings>>): Promise<AdminGenerationChannel[]> {
    const channels = new Map(settings.systemChannels.map((channel) => [channel.id, channel]));
    const providerHealthService = createProviderHealthService();
    return Promise.all(
        settings.logicalModels.flatMap((model) =>
            model.bindings.map(async (binding) => {
                const channel = channels.get(binding.channelId);
                const planning = model.capability === "text" && channel ? getTextPlanningRuntime({ channelId: channel.id, upstreamModel: binding.upstreamModel, channel }) : undefined;
                const providerHealth = model.capability === "text" && channel ? await providerHealthService.get(resolvedProviderRouteIdentity({ channelId: channel.id, upstreamModel: binding.upstreamModel, channel })).catch(() => undefined) : undefined;
                const plannerProviderHealth =
                    model.capability === "text" && channel ? await providerHealthService.get(resolvedProviderRouteIdentity({ channelId: channel.id, upstreamModel: binding.upstreamModel, channel }, "planner")).catch(() => undefined) : undefined;
                return {
                    id: channel?.id || binding.channelId,
                    name: channel?.name || binding.channelId,
                    capability: model.capability,
                    logicalModelId: model.id,
                    logicalModelName: model.name,
                    upstreamModel: binding.upstreamModel,
                    enabled: Boolean(model.enabled && binding.enabled && channel?.enabled),
                    runtimeHealth: providerHealth
                        ? {
                              status: providerHealth.state,
                              consecutiveFailures: providerHealth.consecutiveFailures,
                              cooldownUntil: providerHealth.cooldownUntil,
                              lastFailureClass: providerHealth.lastFailureClass,
                              lastProviderErrorType: providerHealth.lastProviderErrorType,
                              lastProviderErrorCode: providerHealth.lastProviderErrorCode,
                              lastProviderStatus: providerHealth.lastProviderStatus,
                          }
                        : (() => {
                              const health = getChannelRuntimeHealth(channel?.id || binding.channelId, model.capability);
                              return {
                                  status: isChannelRuntimeCooling(channel?.id || binding.channelId, model.capability) ? ("cooling" as const) : ("healthy" as const),
                                  consecutiveFailures: health.consecutiveFailures,
                                  cooldownUntil: health.cooldownUntil,
                                  lastError: health.lastError,
                              };
                          })(),
                    ...(plannerProviderHealth
                        ? {
                              plannerRuntimeHealth: {
                                  status: plannerProviderHealth.state,
                                  consecutiveFailures: plannerProviderHealth.consecutiveFailures,
                                  cooldownUntil: plannerProviderHealth.cooldownUntil,
                                  lastFailureClass: plannerProviderHealth.lastFailureClass,
                                  lastProviderErrorType: plannerProviderHealth.lastProviderErrorType,
                                  lastProviderErrorCode: plannerProviderHealth.lastProviderErrorCode,
                                  lastProviderStatus: plannerProviderHealth.lastProviderStatus,
                              },
                          }
                        : {}),
                    ...(planning
                        ? {
                              planningRuntime: {
                                  protocol: planning.preferred,
                                  successCount: planning.successCount,
                                  failureCount: planning.failureCount,
                                  averageLatencyMs: planning.averageLatencyMs,
                              },
                          }
                        : {}),
                };
            }),
        ),
    );
}

function firstText(...values: unknown[]) {
    return values.map(text).find(Boolean) || "";
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function generationAttempts(value: unknown): AdminGenerationAttempt[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .map((item) => ({
            attemptNo: Number(item.attemptNo) || 0,
            channelId: text(item.channelId) || undefined,
            model: text(item.model),
            ...(text(item.upstreamModel) ? { upstreamModel: text(item.upstreamModel) } : {}),
            status: (item.status === "succeeded" || item.status === "failed" || item.status === "cancelled" ? item.status : "running") as AdminGenerationAttempt["status"],
            startedAt: Number(item.startedAt) || 0,
            completedAt: Number(item.completedAt) || undefined,
            pointsCost: Number(item.pointsCost) > 0 ? Number(item.pointsCost) : undefined,
            error: text(item.error) || undefined,
            providerTrace: text(item.providerTrace) || undefined,
            ...(attemptProtocol(item.protocol) ? { protocol: attemptProtocol(item.protocol) } : {}),
            ...(item.transport === "stream" || item.transport === "buffered" ? { transport: item.transport } : {}),
            ...(attemptUsage(item.usage) ? { usage: attemptUsage(item.usage) } : {}),
            ...(attemptMilestones(item.milestones) ? { milestones: attemptMilestones(item.milestones) } : {}),
            ...(attemptLatency(item.latency) ? { latency: attemptLatency(item.latency) } : {}),
            ...(attemptTransportDiagnostic(item.transportDiagnostic) ? { transportDiagnostic: attemptTransportDiagnostic(item.transportDiagnostic) } : {}),
        }));
}

function attemptTransportDiagnostic(value: unknown): AdminGenerationAttempt["transportDiagnostic"] | undefined {
    const source = object(value);
    const termination = source.connectionTermination;
    if (!["normal_eof", "protocol_terminal", "application_abort", "socket_reset", "body_timeout", "read_error", "provider_error"].includes(String(termination))) return undefined;
    const rootError = diagnosticError(source.rootError);
    const providerError = diagnosticProviderError(source.providerError);
    return {
        connectionTermination: termination as NonNullable<AdminGenerationAttempt["transportDiagnostic"]>["connectionTermination"],
        framesReceived: nonNegativeNumber(source.framesReceived) || 0,
        bytesReceived: nonNegativeNumber(source.bytesReceived) || 0,
        ...(positiveTimestamp(source.lastUpstreamFrameAt) ? { lastUpstreamFrameAt: positiveTimestamp(source.lastUpstreamFrameAt) } : {}),
        ...(positiveTimestamp(source.lastTextDeltaAt) ? { lastTextDeltaAt: positiveTimestamp(source.lastTextDeltaAt) } : {}),
        ...(text(source.finishReason) ? { finishReason: text(source.finishReason).slice(0, 120) } : {}),
        terminalSeen: source.terminalSeen === true,
        doneMarkerSeen: source.doneMarkerSeen === true,
        usageSeen: source.usageSeen === true,
        ...(nonNegativeNumber(source.elapsedMs) !== undefined ? { elapsedMs: nonNegativeNumber(source.elapsedMs) } : {}),
        ...(providerError ? { providerError } : {}),
        ...(rootError ? { rootError } : {}),
    };
}

function diagnosticProviderError(value: unknown): NonNullable<NonNullable<AdminGenerationAttempt["transportDiagnostic"]>["providerError"]> | undefined {
    const source = object(value);
    if (source.kind !== "provider_error") return undefined;
    const status = nonNegativeNumber(source.status);
    return {
        kind: "provider_error",
        ...(text(source.type) ? { type: text(source.type).slice(0, 160) } : {}),
        ...(text(source.code) ? { code: text(source.code).slice(0, 160) } : {}),
        ...(text(source.message) ? { message: text(source.message).slice(0, 500) } : {}),
        ...(status !== undefined && status >= 100 && status <= 599 ? { status } : {}),
    };
}

function diagnosticError(value: unknown): NonNullable<NonNullable<AdminGenerationAttempt["transportDiagnostic"]>["rootError"]> | undefined {
    const source = object(value);
    const cause = object(source.cause);
    const result = {
        ...(text(source.name) ? { name: text(source.name).slice(0, 120) } : {}),
        ...(text(source.message) ? { message: text(source.message).slice(0, 500) } : {}),
        ...(text(source.code) ? { code: text(source.code).slice(0, 120) } : {}),
        ...(typeof source.errno === "string" || typeof source.errno === "number" ? { errno: source.errno } : {}),
        ...(text(source.syscall) ? { syscall: text(source.syscall).slice(0, 120) } : {}),
        ...(Object.keys(cause).length
            ? {
                  cause: {
                      ...(text(cause.name) ? { name: text(cause.name).slice(0, 120) } : {}),
                      ...(text(cause.message) ? { message: text(cause.message).slice(0, 500) } : {}),
                      ...(text(cause.code) ? { code: text(cause.code).slice(0, 120) } : {}),
                      ...(typeof cause.errno === "string" || typeof cause.errno === "number" ? { errno: cause.errno } : {}),
                      ...(text(cause.syscall) ? { syscall: text(cause.syscall).slice(0, 120) } : {}),
                  },
              }
            : {}),
    };
    return Object.keys(result).length ? result : undefined;
}

function attemptProtocol(value: unknown): AdminGenerationAttempt["protocol"] | undefined {
    return value === "responses" || value === "chat" || value === "gemini" || value === "claude" || value === "custom" ? value : undefined;
}

function attemptUsage(value: unknown): AdminGenerationAttempt["usage"] | undefined {
    const source = object(value);
    const usage = { inputTokens: nonNegativeNumber(source.inputTokens), outputTokens: nonNegativeNumber(source.outputTokens), totalTokens: nonNegativeNumber(source.totalTokens) };
    return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

function attemptMilestones(value: unknown): AdminGenerationAttempt["milestones"] | undefined {
    const source = object(value);
    const milestones = {
        task_created: positiveTimestamp(source.task_created),
        upstream_started: positiveTimestamp(source.upstream_started),
        first_byte: positiveTimestamp(source.first_byte),
        first_text: positiveTimestamp(source.first_text),
        stream_completed: positiveTimestamp(source.stream_completed),
        task_completed: positiveTimestamp(source.task_completed),
    };
    return Object.values(milestones).some((item) => item !== undefined) ? milestones : undefined;
}

function attemptLatency(value: unknown): AdminGenerationAttempt["latency"] | undefined {
    const source = object(value);
    const latency = {
        firstByteMs: nonNegativeNumber(source.firstByteMs),
        firstTextMs: nonNegativeNumber(source.firstTextMs),
        streamMs: nonNegativeNumber(source.streamMs),
        generationMs: nonNegativeNumber(source.generationMs),
        finalizationMs: nonNegativeNumber(source.finalizationMs),
        totalMs: nonNegativeNumber(source.totalMs),
    };
    return Object.values(latency).some((item) => item !== undefined) ? latency : undefined;
}

function nonNegativeNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function positiveTimestamp(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function agentPlannerAudit(value: unknown): AdminGenerationTask["plannerAudit"] {
    const source = object(value);
    const mode = source.mode === "direct" || source.mode === "model" ? source.mode : undefined;
    const schemaVersion = Number(source.schemaVersion);
    if (!mode || !Number.isSafeInteger(schemaVersion) || schemaVersion <= 0) return undefined;
    const protocol = source.protocol === "responses" || source.protocol === "chat" || source.protocol === "gemini" || source.protocol === "custom" ? source.protocol : undefined;
    const skills = Array.isArray(source.skills)
        ? source.skills.flatMap((value) => {
              const skill = object(value);
              const id = text(skill.id);
              const name = text(skill.name);
              return id && name
                  ? [
                        {
                            id,
                            name,
                            ...(text(skill.sourceVersion) ? { sourceVersion: text(skill.sourceVersion) } : {}),
                            ...(text(skill.sourceCommit) ? { sourceCommit: text(skill.sourceCommit) } : {}),
                            ...(text(skill.sourceContentHash) ? { sourceContentHash: text(skill.sourceContentHash) } : {}),
                        },
                    ]
                  : [];
          })
        : [];
    return {
        schemaVersion,
        mode,
        ...(text(source.logicalModelId) ? { logicalModelId: text(source.logicalModelId) } : {}),
        ...(text(source.channelId) ? { channelId: text(source.channelId) } : {}),
        ...(text(source.upstreamModel) ? { upstreamModel: text(source.upstreamModel) } : {}),
        ...(protocol ? { protocol } : {}),
        ...(Number.isFinite(Number(source.elapsedMs)) && Number(source.elapsedMs) >= 0 ? { elapsedMs: Number(source.elapsedMs) } : {}),
        ...(Number.isFinite(Number(source.pointsCost)) && Number(source.pointsCost) >= 0 ? { pointsCost: Number(source.pointsCost) } : {}),
        skills,
    };
}

function agentPlannerAttempts(value: unknown): AdminGenerationTask["plannerAttempts"] {
    if (!Array.isArray(value)) return undefined;
    const attempts = value.flatMap((value) => {
        const source = object(value);
        const attemptNo = Number(source.attemptNo);
        const planningCycle = Number(source.planningCycle);
        const logicalModelId = text(source.logicalModelId);
        const channelId = text(source.channelId);
        const upstreamModel = text(source.upstreamModel);
        const status: "running" | "succeeded" | "failed" | undefined = source.status === "running" || source.status === "succeeded" || source.status === "failed" ? source.status : undefined;
        if (!Number.isSafeInteger(attemptNo) || attemptNo <= 0 || !Number.isSafeInteger(planningCycle) || planningCycle <= 0 || !logicalModelId || !channelId || !upstreamModel || !status) return [];
        const protocol: "responses" | "chat" | "gemini" | "custom" | undefined = source.protocol === "responses" || source.protocol === "chat" || source.protocol === "gemini" || source.protocol === "custom" ? source.protocol : undefined;
        const requestAcceptance: "response" | "unknown" | undefined = source.requestAcceptance === "response" || source.requestAcceptance === "unknown" ? source.requestAcceptance : undefined;
        const startedAt = Number(source.startedAt);
        const completedAt = Number(source.completedAt);
        const elapsedMs = Number(source.elapsedMs);
        const firstByteMs = Number(source.firstByteMs);
        const firstContentMs = Number(source.firstContentMs);
        const resultKind: "conversation" | "generation" | undefined = source.resultKind === "conversation" || source.resultKind === "generation" ? source.resultKind : undefined;
        return [
            {
                attemptNo,
                planningCycle,
                logicalModelId,
                channelId,
                upstreamModel,
                ...(protocol ? { protocol } : {}),
                status,
                ...(requestAcceptance ? { requestAcceptance } : {}),
                startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0,
                ...(Number.isFinite(completedAt) && completedAt > 0 ? { completedAt } : {}),
                ...(Number.isFinite(elapsedMs) && elapsedMs >= 0 ? { elapsedMs } : {}),
                ...(Number.isFinite(firstByteMs) && firstByteMs >= 0 ? { firstByteMs } : {}),
                ...(Number.isFinite(firstContentMs) && firstContentMs >= 0 ? { firstContentMs } : {}),
                ...(resultKind ? { resultKind } : {}),
                ...(text(source.error) ? { error: text(source.error).slice(0, 1000) } : {}),
            },
        ];
    });
    return attempts.length ? attempts.toSorted((left, right) => left.attemptNo - right.attemptNo) : undefined;
}

function agentPlanningFinalization(value: unknown): AdminGenerationTask["planningFinalization"] {
    const source = object(value);
    const planningCycle = Number(source.planningCycle);
    const attemptNumber = Number(source.attemptNumber);
    const updatedAt = Number(source.updatedAt);
    const status = source.status === "pending" || source.status === "settled" || source.status === "failed" ? source.status : undefined;
    if (!status || !Number.isSafeInteger(planningCycle) || planningCycle <= 0 || !Number.isSafeInteger(attemptNumber) || attemptNumber <= 0 || !Number.isFinite(updatedAt) || updatedAt <= 0) return undefined;
    return {
        planningCycle,
        status,
        attemptNumber,
        ...(text(source.errorCode) ? { errorCode: text(source.errorCode).slice(0, 120) } : {}),
        ...(text(source.error) ? { error: text(source.error).slice(0, 1000) } : {}),
        ...(typeof source.retryable === "boolean" ? { retryable: source.retryable } : {}),
        updatedAt,
    };
}

function agentFailureStage(value: unknown): AdminGenerationTask["failureStage"] {
    return value === "planning" || value === "planner_settlement" || value === "task_dispatch" || value === "task_execution" ? value : undefined;
}

function agentRuntimeTiming(value: unknown): AdminGenerationTask["agentTiming"] {
    const timings = object(value);
    const elapsed = (start: unknown, end: unknown) => {
        const startAt = positiveTimestamp(start);
        const endAt = positiveTimestamp(end);
        return startAt !== undefined && endAt !== undefined && endAt >= startAt ? endAt - startAt : undefined;
    };
    const result = {
        requestToPlannerUpstreamMs: elapsed(timings.requestAcceptedAt, timings.upstreamRequestStartedAt),
        plannerTtfbMs: elapsed(timings.upstreamRequestStartedAt, timings.upstreamFirstByteAt),
        plannerDurationMs: elapsed(timings.planningStartedAt, timings.planningCompletedAt),
        plannerSettlementMs: elapsed(timings.plannerSettlementStartedAt, timings.plannerSettlementCompletedAt),
        childDispatchMs: elapsed(timings.plannerSettlementCompletedAt || timings.planningCompletedAt, timings.firstTaskSubmittedAt),
    };
    return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

function agentPlannerFailure(value: unknown): AdminGenerationTask["plannerFailure"] {
    const source = object(value);
    const message = text(source.message).slice(0, 1000);
    const failedAt = Number(source.failedAt);
    return message && Number.isFinite(failedAt) && failedAt > 0 ? { message, failedAt } : undefined;
}

function roundedPoints(value: number) {
    return Number(value.toFixed(2));
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
