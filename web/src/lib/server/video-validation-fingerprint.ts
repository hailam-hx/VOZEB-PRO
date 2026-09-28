import { createHash, createHmac } from "node:crypto";

import type { PricingComponent } from "@/lib/billing/pricing";

export type ValidationFingerprintV1 = {
    provider: string;
    endpointType: string | null;
    endpoints: { create: string; query: string; imageToVideo?: string; cancel?: string };
    protocol: { protocolId: string; requestSchemaVersion: string; parserVersion: string };
    capabilityProfile: { generationParameters: unknown; executionOptions: unknown; referenceContract: unknown };
    billing: { billingBasis: string[]; pricingRevision: string; normalizationRevision: string; conversionRevision: string; actualCostCapabilityRevision: string };
    runtime: { relevantConfigRevision: string; credentialRevision: string | null; idempotencyReplayContractRevision: string };
};

export type ValidationFingerprint = {
    fingerprintVersion: 1;
    fingerprintHashAlgorithm: "sha256";
    fingerprintHash: string;
    fingerprintSnapshot: ValidationFingerprintV1;
};

const SET_KEYS = new Set(["billingBasis", "resolutions", "durationSeconds", "aspectRatios", "referenceInputs", "videoReferenceModes", "qualities", "pixelSizes", "voices", "formats", "modes"]);

export function buildVideoValidationFingerprint(input: ValidationFingerprintV1): ValidationFingerprint {
    const fingerprintSnapshot = normalize(input) as ValidationFingerprintV1;
    return {
        fingerprintVersion: 1,
        fingerprintHashAlgorithm: "sha256",
        fingerprintHash: sha256(`model-validation-fingerprint:v1\n${canonicalJson(fingerprintSnapshot)}`),
        fingerprintSnapshot,
    };
}

export function buildVideoCanaryContractFingerprint(input: {
    executionFingerprint: ValidationFingerprint;
    caseId: string;
    pricingComponents: Pick<PricingComponent, "basis" | "dimension" | "when" | "operationScope" | "match" | "contextThresholdTokens" | "megapixelThreshold" | "freeQuantity">[];
    usageAlgorithm: string;
    requestBranch?: string;
}) {
    const execution = input.executionFingerprint.fingerprintSnapshot;
    const billingShape = [
        ...new Set(
            input.pricingComponents.map((component) =>
                canonicalJson({
                    basis: component.basis || component.dimension,
                    dimension: component.dimension,
                    operationScope: component.operationScope || null,
                    conditionKeys: Object.keys(component.when || {}).sort(),
                    billingBasis: component.when?.billingBasis || null,
                    hasMatch: Boolean(component.match),
                    hasContextThreshold: Boolean(component.contextThresholdTokens),
                    hasMegapixelThreshold: Boolean(component.megapixelThreshold),
                    hasFreeQuantity: Boolean(component.freeQuantity),
                }),
            ),
        ),
    ].sort(compare);
    const snapshot = {
        provider: execution.provider,
        endpointType: execution.endpointType,
        endpoints: execution.endpoints,
        protocol: execution.protocol,
        caseId: input.caseId,
        requestBranch: input.requestBranch || "standard",
        referenceTransport: execution.capabilityProfile.referenceContract,
        executionOptions: execution.capabilityProfile.executionOptions,
        billingBasis: execution.billing.billingBasis,
        billingShape,
        usageAlgorithm: input.usageAlgorithm,
        usageNormalization: execution.billing.normalizationRevision,
        idempotencyReplay: execution.runtime.idempotencyReplayContractRevision,
    };
    return {
        version: 1,
        hash: sha256(`video-canary-contract:v1\n${canonicalJson(snapshot)}`),
        sharedContractReason: `${execution.provider} · ${input.caseId} · ${input.usageAlgorithm} · 同一端点、请求/响应 schema 与计费维度形状`,
    };
}

export function buildValidationExecutionSnapshot(input: {
    fingerprint: ValidationFingerprint;
    bindingId: string;
    channelId: string;
    normalizedContext: unknown;
    pricingRevision: string;
    conversionRevision: string;
    requestPayloadDigest: string;
    idempotencyKey: string;
}) {
    return {
        hash: sha256(
            `model-validation-execution:v1\n${canonicalJson({
                fingerprintVersion: input.fingerprint.fingerprintVersion,
                fingerprintHash: input.fingerprint.fingerprintHash,
                bindingId: input.bindingId,
                channelId: input.channelId,
                normalizedContext: input.normalizedContext,
                pricingRevision: input.pricingRevision,
                conversionRevision: input.conversionRevision,
                requestPayloadDigest: input.requestPayloadDigest,
                idempotencyKey: input.idempotencyKey,
            })}`,
        ),
        payloadDigest: input.requestPayloadDigest,
        fingerprint: input.fingerprint,
    };
}

export function videoValidationCredentialRevision(apiKey: string, serverSecret: string) {
    if (!apiKey || !serverSecret) return null;
    return createHmac("sha256", serverSecret).update(apiKey).digest("hex");
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value));
}

function normalize(value: unknown, key = ""): unknown {
    if (Array.isArray(value)) {
        const normalized = value.map((item) => normalize(item));
        if (!SET_KEYS.has(key)) return normalized;
        return [...new Map(normalized.map((item) => [JSON.stringify(item), item])).values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    }
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .sort(([left], [right]) => compare(left, right))
                .map(([field, item]) => [field, normalize(item, field)]),
        );
    return value;
}

function compare(left: string, right: string) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
}
