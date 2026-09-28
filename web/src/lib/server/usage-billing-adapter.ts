import {
    calculateNormalizedUsagePrice,
    calculatePricingReserve,
    countUnicodeCodePoints,
    estimateTextInputTokens,
    estimateVideoTokenCount,
    normalizeBillableUsage,
    validatePricingRateCard,
    type BillableCapability,
    type NormalizedUsage,
    type PricingRateCardV1,
} from "@/lib/billing/pricing";
import { decimal } from "@/lib/billing/decimal";
import { computeSeedanceHoldUsage, estimateSeedanceUsage, type SeedanceFrame, type SeedanceModelFamily } from "@/lib/billing/seedance-usage";
import type { SystemAiVideoBillingContext } from "./system-ai-billing";
import type { SystemAiImageQualityContext } from "./system-ai-billing";
import { normalizeImageQualityProfile, type ImageQualityProfile } from "@/lib/image-quality-profile";
import { createTextSseDecoder } from "./text-sse-decoder";
import { textStreamTerminalStatus } from "./text-stream-protocol";
import { readVideoProviderUsage } from "./video-provider-response";

type ProxyUsageInput = {
    capability: BillableCapability;
    payload: unknown;
    rateCard: PricingRateCardV1;
    inputLimits?: ProxyUsageInputLimits;
};

export type ProxyUsageInputLimits = {
    maxInputTokens?: string;
    maxOutputTokens?: string;
    maxDurationSeconds?: string;
    seedanceModelFamily?: SeedanceModelFamily;
    safeVideoFrame?: SeedanceFrame;
    videoBillingContext?: SystemAiVideoBillingContext;
};

