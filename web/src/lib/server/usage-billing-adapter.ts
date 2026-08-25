import { calculateNormalizedUsagePrice, calculatePricingReserve, normalizeBillableUsage, validatePricingRateCard, type BillableCapability, type NormalizedUsage, type PricingRateCardV1 } from "@/lib/billing/pricing";
import { decimal } from "@/lib/billing/decimal";

type ProxyUsageInput = {
    capability: BillableCapability;
    payload: unknown;
    rateCard: PricingRateCardV1;
    inputLimits?: { maxInputTokens?: string; maxOutputTokens?: string };
};

export function normalizeProxyBillableRequest(input: ProxyUsageInput): NormalizedUsage {
    const payload = object(input.payload) || {};
    const rateCard = validatePricingRateCard(input.rateCard);
    let usage: NormalizedUsage;
    const prompt = promptText(payload);
    if (input.capability === "text") {
        const inputTokens = String(Buffer.byteLength(prompt, "utf8"));
        const maxOutputTokens = positiveIntegerText(payload.max_tokens ?? payload.max_output_tokens ?? object(payload.generationConfig)?.maxOutputTokens ?? input.inputLimits?.maxOutputTokens);
        if (!maxOutputTokens) throw new Error("文本预留缺少可证明的最大输出 token");
        const maxInputTokens = positiveIntegerText(input.inputLimits?.maxInputTokens);
        if (maxInputTokens && BigInt(inputTokens) > BigInt(maxInputTokens)) throw new Error("文本输入超过模型最大 token 限制");
        usage = normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens, cachedInputTokens: "0", maxOutputTokens, characters: codePointCount(prompt) });
    } else {
        const parameters = object(payload.parameters) || {};
        const count = positiveIntegerText(payload.n ?? payload.count ?? parameters.n ?? parameters.count) || "1";
        const quality = firstText(payload.quality, payload.vquality, parameters.quality, parameters.vquality);
        const resolution =
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
        usage = normalizeBillableUsage({
            capability: input.capability,
            source: "request",
            request: "1",
            count,
            characters: codePointCount(prompt),
            megapixels: megapixels(resolution, count),
            quality,
            resolution,
            durationSeconds: positiveDecimalText(
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
            ),
            format: firstText(payload.response_format, payload.format, payload.output_format, parameters.response_format, parameters.format, parameters.output_format),
        });
    }
    calculatePricingReserve({ rateCard, usage });
    return usage;
}

export function deriveProxyBillableUsage(input: { capability: BillableCapability; requestUsage: NormalizedUsage; payload: unknown }): NormalizedUsage | undefined {
    const payload = object(input.payload) || {};
    if (input.capability === "text") {
        const { maxOutputTokens: _maxOutputTokens, ...requestUsage } = input.requestUsage;
        const actual = actualTextUsage(payload);
        if (actual) return normalizeBillableUsage({ ...requestUsage, capability: "text", source: "actual", ...actual });
        return undefined;
    }
    const count = resultCount(payload);
    if (!count) return undefined;
    return normalizeBillableUsage({ ...input.requestUsage, capability: input.capability, source: "derived", count, megapixels: megapixels(input.requestUsage.resolution, count) });
}

export function createStreamingUsageAccumulator(capability: BillableCapability, requestUsage: NormalizedUsage) {
    const decoder = new TextDecoder();
    let tail = "";
    let actual: NormalizedUsage | undefined;
    const consumeLine = (line: string) => {
        const data = line.trim().replace(/^data:\s*/, "");
        if (!data || data === "[DONE]") return;
        try {
            const payload = JSON.parse(data) as unknown;
            const parsed = deriveProxyBillableUsage({ capability, requestUsage, payload });
            if (parsed?.source === "actual") actual = parsed;
        } catch {
            // Non-JSON stream events have no billable usage metadata.
        }
    };
    return {
        push(chunk: Uint8Array) {
            tail += decoder.decode(chunk, { stream: true });
            const lines = tail.split(/\r?\n/);
            tail = lines.pop() || "";
            lines.forEach(consumeLine);
        },
        finish() {
            tail += decoder.decode();
            if (tail) consumeLine(tail);
            tail = "";
            if (actual) return actual;
            return undefined;
        },
        bufferedBytes() {
            return Buffer.byteLength(tail, "utf8");
        },
    };
}

export function calculateProviderUsageCost(rateCard: PricingRateCardV1, usage: NormalizedUsage) {
    return calculateNormalizedUsagePrice({ rateCard, usage });
}

function actualTextUsage(payload: Record<string, unknown>) {
    const usage = object(payload.usage) || object(payload.usageMetadata);
    const totalInputTokens = nonNegativeIntegerText(usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount);
    const outputTokens = nonNegativeIntegerText(usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount);
    const details = object(usage?.prompt_tokens_details) || object(usage?.input_tokens_details);
    const cachedInputTokens = nonNegativeIntegerText(details?.cached_tokens ?? usage?.cachedContentTokenCount) || "0";
    if (!totalInputTokens || !outputTokens || decimal(cachedInputTokens).greaterThan(decimal(totalInputTokens))) return undefined;
    return { inputTokens: decimal(totalInputTokens).minus(decimal(cachedInputTokens)).toString(), cachedInputTokens, outputTokens };
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

function dimensions(payload: Record<string, unknown>) {
    const width = positiveIntegerText(payload.width);
    const height = positiveIntegerText(payload.height);
    return width && height ? `${width}x${height}` : undefined;
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

function codePointCount(value: string) {
    return String(Array.from(value).length);
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

function object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function array(value: unknown) {
    return Array.isArray(value) ? value : [];
}
