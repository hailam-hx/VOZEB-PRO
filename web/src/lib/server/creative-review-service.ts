import { randomUUID } from "node:crypto";

import { getAuthSettings } from "@/lib/auth/store";
import { normalizeCreativeReview, unavailableCreativeReview, type CreativeFoundation, type CreativeMediaType, type CreativeReview } from "@/lib/creative-agent-contract";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { systemAiTextUsageContext } from "@/lib/server/generation-usage-context";
import { resolveLogicalModel } from "@/lib/server/logical-model-router";
import { fetchOptionalResponses } from "@/lib/server/responses-request";
import { TEXT_MODEL_REQUEST_TIMEOUT_MS } from "@/lib/server/model-request-policy";
import { strictJsonObjectText } from "@/lib/server/structured-model-output";
import { systemAiBillingHeaders, systemAiIdempotencyKey, systemAiUsageRequestFingerprint } from "@/lib/server/system-ai-billing";
import { finishSystemAiTextAttempt, resolveSystemAiTextFailure } from "@/lib/server/usage-billing-runtime";

export type CreativeReviewTaskInput = {
    id: string;
    title: string;
    type: CreativeMediaType;
    prompt: string;
    resultSummary: string;
    imageUrls?: string[];
};

type ReviewCall = { arguments: string; headers: Headers };
type ReviewAttempt = { call?: ReviewCall; acceptance: "response" | "unknown" };

export async function reviewCreativeOutputs(input: { origin: string; cookie: string; userId: string; billingId?: string; foundation: CreativeFoundation; tasks: CreativeReviewTaskInput[] }): Promise<CreativeReview> {
    const validTaskIds = new Set(input.tasks.map((task) => task.id));
    const imageInputs = await reviewImages(input.tasks, input.origin, input.cookie);
    const hasTextResult = input.tasks.some((task) => task.type === "text" && task.resultSummary.trim());
    if (!imageInputs.length && !hasTextResult) return unavailableCreativeReview("当前产物没有可供默认文本模型检查的图片或文本内容，生成结果已保留，但本轮未完成视觉复盘。");

    const settings = await getAuthSettings();
    const model = settings.defaultModels.textModel;
    const resolved = resolveLogicalModel(settings, "text", model);
    if (!model || !resolved?.channel) return unavailableCreativeReview("后台没有可用的默认文本模型，生成结果已保留，但本轮未执行自动复盘。");

    const mode = imageInputs.length ? "visual" : "text";
    const system = `你是 VOZEB PRO 创作质检 Agent。${mode === "visual" ? "你必须结合实际图片检查主体、构图、色彩、光线、文字可读性、参考一致性和整套视觉一致性。" : "当前只有文本结果，只能进行文本一致性检查，禁止声称看过图片或视频画面。"}只有存在明确影响使用的问题才返回 needs_revision；一般审美偏好不应触发自动重做。retryTaskIds 只能选择确实需要重做的任务。必须调用 review_creative_outputs，不得暴露隐藏思维链。`;
    const reviewContext = JSON.stringify({ foundation: input.foundation, tasks: input.tasks.map(({ imageUrls: _imageUrls, ...task }) => task), mode });
    const responsesInput = [
        { role: "system", content: system },
        { role: "user", content: [{ type: "input_text", text: reviewContext }, ...imageInputs.map((item) => ({ type: "input_image", image_url: item.url }))] },
    ];
    const chatMessages = [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: reviewContext }, ...imageInputs.map((item) => ({ type: "image_url", image_url: { url: item.url } }))] },
    ];

    const businessRequestId = systemAiIdempotencyKey("creative-review", input.userId, input.billingId || randomUUID());
    const requestFingerprint = systemAiUsageRequestFingerprint({ userId: input.userId, businessRequestId, logicalModel: model, capability: "text", payload: { mode, reviewContext, imageUrls: imageInputs.map((item) => item.url) } });
    const headersForAttempt = (attemptNumber: number) => ({
        "Content-Type": "application/json",
        cookie: input.cookie,
        ...systemAiBillingHeaders(model, systemAiTextUsageContext({ candidate: resolved, userId: input.userId, logicalModelId: model, businessRequestId, requestFingerprint, attemptNumber }), resolved.upstreamModel),
    });
    let activeAttempt = 1;
    try {
        const responses = await callResponses(input.origin, resolved.channel.id, resolved.upstreamModel, responsesInput, headersForAttempt(1));
        let call = responses.call;
        let finalAcceptance = responses.acceptance;
        if (!call) {
            const resolution = await resolveSystemAiTextFailure({
                userId: input.userId,
                businessId: businessRequestId,
                reason: responses.acceptance === "unknown" ? "自动复盘 Responses 请求状态未知" : "自动复盘 Responses 请求失败",
                final: false,
                requestNotReceived: responses.acceptance === "response",
                currentAttempt: { attemptNumber: 1, acceptance: responses.acceptance },
            });
            if (resolution.state !== "safe_to_failover") return unavailableCreativeReview("自动复盘渠道状态待确认，生成结果已保留。");
            activeAttempt = 2;
            const chat = await callChat(input.origin, resolved.channel.id, resolved.upstreamModel, chatMessages, headersForAttempt(2));
            call = chat.call;
            finalAcceptance = chat.acceptance;
        }
        if (!call) {
            await resolveSystemAiTextFailure({
                userId: input.userId,
                businessId: businessRequestId,
                reason: finalAcceptance === "unknown" ? "自动复盘请求状态未知" : "默认文本模型没有返回有效复盘结果",
                final: finalAcceptance === "response",
                requestNotReceived: finalAcceptance === "response",
                currentAttempt: { attemptNumber: activeAttempt, acceptance: finalAcceptance },
            });
            return unavailableCreativeReview("默认文本模型没有返回有效复盘结果，生成结果已保留。");
        }
        let review: CreativeReview | null = null;
        try {
            review = normalizeCreativeReview(JSON.parse(call.arguments), validTaskIds);
        } catch {
            review = null;
        }
        if (review) {
            await finishSystemAiTextAttempt(call.headers, { status: "succeeded" });
            return { ...review, mode };
        }
        await finishSystemAiTextAttempt(call.headers, { status: "failed" });
        await resolveSystemAiTextFailure({ userId: input.userId, businessId: businessRequestId, reason: "默认文本模型返回了无效复盘结构", final: true, currentAttempt: { attemptNumber: activeAttempt, acceptance: "response" } });
        return unavailableCreativeReview("默认文本模型返回了无效复盘结构，生成结果已保留。");
    } catch (error) {
        await resolveSystemAiTextFailure({
            userId: input.userId,
            businessId: businessRequestId,
            reason: error instanceof Error ? error.message : "自动复盘状态未知",
            final: false,
            currentAttempt: { attemptNumber: activeAttempt, acceptance: "unknown" },
        }).catch(() => undefined);
        return unavailableCreativeReview("自动复盘服务暂时不可用，生成结果已保留，可稍后根据实际画面继续调整。");
    }
}