export function normalizeProxyBillableRequest(input: ProxyUsageInput): NormalizedUsage {
    const payload = object(input.payload) || {};
    const rateCard = validatePricingRateCard(input.rateCard);
    let usage: NormalizedUsage;
    const prompt = promptText(payload);
    if (input.capability === "text") {
        const inputTokens = estimateTextInputTokens(prompt);
        const maxOutputTokens = positiveIntegerText(payload.max_tokens ?? payload.max_output_tokens ?? object(payload.generationConfig)?.maxOutputTokens ?? input.inputLimits?.maxOutputTokens);
        if (!maxOutputTokens) throw new Error("文本预留缺少可证明的最大输出 token");
        const maxInputTokens = positiveIntegerText(input.inputLimits?.maxInputTokens);
        if (maxInputTokens && BigInt(inputTokens) > BigInt(maxInputTokens)) throw new Error("文本输入超过模型最大 token 限制");
        const longContextThresholdTokens = rateCard.components.find((component) => component.contextThresholdTokens)?.contextThresholdTokens;
        usage = normalizeBillableUsage({
            capability: "text",
            source: "request",
            request: "1",
            inputTokens,
            cachedInputTokens: "0",
            cacheCreationTokens: "0",
            serverToolCalls: "0",
            maxOutputTokens,
            characters: countUnicodeCodePoints(prompt),
            ...(longContextThresholdTokens ? { longContextThresholdTokens, contextTier: "long" as const } : {}),
        });
    } else {
        const parameters = object(payload.parameters) || {};
        const count = positiveIntegerText(payload.n ?? payload.count ?? parameters.n ?? parameters.count) || "1";
        const explicitQuality = firstText(payload.quality, payload.vquality, parameters.quality, parameters.vquality);
        const discoveredResolution =
            firstText(
                payload.resolution_name,
                payload.resolution,
                parameters.resolution_name,
                parameters.resolution,
                input.capability === "video" ? payload.vquality : undefined,
                input.capability === "video" ? parameters.vquality : undefined,
                payload.size,
                parameters.size,
            ) || dimensions(payload);
        const resolution = input.capability === "video" ? canonicalVideoResolution(discoveredResolution) : discoveredResolution;
        const quality = input.capability === "video" ? normalizeVideoQuality(explicitQuality, resolution) : explicitQuality;
        const imageMegapixelThreshold = input.capability === "image" ? rateCard.components.find((component) => component.megapixelThreshold)?.megapixelThreshold : undefined;
        const outputMegapixels = perImageMegapixels(resolution);
        const missingMegapixelTier = input.capability === "image" ? rateCard.components.find((component) => component.missingMegapixelTier)?.missingMegapixelTier : undefined;
        const megapixelTier = imageMegapixelThreshold && outputMegapixels ? (decimal(outputMegapixels).greaterThan(decimal(imageMegapixelThreshold)) ? ("large" as const) : ("normal" as const)) : missingMegapixelTier;
        const hasReferenceVideo = input.capability === "video" ? requestHasReferenceVideo(payload) || input.inputLimits?.videoBillingContext?.hasReferenceVideo === true : undefined;
        usage = normalizeBillableUsage({
            capability: input.capability,
            source: "request",
            request: "1",
            count,
            inputImageCount: input.capability === "image" ? referenceImageCount(payload) : undefined,
            characters: countUnicodeCodePoints(prompt),
            megapixels: megapixels(resolution, count),
            megapixelTier,
            ...(imageMegapixelThreshold ? { providerUsage: { megapixelThreshold: imageMegapixelThreshold } } : {}),
            quality,
            resolution,
            durationSeconds:
                positiveDecimalText(
                    payload.duration ??
                        payload.duration_seconds ??
                        payload.durationSeconds ??
                        payload.seconds ??
                        payload.videoSeconds ??
                        parameters.durationSeconds ??
                        parameters.duration_seconds ??
                        parameters.duration ??
                        parameters.seconds ??
                        parameters.videoSeconds,
                ) || positiveDecimalText(input.inputLimits?.maxDurationSeconds),
            format: firstText(payload.response_format, payload.format, payload.output_format, parameters.response_format, parameters.format, parameters.output_format),
            ...(hasReferenceVideo !== undefined ? { hasReferenceVideo, billingBasis: hasReferenceVideo ? ("with_video_input" as const) : ("default" as const) } : {}),
            ...(hasReferenceVideo && input.inputLimits?.videoBillingContext?.verifiedInputVideoDurationSeconds ? { inputVideoDurationSeconds: input.inputLimits.videoBillingContext.verifiedInputVideoDurationSeconds } : {}),
        });
        const videoTokenComponents = input.capability === "video" ? rateCard.components.filter((component) => component.dimension === "outputTokens" && component.when?.billingBasis) : [];
        if (videoTokenComponents.length) {
            if (!usage.billingBasis || !videoTokenComponents.some((component) => component.when?.billingBasis === usage.billingBasis && (!component.when?.resolution || canonicalVideoResolution(component.when.resolution) === usage.resolution))) {
                throw new Error(`视频 token 预留缺少精确价格维度：${usage.billingBasis || "unknown"}@${usage.resolution || "unknown"}`);
            }
            const outputTokens = estimateVideoTokenHoldUsage(payload, parameters, usage, input.inputLimits);
            if (outputTokens !== undefined) usage = normalizeBillableUsage({ ...usage, outputTokens });
        }
    }
    calculatePricingReserve({ rateCard, usage });
    return usage;
}

