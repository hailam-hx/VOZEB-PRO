import type { BillableCapability } from "@/lib/billing/pricing";
import type { SystemAiUsageContext } from "./system-ai-billing";
import { systemAiUsageRequestFingerprint } from "./system-ai-billing";

type PricedGenerationConfig = {
    logicalModel?: string;
    model: string;
    capabilityProfile?: { supportsIdempotency?: boolean };
    usagePricing?: { logicalModelId: string; bindingId: string };
};

export function generationSystemAiUsageContext(config: PricedGenerationConfig, capability: BillableCapability, providerIdempotencyKey: string): SystemAiUsageContext | undefined {
    const pricing = config.usagePricing;
    const parsed = parseAttemptKey(providerIdempotencyKey);
    if (!pricing || !parsed) return undefined;
    const providerIdempotencySupported = config.capabilityProfile?.supportsIdempotency === true;
    return {
        businessRequestId: parsed.businessRequestId,
        requestFingerprint: systemAiUsageRequestFingerprint({ userId: "", businessRequestId: parsed.businessRequestId, logicalModel: pricing.logicalModelId, capability, payload: { businessRequestId: parsed.businessRequestId } }),
        attemptNumber: parsed.attemptNumber,
        bindingId: pricing.bindingId,
        providerIdempotencySupported,
        ...(providerIdempotencySupported ? { providerIdempotencyKey } : {}),
    };
}

export function usageRecoveryIdentity(businessRequestId: string) {
    const match = businessRequestId.match(/^(text|image|video|audio)-task:(.+)$/);
    if (!match?.[2]) return undefined;
    return { taskType: match[1] as "text" | "image" | "video" | "audio", taskId: match[2] };
}

function parseAttemptKey(value: string) {
    const normalized = value.trim();
    const match = normalized.match(/^((?:text|image|video|audio)-task:.+?):attempt:(\d+)(?::[^:]*)?$/);
    if (match) return { businessRequestId: match[1], attemptNumber: Number(match[2]) };
    const request = normalized.match(/^(video-request:.+)$/);
    return request ? { businessRequestId: request[1], attemptNumber: 1 } : undefined;
}