async function callResponses(origin: string, channelId: string, upstreamModel: string, input: unknown[], headers: Record<string, string>): Promise<ReviewAttempt> {
    const response = await fetchOptionalResponses(`${origin}/api/ai/system/${encodeURIComponent(channelId)}/responses`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ model: upstreamModel, input, tools: [reviewTool], tool_choice: { type: "function", name: reviewTool.name } }),
    });
    if (!response) return { acceptance: "unknown" };
    if (!response.ok) return { acceptance: "response" };
    const payload = (await response.json()) as { output?: Array<{ type?: string; name?: string; arguments?: string }> };
    const argumentsText = payload.output?.find((item) => item.type === "function_call" && item.name === reviewTool.name)?.arguments;
    if (argumentsText) return { call: readCall(argumentsText, response.headers), acceptance: "response" };
    await finishSystemAiTextAttempt(response.headers, { status: "failed" });
    return { acceptance: "response" };
}

async function callChat(origin: string, channelId: string, upstreamModel: string, messages: unknown[], headers: Record<string, string>): Promise<ReviewAttempt> {
    let response: Response;
    try {
        response = await fetchInternalApi(`${origin}/api/ai/system/${encodeURIComponent(channelId)}/chat/completions`, {
            method: "POST",
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(TEXT_MODEL_REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
                model: upstreamModel,
                messages,
                tools: [{ type: "function", function: { name: reviewTool.name, description: reviewTool.description, parameters: reviewTool.parameters } }],
                tool_choice: { type: "function", function: { name: reviewTool.name } },
            }),
        });
    } catch {
        return { acceptance: "unknown" };
    }
    if (!response.ok) return { acceptance: "response" };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    const message = payload.choices?.[0]?.message;
    const argumentsText = message?.tool_calls?.find((item) => item.function?.name === reviewTool.name)?.function?.arguments || strictJsonObjectText(message?.content);
    if (argumentsText) return { call: readCall(argumentsText, response.headers), acceptance: "response" };
    await finishSystemAiTextAttempt(response.headers, { status: "failed" });
    return { acceptance: "response" };
}

async function reviewImages(tasks: CreativeReviewTaskInput[], origin: string, cookie: string) {
    const candidates = tasks.flatMap((task) => (task.imageUrls || []).map((url) => ({ taskId: task.id, url })));
    const images = await Promise.all(candidates.map(async (item) => ({ ...item, url: await normalizeReviewImage(item.url, origin, cookie) })));
    return images.filter((item): item is { taskId: string; url: string } => Boolean(item.url));
}

async function normalizeReviewImage(value: string, origin: string, cookie: string) {
    const url = value.trim();
    if (/^data:image\//i.test(url)) return url.length <= 12_000_000 ? url : "";
    if (/^https:\/\//i.test(url)) return url;
    if (!url.startsWith("/api/")) return "";
    try {
        const response = await fetchInternalApi(`${origin}${url}`, { headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const contentType = response.headers.get("content-type")?.split(";")[0] || "";
        const length = Number(response.headers.get("content-length") || 0);
        if (!response.ok || !contentType.startsWith("image/") || length > 8_000_000) return "";
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 8_000_000) return "";
        return `data:${contentType};base64,${bytes.toString("base64")}`;
    } catch {
        return "";
    }
}

function readCall(argumentsText: string, headers: Headers): ReviewCall {
    return { arguments: argumentsText, headers };
}

const reviewTool = {
    type: "function",
    name: "review_creative_outputs",
    description: "检查真实创作产物与简报、视觉方向和参考策略的一致性",
    parameters: {
        type: "object",
        properties: {
            mode: { type: "string", enum: ["visual", "text", "unavailable"] },
            status: { type: "string", enum: ["passed", "needs_revision", "unavailable"] },
            score: { type: "number", minimum: 0, maximum: 100 },
            summary: { type: "string" },
            issues: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        taskId: { type: "string" },
                        category: { type: "string" },
                        severity: { type: "string", enum: ["low", "medium", "high"] },
                        message: { type: "string" },
                        correction: { type: "string" },
                    },
                    required: ["category", "severity", "message"],
                    additionalProperties: false,
                },
            },
            retryTaskIds: { type: "array", items: { type: "string" } },
        },
        required: ["mode", "status", "summary", "issues", "retryTaskIds"],
        additionalProperties: false,
    },
};