export function validateSignedImageQualityRequest(input: { usage: NormalizedUsage; payload: unknown; context: SystemAiImageQualityContext; profile: ImageQualityProfile; saleRateCardRevision: string }) {
    const profile = normalizeImageQualityProfile(input.profile);
    if (!profile || profile.profileRevision !== input.context.qualityProfileRevision || input.context.saleRateCardRevision !== input.saleRateCardRevision) throw new Error("画质或售价配置已更新，请重新提交");
    const option = input.context.selectedQualityValue ? profile.options.find((candidate) => candidate.value === input.context.selectedQualityValue) : undefined;
    if (input.context.selectedQualityValue && (!option || option.optionRevision !== input.context.optionRevision)) throw new Error("画质选项已更新，请重新提交");
    const payload = object(input.payload) || {};
    const parameters = object(payload.parameters) || {};
    if (option?.effect.type === "prompt_flag") {
        const tokens = promptText(payload).trim().split(/\s+/).filter(Boolean);
        const flags = tokens.filter((token) => /^(?:--sd|--hd)$/i.test(token)).map((token) => token.toLowerCase());
        if (flags.length !== 1 || flags[0] !== option.effect.promptSuffix) throw new Error("画质执行参数与签名不一致");
    }
    if (option?.effect.type === "request_parameter") {
        const actual = payload[option.effect.requestParameter.name] ?? parameters[option.effect.requestParameter.name];
        if (actual !== option.effect.requestParameter.value) throw new Error("画质执行参数与签名不一致");
    }
    if (option?.effect.type === "resolution_tier") {
        if (input.context.resolvedResolutionTier !== option.effect.resolutionTier || !input.context.resolvedSize || !option.effect.exactSizes.includes(input.context.resolvedSize)) throw new Error("画质执行参数与签名不一致");
    }
    if (input.context.resolvedSize && canonicalImageSize(input.usage.resolution) !== canonicalImageSize(input.context.resolvedSize)) throw new Error("画质执行参数与签名不一致");
    if (input.context.resolvedPixelTier && input.usage.megapixelTier !== input.context.resolvedPixelTier) throw new Error("画质计价档位与签名不一致");
    const count = positiveIntegerText(input.context.billableOutputCount);
    if (!count) throw new Error("画质计费数量无效");
    const resolution = input.context.resolvedSize || input.usage.resolution;
    return normalizeBillableUsage({ ...input.usage, count, ...(resolution ? { resolution, megapixels: megapixels(resolution, count) } : {}) });
}

export function deriveProxyBillableUsage(input: { capability: BillableCapability; requestUsage: NormalizedUsage; payload: unknown }): NormalizedUsage | undefined {
    const payload = object(input.payload) || {};
    if (input.capability === "text") {
        const {
            maxOutputTokens: _maxOutputTokens,
            cacheCreationTokens: _requestCacheCreationTokens,
            serverToolCalls: _requestServerToolCalls,
            contextTier: _requestContextTier,
            contextInputTokens: _requestContextInputTokens,
            ...requestUsage
        } = input.requestUsage;
        const actual = actualTextUsage(payload);
        if (actual) {
            const contextTier = requestUsage.longContextThresholdTokens ? (decimal(requestUsage.longContextThresholdTokens).lessThanOrEqualTo(decimal(actual.contextInputTokens)) ? ("long" as const) : ("normal" as const)) : undefined;
            return normalizeBillableUsage({ ...requestUsage, capability: "text", source: "actual", ...actual, ...(contextTier ? { contextTier } : {}) });
        }
        return undefined;
    }
    const count = resultCount(payload);
    if (!count) return undefined;
    const actualResolution = input.capability === "image" ? resultImageSize(payload) : undefined;
    const resolution = actualResolution || input.requestUsage.resolution;
    const megapixelThreshold = input.capability === "image" ? input.requestUsage.providerUsage?.megapixelThreshold : undefined;
    const tier = actualResolution && typeof megapixelThreshold === "string" ? (decimal(perImageMegapixels(actualResolution)!).greaterThan(decimal(megapixelThreshold)) ? ("large" as const) : ("normal" as const)) : input.requestUsage.megapixelTier;
    return normalizeBillableUsage({ ...input.requestUsage, capability: input.capability, source: "derived", count, resolution, megapixelTier: tier, megapixels: megapixels(resolution, count) });
}

