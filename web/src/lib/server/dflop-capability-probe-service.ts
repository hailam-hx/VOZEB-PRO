import { randomUUID } from "node:crypto";

import { decimal } from "@/lib/billing/decimal";
import { capabilityProbeFingerprint, type CapabilityProbeResult } from "@/lib/billing/provider-capability-probe";
import type { ProviderPricingProfile } from "@/lib/billing/provider-pricing";

type ProbeChannel = { id: string; baseUrl: string; apiKey: string };
type ProbeInput = {
    channel: ProbeChannel;
    bindingId: string;
    modelId: string;
    profile: ProviderPricingProfile;
    fetcher?: typeof fetch;
    now?: () => string;
};

const QWEN_PROBE_SIZES = ["512x512", "1024x1024", "1024x1536", "1536x1024", "1536x1536", "2048x2048", "2560x2560"] as const;

export async function runDflopGptImageCapabilityProbe(input: ProbeInput): Promise<CapabilityProbeResult> {
    const fetcher = input.fetcher || fetch;
    const response = await fetcher(endpoint(input.channel.baseUrl, "responses"), {
        method: "POST",
        headers: headers(input.channel.apiKey),
        body: JSON.stringify({ model: input.modelId, input: [{ role: "user", content: "Generate a simple blue square image." }], tools: [{ type: "image_generation" }], stream: true }),
    });
    const requestId = response.headers.get("x-gateway-trace") || undefined;
    const body = await readResponse(response);
    const errorCode = providerErrorCode(body);
    if (response.status === 400 && errorCode === "tool_not_supported") {
        return baseResult(input, {
            outcome: "unsupported",
            supported: false,
            statusCode: response.status,
            upstreamErrorCode: errorCode,
            usageSeen: false,
            imageOutputSeen: false,
            billingEvidence: { basis: "unresolved", authoritative: false, source: "none" },
            ...(requestId ? { requestId } : {}),
        });
    }
    if (!response.ok || errorCode) {
        return baseResult(input, {
            outcome: "inconclusive",
            supported: false,
            statusCode: response.status,
            ...(errorCode ? { upstreamErrorCode: errorCode } : {}),
            usageSeen: false,
            imageOutputSeen: false,
            billingEvidence: { basis: "unresolved", authoritative: false, source: "none" },
            ...(requestId ? { requestId } : {}),
        });
    }

    const responsePayload = completedResponse(body);
    const usage = record(responsePayload.usage);
    const output = Array.isArray(responsePayload.output) ? responsePayload.output : [];
    const imageOutputCount = output.filter((item) => record(item).type === "image_generation_call").length || countImageEvents(body);
    const log = requestId ? await fetchProviderLog(fetcher, input.channel, requestId) : undefined;
    const billingEvidence = classifyGptBilling(input.profile, usage, imageOutputCount, log);
    return baseResult(input, {
        outcome: imageOutputCount ? "supported" : "inconclusive",
        supported: imageOutputCount > 0,
        statusCode: response.status,
        usageSeen: hasUsage(usage),
        imageOutputSeen: imageOutputCount > 0,
        billingEvidence,
        ...(requestId ? { requestId } : {}),
    });
}

