import type { CreativeRunEvent } from "@/lib/creative-runtime-contract";
import { toSafeGenerationErrorMessage } from "./generation-errors";
import type { AgentRun, AgentRunTask } from "./agent-run-store";
import { isAppLocale } from "@/i18n/config";
import { agentRunCopy } from "@/lib/agent-run-copy";
import { classifyVideoProviderPublicError } from "@/lib/server/video-provider-response";
import { hasInsufficientPointsError } from "@/lib/creative-generation-status";
import { DEFAULT_CHANNEL_CONNECT_ERROR } from "./generation-errors";

const permanentTaskErrorCodes = new Set([
    "INSUFFICIENT_BALANCE",
    "UNSUPPORTED_CAPABILITY",
    "INVALID_ASSET",
    "REFERENCE_ASSET_UNAVAILABLE",
    "REFERENCE_IMAGE_REQUIRED",
    "UPSTREAM_BAD_REQUEST",
    "SUBMISSION_UNKNOWN",
    "MEDIA_DOWNLOAD_TIMEOUT",
    "PERSIST_FAILED",
    "manual_model_unavailable_or_incompatible",
    "image_size_below_provider_minimum",
    "video_input_copyright_restricted",
    "video_reference_duration_exceeded",
    "video_reference_aspect_ratio_unsupported",
    "video_output_sensitive_content",
    "video_text_too_long",
]);
const transientTaskErrorCodes = new Set(["RATE_LIMIT", "REQUEST_TIMEOUT", "NETWORK_ERROR", "UPSTREAM_UNAVAILABLE", "UPSTREAM_GATEWAY_ERROR"]);

export function publicAgentTaskRetryable(task: Pick<AgentRunTask, "error" | "errorCode" | "retryable">) {
    const code = classifyAgentTaskPublicError(task.error, task.errorCode);
    if (permanentTaskErrorCodes.has(code || "") || code?.startsWith("QUALITY_")) return false;
    if (task.retryable === false) return false;
    return task.retryable === true || transientTaskErrorCodes.has(code || "") ? true : undefined;
}

export function publicAgentRun(run: AgentRun) {
    const failure = publicAgentRunFailure(run);
    return {
        id: run.id,
        conversationId: run.conversationId,
        inputMessageId: run.inputMessageId,
        assistantMessageId: run.assistantMessageId,
        surface: run.surface,
        projectId: run.projectId,
        status: run.status,
        ...(failure ? { failure } : {}),
        ...(run.responseKind === "conversation" ? { responseKind: run.responseKind, conversationReply: run.conversationReply } : {}),
        prompt: run.publicPrompt || run.prompt,
        referencedAssetIds: run.referencedAssetIds || [],
        selectedSkillIds: run.selectedSkillIds,
        requestedModelIds: run.requestedModelIds,
        generationPreferences: run.generationPreferences,
        assetIds: run.assetIds || [],
        tasks: (run.tasks || []).map(publicAgentRunTask),
        cancellation: run.cancellation ? { pendingCount: run.cancellation.pendingChildTaskIds.length } : undefined,
        timings: run.timings,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
    };
}

export function publicAgentRunSnapshot(run: AgentRun) {
    const value = publicAgentRun(run);
    return {
        id: value.id,
        status: value.status,
        ...("failure" in value ? { failure: value.failure } : {}),
        tasks: value.tasks,
        cancellation: value.cancellation,
        timings: value.timings,
        ...(value.responseKind === "conversation" ? { responseKind: value.responseKind, conversationReply: value.conversationReply } : {}),
        updatedAt: value.updatedAt,
    };
}