export function createStreamingUsageAccumulator(capability: BillableCapability, requestUsage: NormalizedUsage) {
    let actual: NormalizedUsage | undefined;
    let terminalStatus: "succeeded" | "failed" | undefined;
    let textUsage: Record<string, unknown> = {};
    const decoder = createTextSseDecoder((data) => {
        if (!data) return;
        if (data === "[DONE]") {
            terminalStatus ??= "succeeded";
            return;
        }
        try {
            const payload = object(JSON.parse(data)) || {};
            terminalStatus ??= textStreamTerminalStatus(payload);
            const usage = capability === "text" ? readTextUsage(payload) : undefined;
            // Native usage events contain cumulative counters, sometimes split across frames.
            if (usage) textUsage = { ...textUsage, ...usage };
            const parsed = deriveProxyBillableUsage({ capability, requestUsage, payload: usage ? { usage: textUsage } : payload });
            if (parsed?.source === "actual") actual = parsed;
        } catch {
            // Non-JSON stream events have no billable usage metadata.
        }
    });
    return {
        terminalStatus: () => terminalStatus,
        push(chunk: Uint8Array) {
            decoder.push(chunk);
        },
        finish() {
            decoder.finish();
            if (actual) return actual;
            return undefined;
        },
    };
}

export function calculateProviderUsageCost(rateCard: PricingRateCardV1, usage: NormalizedUsage) {
    return calculateNormalizedUsagePrice({ rateCard, usage });
}

export class AuthoritativeVideoUsageError extends Error {
    constructor(
        readonly code: "AUTHORITATIVE_USAGE_MISSING" | "AUTHORITATIVE_DURATION_MISSING" | "AUTHORITATIVE_PRICING_DIMENSION_MISSING",
        message: string,
    ) {
        super(message);
        this.name = "AuthoritativeVideoUsageError";
    }
}

export function normalizeAuthoritativeVideoUsage(input: { requestUsage: NormalizedUsage; payload: unknown; costRateCard?: PricingRateCardV1 }) {
    const rateCard = input.costRateCard ? validatePricingRateCard(input.costRateCard) : undefined;
    const tokenComponents = rateCard?.components.filter((component) => component.dimension === "outputTokens" && component.when?.billingBasis) || [];
    if (!tokenComponents.length) return undefined;
    const provider = readVideoProviderUsage(input.payload);
    if (provider.completionTokens === undefined) throw new AuthoritativeVideoUsageError("AUTHORITATIVE_USAGE_MISSING", "DFLOP Seedance 终态响应缺少 usage.completion_tokens");
    const resolution = input.requestUsage.resolution;
    const billingBasis = input.requestUsage.billingBasis;
    if (!billingBasis || !tokenComponents.some((component) => (!component.when?.resolution || component.when.resolution === resolution) && component.when?.billingBasis === billingBasis)) {
        throw new AuthoritativeVideoUsageError("AUTHORITATIVE_PRICING_DIMENSION_MISSING", `DFLOP Seedance 缺少精确 token 价格维度：${billingBasis || "unknown"}@${resolution || "unknown"}`);
    }
    const secondStageComponents = rateCard!.components.filter((component) => component.id.startsWith("video-second-stage"));
    const secondStageMatched = secondStageComponents.some((component) => !component.when?.resolution || component.when.resolution === resolution);
    if (secondStageComponents.length && !secondStageMatched) {
        throw new AuthoritativeVideoUsageError("AUTHORITATIVE_PRICING_DIMENSION_MISSING", `DFLOP Seedance 缺少精确第二阶段价格维度：${resolution || "unknown"}`);
    }
    if (secondStageMatched && provider.deliveredDurationSeconds === undefined) throw new AuthoritativeVideoUsageError("AUTHORITATIVE_DURATION_MISSING", "DFLOP Seedance Lite 终态响应缺少 delivered duration");
    return normalizeBillableUsage({
        ...input.requestUsage,
        capability: "video",
        source: "actual",
        outputTokens: provider.completionTokens,
        totalTokens: provider.totalTokens,
        durationSeconds: provider.deliveredDurationSeconds,
        inputVideoDurationSeconds: provider.inputVideoDurationSeconds,
        framesPerSecond: provider.framesPerSecond,
        providerUsage: provider.rawUsage,
    });
}

