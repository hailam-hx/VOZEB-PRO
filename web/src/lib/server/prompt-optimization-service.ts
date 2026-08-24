import { getAuthSettings } from "@/lib/auth/store";
import { CREATE_AGENT_PROMPT_MAX_LENGTH } from "@/lib/create-agent-prompt";
import type { CreativeGenerationMode } from "@/lib/creative-runtime-contract";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { systemAiTextUsageContext } from "@/lib/server/generation-usage-context";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { systemAiBillingHeaders, systemAiIdempotencyKey, systemAiUsageRequestFingerprint } from "@/lib/server/system-ai-billing";
import { rankTextPlanningCandidates, requestStructuredText, TextPlanningRequestError } from "@/lib/server/text-planning-runtime";
import { finishSystemAiTextAttempt, resolveSystemAiTextFailure } from "@/lib/server/usage-billing-runtime";

type PromptOptimizationMode = "agent" | CreativeGenerationMode;

export class PromptOptimizationError extends Error {
    constructor(
        message: string,
        readonly status = 502,
    ) {
        super(message);
        this.name = "PromptOptimizationError";
    }
}

export async function optimizeCreativePrompt(input: { origin: string; cookie: string; userId: string; requestId: string; prompt: string; mode: PromptOptimizationMode }) {
    const settings = await getAuthSettings();
    const model = settings.defaultModels.textModel;
    const candidates = resolveLogicalModelCandidates(settings, "text", model);
    if (!model || !candidates.length) throw new PromptOptimizationError("后台尚未配置可用的默认文本模型", 503);

    const businessRequestId = systemAiIdempotencyKey("prompt-optimize", input.userId, input.requestId);
    const requestFingerprint = systemAiUsageRequestFingerprint({ userId: input.userId, businessRequestId, logicalModel: model, capability: "text", payload: { prompt: input.prompt, mode: input.mode, tool: promptOptimizationTool.name } });
    let latestError: unknown;
    const ranked = rankTextPlanningCandidates(candidates);
    for (const [index, candidate] of ranked.entries()) {
        const attemptNumber = index + 1;
        const usageContext = systemAiTextUsageContext({ candidate, userId: input.userId, logicalModelId: model, businessRequestId, requestFingerprint, attemptNumber });
        try {
            const call = await requestStructuredText({
                origin: input.origin,
                cookie: input.cookie,
                candidate,
                messages: [
                    { role: "system", content: promptOptimizationInstruction(input.mode) },
                    { role: "user", content: input.prompt },
                ],
                tool: promptOptimizationTool,
                headers: {
                    "Content-Type": "application/json",
                    ...systemAiBillingHeaders(model, usageContext, candidate.upstreamModel),
                },
                onInvalidResponse: (headers) => finishSystemAiTextAttempt(headers, { status: "failed" }),
            });
            const optimizedPrompt = parseOptimizedPrompt(call.arguments);
            if (!optimizedPrompt) {
                await finishSystemAiTextAttempt(call.headers, { status: "failed" });
                throw new PromptOptimizationError("默认文本模型没有返回有效提示词");
            }
            await finishSystemAiTextAttempt(call.headers, { status: "succeeded" });
            return optimizedPrompt;
        } catch (error) {
            latestError = error;
            const resolution = await resolveSystemAiTextFailure({
                userId: input.userId,
                businessId: businessRequestId,
                reason: error instanceof Error ? error.message : "提示词优化请求状态未知",
                final: false,
                currentAttempt: { attemptNumber, acceptance: error instanceof TextPlanningRequestError ? error.requestAcceptance : "response" },
            });
            if (resolution.state !== "safe_to_failover") throw error;
        }
    }
    await resolveSystemAiTextFailure({ userId: input.userId, businessId: businessRequestId, reason: latestError instanceof Error ? latestError.message : "提示词优化失败", final: true });
    throw new PromptOptimizationError(toSafeGenerationErrorMessage(latestError, "提示词优化失败，请稍后重试"));
}

function promptOptimizationInstruction(mode: PromptOptimizationMode) {
    const target = mode === "image" ? "图片" : mode === "video" ? "视频" : mode === "audio" ? "音频" : "创作";
    return `你是 VOZEB PRO 提示词编辑器。把用户原文改写为清晰、紧凑、可直接发送的中文${target}提示词。保留主体、人名、品牌、数量、尺寸、比例、时长、文字内容、参考素材要求和否定要求；不得改变用户意图，不得虚构事实或添加用户没有要求的复杂设定。只返回优化后的公开提示词，不解释修改过程，不输出内部规划、模型选择理由或思维链。`;
}

function parseOptimizedPrompt(value: string) {
    try {
        const payload = JSON.parse(value) as { optimizedPrompt?: unknown };
        const prompt = typeof payload.optimizedPrompt === "string" ? payload.optimizedPrompt.trim() : "";
        return prompt && prompt.length <= CREATE_AGENT_PROMPT_MAX_LENGTH ? prompt : "";
    } catch {
        return "";
    }
}

const promptOptimizationTool = {
    name: "optimize_creative_prompt",
    description: "将用户原文整理为可直接发送的公开创作提示词",
    parameters: {
        type: "object",
        properties: {
            optimizedPrompt: { type: "string", minLength: 1, maxLength: CREATE_AGENT_PROMPT_MAX_LENGTH },
        },
        required: ["optimizedPrompt"],
        additionalProperties: false,
    },
};
