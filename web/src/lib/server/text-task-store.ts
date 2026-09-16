import { randomUUID } from "node:crypto";

import type { LogicalModelCapabilityProfile, SystemChannelAdvancedConfig } from "@/lib/auth/store";
import type { AiTextMessage } from "@/types/ai";
import { createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask } from "@/lib/server/generation-task-store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";
import { GENERATION_TASK_RETENTION_MS } from "@/lib/server/generation-task-retention";
import type { ResolvedTextProtocolKind } from "@/lib/server/text-protocol-resolver";
import type { TextStreamTransportDiagnostic } from "@/lib/server/text-stream-diagnostics";
import { textTaskBillingBusinessId } from "./generation-usage-context";

type TextTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

export type TextTaskMilestones = Partial<Record<"task_created" | "upstream_started" | "first_byte" | "first_text" | "stream_completed" | "task_completed", number>>;
export type TextTaskUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type TextTaskExecutionContext = { runId?: string; taskId?: string; parentTaskId?: string; attemptId?: string; clientRequestId?: string; attemptNo?: number };
export type TextTaskSnapshot = { attemptId: string; revision: number; content: string; updatedAt: number };
export type TextTaskAttempt = Omit<GenerationAttempt, "status"> & {
    id: string;
    upstreamModel: string;
    status: GenerationAttempt["status"] | "cancelled";
    protocol: ResolvedTextProtocolKind;
    transport: "stream" | "buffered";
    revision: number;
    content: string;
    billingBusinessId?: string;
    usage?: TextTaskUsage;
    milestones: TextTaskMilestones;
    latency?: { firstByteMs?: number; firstTextMs?: number; streamMs?: number; generationMs?: number; finalizationMs?: number; totalMs?: number };
    transportDiagnostic?: TextStreamTransportDiagnostic;
};
export type TextTaskSnapshotUpdate = { content: string; usage?: TextTaskUsage; milestones?: TextTaskMilestones };

export type TextTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    channelId?: string;
    logicalModel?: string;
    capabilityProfile?: LogicalModelCapabilityProfile;
    advancedConfig?: SystemChannelAdvancedConfig;
    systemPrompt?: string;
    usagePricing?: import("@/lib/server/generation-channel").SystemGenerationChannelConfig["usagePricing"];
};

export type TextTask = {
    id: string;
    userId: string;
    status: TextTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: TextTaskConfig;
    messages: AiTextMessage[];
    result?: { content: string };
    upstream?: { id: string; createPath: string };
    billing?: { pointsCost: number; pointsRecordId?: string; refunded: boolean };
    billingCycleId?: string;
    error?: string;
    pointsRemaining?: number;
    candidateConfigs?: TextTaskConfig[];
    attempts?: TextTaskAttempt[];
    attemptNo?: number;
    runId?: string;
    parentTaskId?: string;
    clientRequestId?: string;
    executionContext?: TextTaskExecutionContext;
    activeAttemptId?: string;
    visibleTextSnapshot?: TextTaskSnapshot;
    milestones?: TextTaskMilestones;
};

export async function createTextTask(input: Omit<TextTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const task: TextTask = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    task.executionContext = { ...input.executionContext, taskId: task.id };
    task.milestones = { task_created: now };
    return createStoredGenerationTask("text", task, GENERATION_TASK_RETENTION_MS);
}

export function openTextTaskAttempt(task: TextTask, config: TextTaskConfig, protocol: ResolvedTextProtocolKind, candidateConfigs: TextTaskConfig[]) {
    return mutateStoredGenerationTask<TextTask>("text", task.id, GENERATION_TASK_RETENTION_MS, (current) => {
        if (!["pending", "running"].includes(current.status) || current.billingCycleId !== task.billingCycleId || current.activeAttemptId !== task.activeAttemptId || current.attempts?.some((attempt) => attempt.status === "running")) return null;
        const id = randomUUID();
        const attemptNo = (current.attempts?.length || 0) + 1;
        const attempt: TextTaskAttempt = {
            id,
            attemptNo,
            channelId: config.channelId,
            model: config.logicalModel || config.model,
            upstreamModel: config.model,
            capability: "text",
            status: "running",
            startedAt: Date.now(),
            protocol,
            transport: protocol === "custom" ? "buffered" : "stream",
            revision: 0,
            content: "",
            billingBusinessId: textTaskBillingBusinessId(current),
            milestones: { task_created: current.createdAt },
        };
        return { ...current, config, candidateConfigs, attemptNo, activeAttemptId: id, executionContext: { ...current.executionContext, taskId: current.id, attemptId: id }, attempts: [...(current.attempts || []), attempt] };
    });
}