function actualTextUsage(payload: Record<string, unknown>) {
    const usage = readTextUsage(payload);
    const totalInputTokens = nonNegativeIntegerText(usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount);
    const outputTokens = nonNegativeIntegerText(usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount);
    if (!totalInputTokens || !outputTokens) return undefined;
    const serverToolCalls = nonNegativeIntegerText(usage?.num_server_side_tools_used ?? usage?.server_tool_calls) || "0";
    if (usage?.cache_read_input_tokens !== undefined || usage?.cache_creation_input_tokens !== undefined) {
        // Claude's uncached, cache-write, and cache-read input counters are disjoint.
        const cacheCreationTokens = nonNegativeIntegerText(usage.cache_creation_input_tokens) || "0";
        return { inputTokens: totalInputTokens, cachedInputTokens: nonNegativeIntegerText(usage.cache_read_input_tokens) || "0", cacheCreationTokens, outputTokens, serverToolCalls, contextInputTokens: totalInputTokens };
    }
    const details = object(usage?.prompt_tokens_details) || object(usage?.input_tokens_details);
    const cachedInputTokens = nonNegativeIntegerText(details?.cached_tokens ?? usage?.cachedContentTokenCount) || "0";
    if (decimal(cachedInputTokens).greaterThan(decimal(totalInputTokens))) return undefined;
    return { inputTokens: decimal(totalInputTokens).minus(decimal(cachedInputTokens)).toString(), cachedInputTokens, outputTokens, serverToolCalls, contextInputTokens: totalInputTokens };
}

function referenceImageCount(payload: Record<string, unknown>) {
    for (const key of ["image_urls", "images", "ref_assets", "reference_images", "input_images"]) {
        const value = payload[key];
        if (Array.isArray(value)) return String(value.length);
        if (typeof value === "string" && value.trim()) return "1";
    }
    const content = Array.isArray(payload.content) ? payload.content : [];
    return String(content.filter((item) => object(item)?.type === "input_image" || object(item)?.type === "image_url").length);
}

function readTextUsage(payload: Record<string, unknown>) {
    return object(payload.usage) || object(object(payload.message)?.usage) || object(object(payload.response)?.usage) || object(payload.usageMetadata);
}

function promptText(payload: Record<string, unknown>) {
    return [payload.messages, payload.input, payload.prompt, payload.text, payload.contents, payload.system, payload.instructions].flatMap(contentStrings).join("");
}

function responseText(payload: Record<string, unknown>) {
    return [payload.output_text, payload.output, payload.choices, payload.candidates, payload.content, payload.result].flatMap(contentStrings).join("");
}

function contentStrings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(contentStrings);
    const record = object(value);
    if (!record) return [];
    const direct = [record.text, record.content, record.output_text].flatMap(contentStrings);
    if (direct.length) return direct;
    return [record.message, record.delta, record.parts, record.output, record.candidates].flatMap(contentStrings);
}

function resultCount(payload: Record<string, unknown>) {
    for (const value of [payload.data, payload.images, payload.videos, payload.audio, payload.results, payload.output]) if (Array.isArray(value) && value.length) return String(value.length);
    return responseText(payload) ? "1" : undefined;
}

function resultImageSize(payload: Record<string, unknown>) {
    for (const collection of [payload.data, payload.images, payload.results, payload.output]) {
        if (!Array.isArray(collection)) continue;
        for (const item of collection) {
            const record = object(item);
            const size = text(record?.size);
            if (size && /^\d+x\d+$/i.test(size)) return size.toLowerCase();
            const width = positiveIntegerText(record?.width);
            const height = positiveIntegerText(record?.height);
            if (width && height) return `${width}x${height}`;
        }
    }
    return dimensions(payload);
}