export function publicAgentRunFailure(run: AgentRun) {
    if (run.status !== "failed") return undefined;
    if (hasInsufficientPointsError(run.plannerFailure?.message)) return { errorCode: "INSUFFICIENT_BALANCE", retryable: false };
    if (/文本预留缺少可证明的最大输出 token|文本模型缺少最大输出 token 配置|Claude 文本模型缺少后台配置的最大输出 token/.test(run.plannerFailure?.message || "")) {
        return { errorCode: "TEXT_OUTPUT_LIMIT_UNCONFIGURED", retryable: false };
    }
    if (run.planningFinalization?.retryable === false) return { errorCode: "PLANNING_UNAVAILABLE", retryable: false };
    const code = classifyAgentTaskPublicError(run.plannerFailure?.message);
    if (code && transientTaskErrorCodes.has(code)) return { errorCode: code, retryable: true };
    return undefined;
}

export function publicAgentRunEvent(event: CreativeRunEvent): CreativeRunEvent {
    if (event.type === "task.text.updated" || event.type === "task.attempt.started") {
        const { runId, taskId, parentTaskId, attemptId, revision, content, status } = recordValue(event.data);
        return { ...event, data: { runId, taskId, parentTaskId, attemptId, revision, content, status } };
    }
    if (event.type.startsWith("run.review.")) return { ...event, data: undefined };
    if (event.type === "run.failed") {
        const data = recordValue(event.data);
        return { ...event, data: { message: data.partialConversation === true && textValue(data.message) ? textValue(data.message) : agentRunCopy(isAppLocale(data.responseLocale) ? data.responseLocale : undefined).failed } };
    }
    if (event.type === "task.dispatch.failed" || event.type === "task.failed" || event.type === "task.child.failed" || event.type === "task.waiting") {
        const data = recordValue(event.data);
        const rawError = textValue(data.error);
        const errorCode = classifyAgentTaskPublicError(rawError, textValue(data.errorCode));
        const safeData: Record<string, unknown> = {};
        for (const key of ["runId", "taskId", "childTaskId", "parentTaskId", "status", "title", "completedCount", "failedCount", "totalCount"] as const) {
            if (typeof data[key] === "string" || typeof data[key] === "number") safeData[key] = data[key];
        }
        return {
            ...event,
            data: {
                ...safeData,
                ...(rawError && event.type !== "task.waiting" ? { error: publicTaskErrorMessage(rawError, errorCode) } : {}),
                ...(errorCode ? { errorCode } : {}),
            },
        };
    }
    if (event.type === "run.cancel.pending") return { ...event, data: { pendingCount: arrayValue(recordValue(event.data).pendingTaskIds).length } };
    if (event.type === "canvas.ops") {
        const data = recordValue(event.data);
        return { ...event, data: { ...(textValue(data.reply) ? { reply: textValue(data.reply) } : {}), ops: publicCanvasOps(arrayValue(data.ops)) } };
    }
    return event;
}

function publicAgentRunTask(task: AgentRunTask) {
    const optimizedPrompt = task.optimizedPrompt?.trim() || publicPromptFromExecutionPrompt(task.prompt);
    const errorCode = classifyAgentTaskPublicError(task.error, task.errorCode);
    return {
        id: task.id,
        title: task.title,
        type: task.type,
        model: task.model,
        optimizedPrompt: optimizedPrompt || undefined,
        ratio: task.ratio,
        quality: task.quality,
        seconds: task.seconds,
        voice: task.voice,
        format: task.format,
        generateAudio: task.generateAudio,
        watermark: task.watermark,
        speed: task.speed,
        count: task.count,
        status: task.status,
        ...(task.type === "text" ? { activeAttemptId: task.activeAttemptId, textRevision: task.textRevision, textStatus: task.textStatus, visibleTextSnapshot: task.visibleTextSnapshot } : {}),
        error: task.error ? publicTaskErrorMessage(task.error, errorCode) : undefined,
        errorCode,
        retryable: publicAgentTaskRetryable(task),
    };
}