export async function runDflopQwenSizeProbe(input: ProbeInput & { idempotencyKey?: (size: string) => string }): Promise<CapabilityProbeResult> {
    const fetcher = input.fetcher || fetch;
    const cases: Array<Record<string, unknown>> = [];
    const mapping: Record<string, string> = {};
    let evidenceSource: CapabilityProbeResult["billingEvidence"]["source"] = "none";
    for (const size of QWEN_PROBE_SIZES) {
        const key = input.idempotencyKey?.(size) || randomUUID();
        const response = await fetcher(endpoint(input.channel.baseUrl, "images/generations"), {
            method: "POST",
            headers: { ...headers(input.channel.apiKey), "Idempotency-Key": key },
            body: JSON.stringify({ model: input.modelId, prompt: "A simple blue square on a plain white background.", size, n: 1 }),
        });
        const requestId = response.headers.get("x-gateway-trace") || undefined;
        const payload = await readResponse(response);
        const data = Array.isArray(record(payload).data) ? (record(payload).data as unknown[]) : [];
        const first = record(data[0]);
        const responseSize = text(first.size) || text(record(payload).size);
        const [actualWidth, actualHeight] = parseSize(responseSize);
        const taskId = text(record(payload).id);
        const explicitTier = normalizeTier(first.billing_tier || first.tier || record(payload).billing_tier || record(payload).tier);
        const log = requestId ? await fetchProviderLog(fetcher, input.channel, requestId) : taskId ? await fetchProviderLog(fetcher, input.channel, taskId) : undefined;
        const costTier = tierFromCost(log?.cost, input.profile);
        const tier = explicitTier || costTier;
        if (tier) {
            mapping[size] = tier;
            evidenceSource = explicitTier ? "response_tier" : "provider_task_record";
        }
        cases.push({
            requestSize: size,
            statusCode: response.status,
            accepted: response.ok && !providerErrorCode(payload),
            ...(responseSize ? { responseSize } : {}),
            ...(actualWidth ? { actualWidth } : {}),
            ...(actualHeight ? { actualHeight } : {}),
            ...(requestId ? { requestId } : {}),
            ...(taskId ? { taskId } : {}),
            idempotencyKey: key,
            usage: record(payload).usage || null,
            rawTier: explicitTier || null,
            providerUsageRecordId: log?.id === undefined ? null : String(log.id),
            billingAmount: log?.cost ?? null,
            billingUnit: log?.unit_type ?? null,
            billedTier: tier || null,
            ...(providerErrorCode(payload) ? { upstreamErrorCode: providerErrorCode(payload) } : {}),
        });
    }
    const accepted = cases.filter((item) => item.accepted === true);
    const authoritative = accepted.length > 0 && accepted.every((item) => typeof mapping[String(item.requestSize)] === "string");
    return baseResult(input, {
        operationScope: "standalone_image_generation",
        endpoint: "/v1/images/generations",
        outcome: accepted.length ? "supported" : "inconclusive",
        supported: accepted.length > 0,
        statusCode: accepted.length ? 200 : Number(cases[0]?.statusCode || 500),
        usageSeen: accepted.some((item) => Boolean(item.usage && Object.keys(record(item.usage)).length)),
        imageOutputSeen: accepted.some((item) => Boolean(item.responseSize)),
        billingEvidence: authoritative ? { basis: "size_tier", authoritative: true, source: evidenceSource, sizeTierByRequestSize: mapping } : { basis: "unresolved", authoritative: false, source: "none" },
        cases,
    });
}

function baseResult(
    input: ProbeInput,
    result: Omit<CapabilityProbeResult, "version" | "provider" | "modelId" | "channelId" | "bindingId" | "operationScope" | "endpoint" | "probedAt" | "registryFingerprint"> & Partial<Pick<CapabilityProbeResult, "operationScope" | "endpoint">>,
): CapabilityProbeResult {
    return {
        version: 1,
        provider: "dflop",
        modelId: input.modelId,
        channelId: input.channel.id,
        bindingId: input.bindingId,
        operationScope: result.operationScope || "builtin_image_generation",
        endpoint: result.endpoint || "/v1/responses",
        ...result,
        probedAt: (input.now || (() => new Date().toISOString()))(),
        registryFingerprint: capabilityProbeFingerprint(input.profile),
    };
}

async function fetchProviderLog(fetcher: typeof fetch, channel: ProbeChannel, reference: string) {
    try {
        const url = new URL(endpoint(channel.baseUrl, "logs"));
        url.searchParams.set("ref", reference);
        url.searchParams.set("include", "none");
        url.searchParams.set("limit", "5");
        const response = await fetcher(url, { headers: { Authorization: `Bearer ${channel.apiKey}` } });
        if (!response.ok) return undefined;
        const body = record(await response.json());
        const data = Array.isArray(body.data) ? body.data.map(record) : [];
        return data.find((item) => item.request_id === reference || item.task_id === reference);
    } catch {
        return undefined;
    }
}