function dimensions(payload: Record<string, unknown>) {
    const width = positiveIntegerText(payload.width);
    const height = positiveIntegerText(payload.height);
    return width && height ? `${width}x${height}` : undefined;
}

function estimateVideoTokenHoldUsage(payload: Record<string, unknown>, parameters: Record<string, unknown>, usage: NormalizedUsage, inputLimits?: ProxyUsageInputLimits) {
    if (!usage.durationSeconds || !usage.resolution) return undefined;
    const size = usage.hasReferenceVideo ? inputLimits?.safeVideoFrame : videoTokenDimensions(payload, parameters, usage.resolution);
    if (!size) return undefined;
    if (usage.hasReferenceVideo) {
        if (!inputLimits?.seedanceModelFamily) return undefined;
        return computeSeedanceHoldUsage({ family: inputLimits.seedanceModelFamily, outputDurationSeconds: usage.durationSeconds, frame: size, hasReferenceVideo: true }).tokens;
    }
    return estimateVideoTokenCount({ outputDurationSeconds: usage.durationSeconds, width: size.width, height: size.height });
}

export function videoTokenBillingRequestContext(input: { usage: NormalizedUsage; rateCard: PricingRateCardV1; inputLimits?: ProxyUsageInputLimits }) {
    const usage = input.usage;
    if (usage.capability !== "video" || !usage.outputTokens || !usage.durationSeconds || !usage.resolution) return undefined;
    const frame = usage.hasReferenceVideo ? input.inputLimits?.safeVideoFrame : undefined;
    const holdInputVideoDurationSeconds = usage.hasReferenceVideo ? (input.inputLimits?.seedanceModelFamily === "seedance-2.5" ? "30" : input.inputLimits?.seedanceModelFamily === "seedance-2.0" ? "15" : undefined) : "0";
    if (!frame || holdInputVideoDurationSeconds === undefined) return undefined;
    const estimate = estimateSeedanceUsage({
        outputDurationSeconds: usage.durationSeconds,
        verifiedInputVideoDurationSeconds: input.inputLimits?.videoBillingContext?.verifiedInputVideoDurationSeconds,
        frame,
        hasReferenceVideo: usage.hasReferenceVideo === true,
        conservativeFrame: usage.hasReferenceVideo === true,
    });
    return {
        pricingBasis: "video_token" as const,
        billingBasis: usage.billingBasis!,
        resolution: usage.resolution,
        requestedOutputDurationSeconds: usage.durationSeconds,
        hasReferenceVideo: usage.hasReferenceVideo === true,
        ...(usage.inputVideoDurationSeconds ? { verifiedInputVideoDurationSeconds: usage.inputVideoDurationSeconds, referenceVideoDurationSource: "server-probed" as const } : {}),
        ...(estimate.status !== "REFERENCE_DURATION_UNKNOWN" ? { estimatePixelWidth: estimate.frame.width, estimatePixelHeight: estimate.frame.height, estimatedTokens: estimate.tokens } : {}),
        estimateStatus: estimate.status,
        holdTokens: usage.outputTokens,
        holdInputVideoDurationSeconds,
        holdPixelWidth: frame.width,
        holdPixelHeight: frame.height,
        saleRateCardRevision: validatePricingRateCard(input.rateCard).revision,
    };
}

function videoTokenDimensions(payload: Record<string, unknown>, parameters: Record<string, unknown>, resolution: string) {
    const explicitWidth = positiveIntegerText(payload.width ?? parameters.width);
    const explicitHeight = positiveIntegerText(payload.height ?? parameters.height);
    if (explicitWidth && explicitHeight) return { width: explicitWidth, height: explicitHeight };
    const exact = /^(\d+)x(\d+)$/i.exec(firstText(payload.size, parameters.size, resolution) || "");
    if (exact) return { width: exact[1], height: exact[2] };
    const edge = /^(480|720|1080)p$/i.exec(resolution)?.[1];
    const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(firstText(payload.ratio, payload.aspect_ratio, parameters.ratio, parameters.aspect_ratio, payload.size, parameters.size) || "");
    if (!edge || !ratio) return undefined;
    const horizontal = Number(ratio[1]);
    const vertical = Number(ratio[2]);
    const shortEdge = Number(edge);
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || horizontal <= 0 || vertical <= 0) return undefined;
    return horizontal >= vertical ? { width: String(Math.ceil((shortEdge * horizontal) / vertical)), height: edge } : { width: edge, height: String(Math.ceil((shortEdge * vertical) / horizontal)) };
}