function classifyAgentTaskPublicError(message: string | undefined, code?: string) {
    const normalized = message?.trim() || "";
    if (hasInsufficientPointsError(normalized) || code === "INSUFFICIENT_BALANCE") return "INSUFFICIENT_BALANCE";
    if (code === "reference_url_not_public" || /参考素材.*(?:无法访问|不可访问|公网)|reference (?:url|asset).*(?:not public|inaccessible)/i.test(normalized)) return "REFERENCE_ASSET_UNAVAILABLE";
    if (code && (permanentTaskErrorCodes.has(code) || transientTaskErrorCodes.has(code) || /^QUALITY_[A-Z0-9_]+$/.test(code))) return code;
    if (code === "RATE_LIMIT" || /(?:\b429\b|rate limit|too many requests|请求过于频繁)/i.test(normalized)) return "RATE_LIMIT";
    if (code === "provider_timeout" || /(?:timeout|timed out|超时)/i.test(normalized)) return "REQUEST_TIMEOUT";
    if (code === "provider_unavailable" || /(?:provider unavailable|上游服务暂时不可用)/i.test(normalized)) return "UPSTREAM_UNAVAILABLE";
    if (toSafeGenerationErrorMessage(normalized, "") === DEFAULT_CHANNEL_CONNECT_ERROR) return "NETWORK_ERROR";
    if (/^当前模型暂不可用/.test(normalized)) return "UPSTREAM_UNAVAILABLE";
    if (/^手动选择的模型「.+」当前不可用或不支持已保存的生成参数$/.test(normalized)) return "manual_model_unavailable_or_incompatible";
    if (/parameter [`']?size[`']?.+image size must be at least \d+ pixels/i.test(normalized)) return "image_size_below_provider_minimum";
    return normalized ? classifyVideoProviderPublicError({ message: normalized }) : undefined;
}

function publicTaskErrorMessage(raw: string, code?: string) {
    if (code === "INSUFFICIENT_BALANCE") return "积分不足";
    if (code === "NETWORK_ERROR") return DEFAULT_CHANNEL_CONNECT_ERROR;
    if (code) return "生成任务失败";
    const safe = toSafeGenerationErrorMessage(raw, "生成任务失败");
    return safe === DEFAULT_CHANNEL_CONNECT_ERROR || safe === "生成接口响应超时，请稍后重试或检查模型服务。" ? safe : "生成任务失败";
}

function publicPromptFromExecutionPrompt(prompt: string | undefined) {
    if (!prompt) return "";
    const markers = ["\n\n统一创作约束：", "\n\n执行以下已选 Skill 约束：", "\n\n严格输出要求：", "\n\n基于画布已有节点进行局部修改：", "\n\n使用已引用创作资产：", "\n\n请保持与以下已完成产物一致，并将依赖媒体作为真实生成参考："];
    const boundary = markers.reduce((earliest, marker) => {
        const index = prompt.indexOf(marker);
        return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
    }, -1);
    return boundary >= 0 ? prompt.slice(0, boundary).trim() : "";
}

function publicCanvasOps(value: unknown[]) {
    const ops = value.map(recordValue);
    const internalNodeIds = new Set(ops.flatMap((op) => (op.type === "add_node" && (op.nodeType === "brief" || op.nodeType === "brand-kit") && typeof op.id === "string" ? [op.id] : [])));
    return ops
        .filter((op) => {
            if (typeof op.id === "string" && internalNodeIds.has(op.id)) return false;
            if (op.type === "connect_nodes" && ((typeof op.fromNodeId === "string" && internalNodeIds.has(op.fromNodeId)) || (typeof op.toNodeId === "string" && internalNodeIds.has(op.toNodeId)))) return false;
            return true;
        })
        .map((op) => {
            const metadata = recordValue(op.metadata);
            if (!Object.keys(metadata).length) return op;
            const { prompt: _prompt, agentBrief: _agentBrief, brandKit: _brandKit, foundation: _foundation, review: _review, resolvedPrompt: _resolvedPrompt, ...publicMetadata } = metadata;
            return { ...op, metadata: publicMetadata };
        });
}

function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