export function acceptTextTaskSnapshot(id: string, attemptId: string, expectedRevision: number, update: TextTaskSnapshotUpdate) {
    return mutateStoredGenerationTask<TextTask>("text", id, GENERATION_TASK_RETENTION_MS, (task) => {
        const attempt = task.attempts?.find((item) => item.id === attemptId);
        // A cancellation transition may race the final flush; its still-open attempt owns that flush.
        if (task.activeAttemptId !== attemptId || !attempt || attempt.status !== "running" || attempt.revision !== expectedRevision || task.status === "success" || task.status === "error") return null;
        const revision = attempt.revision + 1;
        const next = { ...attempt, ...update, revision, milestones: { ...attempt.milestones, ...update.milestones } };
        return {
            ...task,
            attempts: task.attempts!.map((item) => (item.id === attemptId ? next : item)),
            ...(update.content ? { visibleTextSnapshot: { attemptId, revision, content: update.content, updatedAt: Date.now() } } : {}),
        };
    });
}

export function closeTextTaskAttempt(
    id: string,
    attemptId: string,
    status: Exclude<TextTaskAttempt["status"], "running">,
    patch: Partial<Pick<TextTaskAttempt, "error" | "pointsCost" | "pointsRecordId" | "milestones" | "transportDiagnostic">> = {},
    expectedRevision?: number,
) {
    return mutateStoredGenerationTask<TextTask>("text", id, GENERATION_TASK_RETENTION_MS, (task) => {
        const attempt = task.attempts?.find((item) => item.id === attemptId);
        if (task.activeAttemptId !== attemptId || !attempt || attempt.status !== "running" || (expectedRevision !== undefined && attempt.revision !== expectedRevision)) return null;
        const now = Date.now();
        const milestones = { ...attempt.milestones, ...patch.milestones, task_completed: now };
        const start = milestones.upstream_started ?? attempt.startedAt;
        const next = {
            ...attempt,
            ...patch,
            revision: attempt.revision + 1,
            status,
            completedAt: now,
            milestones,
            latency: {
                firstByteMs: milestones.first_byte === undefined ? undefined : milestones.first_byte - start,
                firstTextMs: milestones.first_text === undefined ? undefined : milestones.first_text - start,
                streamMs: milestones.stream_completed === undefined ? undefined : milestones.stream_completed - start,
                ...(milestones.first_text !== undefined && milestones.stream_completed !== undefined ? { generationMs: milestones.stream_completed - milestones.first_text } : {}),
                ...(milestones.stream_completed !== undefined ? { finalizationMs: now - milestones.stream_completed } : {}),
                totalMs: now - task.createdAt,
            },
        };
        return {
            ...task,
            attempts: task.attempts!.map((item) => (item.id === attemptId ? next : item)),
            ...(attempt.content ? { visibleTextSnapshot: { attemptId, revision: next.revision, content: attempt.content, updatedAt: now } } : {}),
        };
    });
}

export async function getTextTask(id: string) {
    return getStoredGenerationTask<TextTask>("text", id);
}

export async function retryTextTask(task: TextTask, input: Pick<TextTask, "config" | "candidateConfigs" | "messages">): Promise<TextTask | null> {
    return transitionTextTask(
        task,
        ["error"],
        { ...input, status: "pending", result: undefined, error: undefined, upstream: undefined, billing: undefined, pointsRemaining: undefined, billingCycleId: randomUUID(), milestones: { task_created: task.createdAt } },
        {
            executionPhase: "created",
            nextPollAt: Date.now(),
            submittedAt: undefined,
            lastPollAt: undefined,
            upstreamTaskId: undefined,
            channelId: undefined,
            provider: undefined,
            queryPath: undefined,
            resultPayload: undefined,
            lastUpstreamStatus: "retry_requested",
        },
    );
}

export function transitionTextTask(
    task: TextTask,
    allowedStatuses: TextTaskStatus[],
    patch: Partial<Pick<TextTask, "config" | "candidateConfigs" | "messages" | "result" | "error" | "pointsRemaining" | "upstream" | "billing" | "billingCycleId" | "milestones">> & { status: TextTaskStatus },
    executionPatch?: import("@/lib/server/generation-task-scheduler").GenerationTaskSchedulePatch,
) {
    const next = { ...patch, ...(["success", "error", "cancelled"].includes(patch.status) ? { milestones: { ...task.milestones, task_completed: Date.now() } } : {}) };
    const revision = task.attempts?.find((attempt) => attempt.id === task.activeAttemptId)?.revision;
    return transitionStoredGenerationTask<TextTask>(
        "text",
        task.id,
        task.userId,
        allowedStatuses,
        next,
        GENERATION_TASK_RETENTION_MS,
        executionPatch,
        { activeAttemptId: task.activeAttemptId, revision, billingCycleId: task.billingCycleId },
        patch.status === "cancelled",
    );
}

export function touchTextTask(id: string) {
    return touchStoredGenerationTask("text", id, Date.now(), GENERATION_TASK_RETENTION_MS);
}

export function updateTextTask(id: string, patch: Partial<Pick<TextTask, "config" | "candidateConfigs" | "attemptNo" | "upstream" | "billing">>) {
    return mutateStoredGenerationTask<TextTask>("text", id, GENERATION_TASK_RETENTION_MS, (task) => ({ ...task, ...patch }));
}