function positiveIntegerText(value: unknown) {
    try {
        const number = decimal(value as string | number, "正整数");
        return number.greaterThan(decimal(0)) && number.hasAtMostDecimalPlaces(0) ? number.toString() : undefined;
    } catch {
        return undefined;
    }
}

function nonNegativeIntegerText(value: unknown) {
    try {
        const number = decimal(value as string | number, "非负整数");
        return !number.isNegative() && number.hasAtMostDecimalPlaces(0) ? number.toString() : undefined;
    } catch {
        return undefined;
    }
}

function positiveDecimalText(value: unknown) {
    try {
        const number = decimal(value as string | number, "正数");
        return number.greaterThan(decimal(0)) ? number.toString() : undefined;
    } catch {
        return undefined;
    }
}

function megapixels(resolution: string | undefined, count: string) {
    const match = /^(\d+)x(\d+)$/i.exec(resolution || "");
    if (!match) return undefined;
    return decimal(match[1]).times(decimal(match[2])).times(decimal(count)).dividedBy(decimal("1000000")).toString();
}

function perImageMegapixels(resolution: string | undefined) {
    const match = /^(\d+)x(\d+)$/i.exec(resolution || "");
    if (!match) return undefined;
    return decimal(match[1]).times(decimal(match[2])).dividedBy(decimal("1000000")).toString();
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstText(...values: unknown[]) {
    for (const value of values) {
        const normalized = text(value);
        if (normalized) return normalized;
    }
    return undefined;
}

function normalizeVideoQuality(quality: string | undefined, resolution: string | undefined) {
    if (quality) return videoClarity(quality) || quality;
    return videoClarity(resolution);
}

function videoClarity(value: string | undefined) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return undefined;
    if (/^\d+$/.test(normalized)) return normalized;
    if (/^\d+p$/.test(normalized)) return normalized.slice(0, -1);
    if (/^\d+k(?:p)?$/.test(normalized)) return normalized.replace(/p$/, "");
    return undefined;
}

function canonicalVideoResolution(value: string | undefined) {
    const normalized = value?.trim().toLowerCase();
    const match = /^(480|720|1080)p?$/.exec(normalized || "");
    return match ? `${match[1]}p` : value;
}

function canonicalImageSize(value: string | undefined) {
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(value?.trim() || "");
    return match ? `${Number(match[1])}x${Number(match[2])}` : value?.trim().toLowerCase();
}

function requestHasReferenceVideo(payload: Record<string, unknown>) {
    const parameters = object(payload.parameters) || {};
    for (const key of ["reference_videos", "referenceVideos", "input_videos", "inputVideos", "videos"]) {
        if (array(payload[key]).length || array(parameters[key]).length) return true;
    }
    for (const key of ["reference_video", "referenceVideo", "input_video", "inputVideo", "video"]) {
        if (text(payload[key]) || text(parameters[key])) return true;
    }
    const structured = [...array(payload.content), ...array(payload.ref_assets), ...array(parameters.content), ...array(parameters.ref_assets)];
    return structured.some((item) => {
        const value = object(item);
        if (!value) return false;
        const type = text(value.type)?.toLowerCase();
        const role = text(value.role)?.toLowerCase();
        return type === "video" || type === "input_video" || (type === "video_url" && (!role || role === "reference_video"));
    });
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function array(value: unknown) {
    return Array.isArray(value) ? value : [];
}
