import { calculateNormalizedUsagePrice, calculatePricingReserve, normalizeBillableUsage, validatePricingRateCard, type BillableCapability, type NormalizedUsage, type PricingRateCardV1 } from "@/lib/billing/pricing";

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
    if (input.capability === "text") {
        const inputTokens = String(Buffer.byteLength(promptText(payload), "utf8"));
        const maxOutputTokens = positiveIntegerText(payload.max_tokens ?? payload.max_output_tokens ?? object(payload.generationConfig)?.maxOutputTokens ?? input.inputLimits?.maxOutputTokens);
        if (!maxOutputTokens) throw new Error("文本预留缺少可证明的最大输出 token");
        const maxInputTokens = positiveIntegerText(input.inputLimits?.maxInputTokens);
        if (maxInputTokens && BigInt(inputTokens) > BigInt(maxInputTokens)) throw new Error("文本输入超过模型最大 token 限制");
        usage = normalizeBillableUsage({ capability: "text", source: "request", inputTokens, maxOutputTokens });
    } else {
        usage = normalizeBillableUsage({
            capability: input.capability,
            source: "request",
            count: positiveIntegerText(payload.n ?? payload.count) || "1",
            quality: text(payload.quality),
            resolution: text(payload.size) || text(payload.resolution) || dimensions(payload),
            durationSeconds: positiveDecimalText(payload.duration ?? payload.duration_seconds ?? payload.durationSeconds),
            format: text(payload.response_format) || text(payload.format),
        });
    }
    calculatePricingReserve({ rateCard, usage });
    return usage;
}

export function deriveProxyBillableUsage(input: { capability: BillableCapability; requestUsage: NormalizedUsage; payload: unknown }): NormalizedUsage | undefined {
    const payload = object(input.payload) || {};
    if (input.capability === "text") {
        const actual = actualTextUsage(payload);
        if (actual) return normalizeBillableUsage({ capability: "text", source: "actual", ...actual });
        const output = responseText(payload);
        if (!output) return undefined;
        return normalizeBillableUsage({ capability: "text", source: "derived", inputTokens: input.requestUsage.inputTokens || "0", outputTokens: Buffer.byteLength(output, "utf8") });
    }
    const count = resultCount(payload);
    if (!count) return undefined;
    return normalizeBillableUsage({ ...input.requestUsage, capability: input.capability, source: "derived", count });
}

export function createStreamingUsageAccumulator(capability: BillableCapability, requestUsage: NormalizedUsage) {
    const decoder = new TextDecoder();
    let tail = "";
    let outputBytes = 0;
    let actual: NormalizedUsage | undefined;
    const consumeLine = (line: string) => {
        const data = line.trim().replace(/^data:\s*/, "");
        if (!data || data === "[DONE]") return;
        try {
            const payload = JSON.parse(data) as unknown;
            const parsed = deriveProxyBillableUsage({ capability, requestUsage, payload });
            if (parsed?.source === "actual") actual = parsed;
            else if (capability === "text") outputBytes += Buffer.byteLength(streamDeltaText(payload), "utf8");
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
            if (capability === "text" && outputBytes) return normalizeBillableUsage({ capability: "text", source: "derived", inputTokens: requestUsage.inputTokens || "0", outputTokens: outputBytes });
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
    const inputTokens = nonNegativeIntegerText(usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount);
    const outputTokens = nonNegativeIntegerText(usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount);
    return inputTokens && outputTokens ? { inputTokens, outputTokens } : undefined;
}

function promptText(payload: Record<string, unknown>) {
    return [payload.messages, payload.input, payload.prompt, payload.text, payload.contents, payload.system, payload.instructions].flatMap(contentStrings).join("");
}

function responseText(payload: Record<string, unknown>) {
    return [payload.output_text, payload.output, payload.choices, payload.candidates, payload.content, payload.result].flatMap(contentStrings).join("");
}

function streamDeltaText(payload: unknown) {
    const record = object(payload);
    const choices = array(record?.choices);
    return (
        choices
            .map((choice) => contentStrings(object(choice)?.delta))
            .flat()
            .join("") || contentStrings(record?.delta).join("")
    );
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
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? String(number) : undefined;
}

function nonNegativeIntegerText(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? String(number) : undefined;
}

function positiveDecimalText(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(value) : undefined;
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function array(value: unknown) {
    return Array.isArray(value) ? value : [];
}
