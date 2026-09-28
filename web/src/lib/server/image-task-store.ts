import { randomUUID } from "crypto";

import type { LogicalModelCapabilityProfile, LogicalModelGenerationParameters, SystemChannelAdvancedConfig } from "@/lib/auth/store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";
import type { GenerationLogSource } from "@/lib/server/generation-log-store";
import { countActiveStoredGenerationTasks, createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { GENERATION_TASK_RETENTION_MS } from "@/lib/server/generation-task-retention";
import type { ImageQualityIntent, ResolvedImageQualityContext } from "@/lib/image-quality-profile";
import type { GenerationFailure } from "@/lib/server/generation-errors";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import type { PromptAudit } from "@/lib/server/generation-prompt-audit";

type ImageTaskKind = "generation" | "edit";
type ImageTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

export type ImageTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    channelId?: string;
    logicalModel?: string;
    capabilityProfile?: LogicalModelCapabilityProfile;
    generationParameters?: LogicalModelGenerationParameters;
    quality?: string;
    qualityProfileRevision?: string;
    qualityOptionRevision?: string;
    imageQualityContext?: ResolvedImageQualityContext;
    size?: string;
    count?: number;
    systemPrompt?: string;
    promptEnhancementDisabled?: boolean;
    promptAudit?: PromptAudit;
    advancedConfig?: SystemChannelAdvancedConfig;
    usagePricing?: import("@/lib/server/generation-channel").SystemGenerationChannelConfig["usagePricing"];
};

export type ImageTaskReference = {
    id?: string;
    name?: string;
    type?: string;
    dataUrl: string;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
};

export type StoredImageTaskMediaResult = {
    dataUrl: string;
    remoteUrl?: string;
    serverUrl?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export type ImageTask = GenerationTaskContext & {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    kind: ImageTaskKind;
    source: GenerationLogSource;
    title?: string;
    status: ImageTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: ImageTaskConfig;
    prompt: string;
    imageQualityIntent?: ImageQualityIntent;
    references: ImageTaskReference[];
    mask?: ImageTaskReference;
    result?: StoredImageTaskMediaResult & { results?: StoredImageTaskMediaResult[] };
    upstream?: { id: string; mediaBaseUrl: string; pollBaseUrl: string; explicitPollUrl?: string };
    billing?: { pointsCost: number; pointsRecordId?: string; refunded: boolean };
    error?: string;
    failure?: GenerationFailure;
    retryable?: boolean;
    pointsRemaining?: number;
    candidateConfigs?: ImageTaskConfig[];
    attempts?: GenerationAttempt[];
    attemptNo?: number;
};

const TASK_STALE_MS = 3 * 60 * 1000;
export async function createImageTask(input: Omit<ImageTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const task: ImageTask = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    return createStoredGenerationTask("image", task, GENERATION_TASK_RETENTION_MS);
}

export async function getImageTask(id: string) {
    return getStoredGenerationTask<ImageTask>("image", id);
}

export function countActiveImageTasksForUser(userId: string) {
    return countActiveStoredGenerationTasks(userId, "image", TASK_STALE_MS);
}

export function transitionImageTask(
    task: ImageTask,
    allowedStatuses: ImageTaskStatus[],
    patch: Partial<Pick<ImageTask, "result" | "error" | "failure" | "pointsRemaining" | "retryable" | "config" | "billing">> & { status: ImageTaskStatus },
    executionPatch?: import("@/lib/server/generation-task-scheduler").GenerationTaskSchedulePatch,
) {
    return transitionStoredGenerationTask<ImageTask>("image", task.id, task.userId, allowedStatuses, patch, GENERATION_TASK_RETENTION_MS, executionPatch);
}

export function touchImageTask(id: string) {
    return touchStoredGenerationTask("image", id, Date.now(), GENERATION_TASK_RETENTION_MS);
}

export async function updateImageTask(id: string, patch: Partial<Pick<ImageTask, "config" | "candidateConfigs" | "attempts" | "attemptNo" | "upstream" | "billing" | "result" | "failure" | "retryable">>) {
    return mutateStoredGenerationTask<ImageTask>("image", id, GENERATION_TASK_RETENTION_MS, (task) => ({ ...task, ...patch }));
}

export function imageTaskEffectivePrompt(task: Pick<ImageTask, "prompt" | "config">) {
    if (task.config.promptEnhancementDisabled) return task.prompt;
    return task.config.imageQualityContext?.effectivePrompt || task.prompt;
}

export function imageTaskReferencePrompt(task: Pick<ImageTask, "prompt" | "config" | "references">) {
    return task.config.promptEnhancementDisabled ? task.prompt : buildImageReferencePromptText(imageTaskEffectivePrompt(task), task.references);
}

export function imageTaskRequestParameters(task: Pick<ImageTask, "config">) {
    return task.config.imageQualityContext?.requestParameters || {};
}