function classifyGptBilling(profile: ProviderPricingProfile, usage: Record<string, unknown>, imageCount: number, log?: Record<string, unknown>): CapabilityProbeResult["billingEvidence"] {
    const providerCost = scalar(log?.cost);
    if (!providerCost || !imageCount) return { basis: "unresolved", authoritative: false, source: "none" };
    const input = scalar(usage.input_tokens ?? log?.input_tokens) || "0";
    const output = scalar(usage.output_tokens ?? log?.output_tokens) || "0";
    const cached = scalar(record(usage.input_tokens_details).cached_tokens ?? log?.cached_tokens) || "0";
    const tokenCost = tokenPrice(profile, input, output, cached);
    const imagePrice = scalar(profile.raw.price_per_image);
    const imageCost = imagePrice ? decimal(imagePrice).times(decimal(imageCount)).toString() : undefined;
    let basis: CapabilityProbeResult["billingEvidence"]["basis"] = "unresolved";
    if ((log?.unit_type === null || log?.unit_type === "chat") && tokenCost && exactEqual(providerCost, tokenCost)) basis = "token_only";
    else if (log?.unit_type === "image" && imageCost && exactEqual(providerCost, imageCost)) basis = "per_image";
    else if (
        tokenCost &&
        imageCost &&
        decimal(providerCost)
            .minus(decimal(tokenCost).plus(decimal(imageCost)))
            .isZero()
    )
        basis = "token_plus_image";
    return basis === "unresolved"
        ? { basis, authoritative: false, source: "provider_task_record", providerUsageRecordId: log?.id === undefined ? undefined : String(log.id), providerCost }
        : { basis, authoritative: true, source: "provider_task_record", providerUsageRecordId: log?.id === undefined ? undefined : String(log.id), providerCost, tokenCost, imageCost, imageOutputCount: imageCount };
}

function tokenPrice(profile: ProviderPricingProfile, input: string, output: string, cached: string) {
    const inputRate = scalar(profile.raw.input_per_1m);
    const outputRate = scalar(profile.raw.output_per_1m);
    if (!inputRate || !outputRate) return undefined;
    const cachedRate = scalar(profile.raw.cached_input_per_1m) || inputRate;
    const uncachedInput = decimal(input).minus(decimal(cached));
    if (uncachedInput.isNegative()) return undefined;
    return uncachedInput
        .times(decimal(inputRate))
        .plus(decimal(cached).times(decimal(cachedRate)))
        .plus(decimal(output).times(decimal(outputRate)))
        .dividedBy(decimal(1_000_000))
        .toString();
}

function tierFromCost(cost: unknown, profile: ProviderPricingProfile) {
    const amount = scalar(cost);
    const normal = scalar(profile.raw.price_per_image);
    const large = scalar(profile.raw.price_per_image_large);
    if (!amount) return undefined;
    if (normal && exactEqual(amount, normal)) return "1K";
    if (large && exactEqual(amount, large)) return "2K";
    return undefined;
}

function normalizeTier(value: unknown) {
    const tier = text(value).toUpperCase();
    return tier === "1K" || tier === "2K" ? tier : undefined;
}

function completedResponse(value: unknown) {
    if (!Array.isArray(value)) return record(value);
    for (let index = value.length - 1; index >= 0; index -= 1) {
        const event = record(value[index]);
        if (event.type === "response.completed") return record(event.response);
    }
    return {};
}

function countImageEvents(value: unknown) {
    return Array.isArray(value) ? value.filter((item) => String(record(item).type || "").includes("image_generation") && String(record(item).type || "").includes("completed")).length : 0;
}

async function readResponse(response: Response): Promise<unknown> {
    const textBody = await response.text();
    if (response.headers.get("content-type")?.includes("text/event-stream"))
        return textBody
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]")
            .flatMap((line) => {
                try {
                    return [JSON.parse(line.slice(6))];
                } catch {
                    return [];
                }
            });
    try {
        return JSON.parse(textBody);
    } catch {
        return {};
    }
}

function endpoint(baseUrl: string, path: string) {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function headers(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function providerErrorCode(value: unknown) {
    const error = record(record(value).error);
    return text(error.code) || undefined;
}

function hasUsage(value: Record<string, unknown>) {
    return ["input_tokens", "output_tokens", "total_tokens"].some((key) => scalar(value[key]) !== undefined);
}

function parseSize(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    return match ? [Number(match[1]), Number(match[2])] : [];
}

function scalar(value: unknown) {
    return typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? String(value) : undefined;
}

function exactEqual(left: string, right: string) {
    return decimal(left).minus(decimal(right)).isZero();
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
