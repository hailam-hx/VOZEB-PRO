import type { BillableCapability } from "@/lib/billing/pricing";
import type { SystemAiUsageContextDraft } from "./system-ai-billing";
import { systemAiUsageRequestFingerprint } from "./system-ai-billing";
import { resolveModelRequestTimeoutMs } from "./model-request-policy";

type PricedGenerationConfig = {
    logicalModel?: string;
    model: string;
    channelId?: string;
    capabilityProfile?: { supportsIdempotency?: boolean; timeoutMs?: number };
    usagePricing?: { logicalModelId: string; bindingId: string };
};

type PricedTextCandidate = {
    channelId: string;
    upstreamModel: string;
    binding: { id: string };
    capabilityProfile?: { supportsIdempotency?: boolean; timeoutMs?: number };
};

export function generationSystemAiUsageContext(config: PricedGenerationConfig, capability: BillableCapability, providerIdempotencyKey: string, userId: string): SystemAiUsageContextDraft | undefined {
    const pricing = config.usagePricing;
    const parsed = parseAttemptKey(providerIdempotencyKey);
    if (!pricing || !parsed || !config.channelId?.trim() || !userId.trim()) return undefined;
    const providerIdempotencySupported = config.capabilityProfile?.supportsIdempotency === true;
    return {
        businessRequestId: parsed.businessRequestId,
        userId: userId.trim(),
        channelId: config.channelId.trim(),
        capability,
        expiresAtMs: Date.now() + resolveModelRequestTimeoutMs(config, capability),
        requestFingerprint: systemAiUsageRequestFingerprint({ userId: userId.trim(), businessRequestId: parsed.businessRequestId, logicalModel: pricing.logicalModelId, capability, payload: { businessRequestId: parsed.businessRequestId } }),
        attemptNumber: parsed.attemptNumber,
        bindingId: pricing.bindingId,
        providerIdempotencySupported,
        ...(providerIdempotencySupported ? { providerIdempotencyKey } : {}),
    };
}

export function systemAiTextUsageContext(input: { candidate: PricedTextCandidate; userId: string; logicalModelId: string; businessRequestId: string; requestFingerprint: string; attemptNumber: number }): SystemAiUsageContextDraft {
    const providerIdempotencySupported = input.candidate.capabilityProfile?.supportsIdempotency === true;
    const providerIdempotencyKey = `${input.businessRequestId}:attempt:${input.attemptNumber}:${input.candidate.channelId}:${input.candidate.upstreamModel}`;
    return {
        userId: input.userId,
        channelId: input.candidate.channelId,
        capability: "text",
        expiresAtMs: Date.now() + resolveModelRequestTimeoutMs(input.candidate, "text"),
        businessRequestId: input.businessRequestId,
        requestFingerprint: input.requestFingerprint,
        attemptNumber: input.attemptNumber,
        bindingId: input.candidate.binding.id,
        providerIdempotencySupported,
        ...(providerIdempotencySupported ? { providerIdempotencyKey } : {}),
    };
}

export function usageRecoveryIdentity(businessRequestId: string) {
    const match = businessRequestId.match(/^(text|image|video|audio|voice-clone)-task:(.+)$/);
    if (!match?.[2]) return undefined;
    return { taskType: match[1] as "text" | "image" | "video" | "audio" | "voice-clone", taskId: match[2] };
}

function parseAttemptKey(value: string) {
    const normalized = value.trim();
    const match = normalized.match(/^((?:text|image|video|audio|voice-clone)-task:.+?):attempt:(\d+)(?::[^:]*)?$/);
    if (match) return { businessRequestId: match[1], attemptNumber: Number(match[2]) };
    const request = normalized.match(/^(video-request:.+)$/);
    return request ? { businessRequestId: request[1], attemptNumber: 1 } : undefined;
}
