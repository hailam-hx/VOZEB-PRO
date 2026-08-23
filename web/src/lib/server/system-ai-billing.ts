import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SYSTEM_AI_LOGICAL_MODEL_HEADER = "x-vozeb-pro-logical-model";
export const SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER = "x-vozeb-pro-points-idempotency-key";
export const SYSTEM_AI_POINTS_SIGNATURE_HEADER = "x-vozeb-pro-points-signature";
export const SYSTEM_AI_UPSTREAM_MODEL_HEADER = "x-vozeb-pro-upstream-model";
export const SYSTEM_AI_BILLING_FINGERPRINT_HEADER = "x-vozeb-pro-billing-fingerprint";
export const SYSTEM_AI_BILLING_ATTEMPT_NUMBER_HEADER = "x-vozeb-pro-billing-attempt-number";
export const SYSTEM_AI_BILLING_BINDING_HEADER = "x-vozeb-pro-billing-binding-id";
export const SYSTEM_AI_PROVIDER_IDEMPOTENCY_SUPPORTED_HEADER = "x-vozeb-pro-provider-idempotency-supported";
export const SYSTEM_AI_PROVIDER_IDEMPOTENCY_KEY_HEADER = "x-vozeb-pro-provider-idempotency-key";
export const SYSTEM_AI_USAGE_HOLD_HEADER = "x-vozeb-pro-usage-hold-id";
export const SYSTEM_AI_USAGE_ATTEMPT_HEADER = "x-vozeb-pro-usage-attempt-number";
export const SYSTEM_AI_USAGE_FINGERPRINT_HEADER = "x-vozeb-pro-usage-request-fingerprint";

const SYSTEM_AI_POINTS_SIGNATURE_VERSION = "v1";
const SYSTEM_AI_POINTS_PROCESS_SECRET = "__vozebProSystemAiPointsProcessSecret" as const;

export type SystemAiBilling = {
    pointsCost?: number;
    pointsRecordId?: string;
};

export type SystemAiUsageContext = {
    businessRequestId: string;
    requestFingerprint: string;
    attemptNumber: number;
    bindingId: string;
    providerIdempotencySupported: boolean;
    providerIdempotencyKey?: string;
};

export type SystemAiUsageBilling = { holdId: string; attemptNumber: number; requestFingerprint: string };

export function systemAiBillingHeaders(logicalModel: string, idempotencyKey?: string | SystemAiUsageContext, upstreamModel?: string) {
    const normalizedLogicalModel = logicalModel.trim();
    const context = typeof idempotencyKey === "object" ? normalizeUsageContext(idempotencyKey) : undefined;
    const normalizedIdempotencyKey = typeof idempotencyKey === "string" ? idempotencyKey.trim() : context?.businessRequestId;
    const normalizedUpstreamModel = upstreamModel?.trim();
    return {
        ...(normalizedLogicalModel ? { [SYSTEM_AI_LOGICAL_MODEL_HEADER]: normalizedLogicalModel } : {}),
        ...(normalizedIdempotencyKey
            ? {
                  [SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER]: normalizedIdempotencyKey,
                  [SYSTEM_AI_POINTS_SIGNATURE_HEADER]: context
                      ? signSystemAiUsageContext(normalizedLogicalModel, normalizedUpstreamModel || "", context)
                      : signSystemAiBusinessRequest(normalizedLogicalModel, normalizedIdempotencyKey, normalizedUpstreamModel || ""),
              }
            : {}),
        ...(context
            ? {
                  [SYSTEM_AI_BILLING_FINGERPRINT_HEADER]: context.requestFingerprint,
                  [SYSTEM_AI_BILLING_ATTEMPT_NUMBER_HEADER]: String(context.attemptNumber),
                  [SYSTEM_AI_BILLING_BINDING_HEADER]: context.bindingId,
                  [SYSTEM_AI_PROVIDER_IDEMPOTENCY_SUPPORTED_HEADER]: context.providerIdempotencySupported ? "1" : "0",
                  ...(context.providerIdempotencyKey ? { [SYSTEM_AI_PROVIDER_IDEMPOTENCY_KEY_HEADER]: context.providerIdempotencyKey } : {}),
              }
            : {}),
        ...(normalizedUpstreamModel ? { [SYSTEM_AI_UPSTREAM_MODEL_HEADER]: normalizedUpstreamModel } : {}),
    };
}

export function readVerifiedSystemAiBusinessRequestId(headers: Headers, logicalModel: string, upstreamModel: string) {
    const context = readVerifiedSystemAiUsageContext(headers, logicalModel, upstreamModel);
    if (context) return context.businessRequestId;
    const businessRequestId = headers.get(SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER)?.trim().slice(0, 200) || "";
    const signature = headers.get(SYSTEM_AI_POINTS_SIGNATURE_HEADER)?.trim() || "";
    if (!businessRequestId || !signature) return undefined;
    const expected = signSystemAiBusinessRequest(logicalModel.trim(), businessRequestId, upstreamModel.trim());
    const receivedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) return undefined;
    return businessRequestId;
}

export function readVerifiedSystemAiUsageContext(headers: Headers, logicalModel: string, upstreamModel: string): SystemAiUsageContext | undefined {
    const context = normalizeUsageContext({
        businessRequestId: headers.get(SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER) || "",
        requestFingerprint: headers.get(SYSTEM_AI_BILLING_FINGERPRINT_HEADER) || "",
        attemptNumber: Number(headers.get(SYSTEM_AI_BILLING_ATTEMPT_NUMBER_HEADER)),
        bindingId: headers.get(SYSTEM_AI_BILLING_BINDING_HEADER) || "",
        providerIdempotencySupported: headers.get(SYSTEM_AI_PROVIDER_IDEMPOTENCY_SUPPORTED_HEADER) === "1",
        providerIdempotencyKey: headers.get(SYSTEM_AI_PROVIDER_IDEMPOTENCY_KEY_HEADER) || undefined,
    });
    const signature = headers.get(SYSTEM_AI_POINTS_SIGNATURE_HEADER)?.trim() || "";
    if (!context || !signature) return undefined;
    const expected = signSystemAiUsageContext(logicalModel.trim(), upstreamModel.trim(), context);
    const receivedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes) ? context : undefined;
}

export function systemAiPointsIdempotencyKey(input: { userId: string; businessRequestId: string; logicalModel: string; channelId: string; upstreamModel: string; callType: string }) {
    return `system-ai:${stableDigest([input.userId, input.businessRequestId, input.logicalModel, input.channelId, input.upstreamModel, input.callType])}`;
}

export function systemAiRequestFingerprint(input: { method: string; callType: string; logicalModel: string; channelId: string; upstreamModel: string; usageKind: string; amount: number; bodyDigest: string }) {
    return stableDigest([input.method.toUpperCase(), input.callType, input.logicalModel, input.channelId, input.upstreamModel, input.usageKind, String(input.amount), input.bodyDigest]);
}

export function systemAiUsageRequestFingerprint(input: { userId: string; businessRequestId: string; logicalModel: string; capability: string; payload: unknown }) {
    return stableDigest([input.userId, input.businessRequestId, normalizeBillingModel(input.logicalModel), input.capability, stableJson(input.payload)]);
}

export function systemAiUsageResponseHeaders(input: SystemAiUsageBilling) {
    return { [SYSTEM_AI_USAGE_HOLD_HEADER]: input.holdId, [SYSTEM_AI_USAGE_ATTEMPT_HEADER]: String(input.attemptNumber), [SYSTEM_AI_USAGE_FINGERPRINT_HEADER]: input.requestFingerprint };
}

export function readSystemAiUsageBilling(headers: Headers): SystemAiUsageBilling | undefined {
    const holdId = headers.get(SYSTEM_AI_USAGE_HOLD_HEADER)?.trim().slice(0, 200) || "";
    const attemptNumber = Number(headers.get(SYSTEM_AI_USAGE_ATTEMPT_HEADER));
    const requestFingerprint = headers.get(SYSTEM_AI_USAGE_FINGERPRINT_HEADER)?.trim().toLowerCase() || "";
    return holdId && Number.isSafeInteger(attemptNumber) && attemptNumber > 0 && /^[a-f0-9]{64}$/.test(requestFingerprint) ? { holdId, attemptNumber, requestFingerprint } : undefined;
}

export function systemAiIdempotencyKey(scope: string, ...parts: string[]) {
    const prefix =
        scope
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .slice(0, 40) || "system-ai";
    const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
    return `${prefix}:${digest}`;
}

function signSystemAiBusinessRequest(logicalModel: string, businessRequestId: string, upstreamModel: string) {
    return createHmac("sha256", systemAiPointsSigningSecret())
        .update([SYSTEM_AI_POINTS_SIGNATURE_VERSION, normalizeBillingModel(logicalModel), businessRequestId, normalizeBillingModel(upstreamModel)].join("\0"))
        .digest("base64url");
}

function signSystemAiUsageContext(logicalModel: string, upstreamModel: string, context: SystemAiUsageContext) {
    return createHmac("sha256", systemAiPointsSigningSecret())
        .update(
            [
                SYSTEM_AI_POINTS_SIGNATURE_VERSION,
                normalizeBillingModel(logicalModel),
                normalizeBillingModel(upstreamModel),
                context.businessRequestId,
                context.requestFingerprint,
                String(context.attemptNumber),
                context.bindingId,
                context.providerIdempotencySupported ? "1" : "0",
                context.providerIdempotencyKey || "",
            ].join("\0"),
        )
        .digest("base64url");
}

function normalizeUsageContext(value: SystemAiUsageContext): SystemAiUsageContext | undefined {
    const businessRequestId = value.businessRequestId.trim().slice(0, 200);
    const requestFingerprint = value.requestFingerprint.trim().toLowerCase();
    const bindingId = value.bindingId.trim().slice(0, 200);
    const providerIdempotencyKey = value.providerIdempotencyKey?.trim().slice(0, 200) || undefined;
    if (!businessRequestId || !/^[a-f0-9]{64}$/.test(requestFingerprint) || !Number.isSafeInteger(value.attemptNumber) || value.attemptNumber < 1 || !bindingId) return undefined;
    if (value.providerIdempotencySupported && !providerIdempotencyKey) return undefined;
    return { businessRequestId, requestFingerprint, attemptNumber: value.attemptNumber, bindingId, providerIdempotencySupported: value.providerIdempotencySupported, ...(providerIdempotencyKey ? { providerIdempotencyKey } : {}) };
}

function stableDigest(parts: string[]) {
    return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) || "undefined";
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")}}`;
}

function normalizeBillingModel(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}

function systemAiPointsSigningSecret() {
    const configured = process.env.VOZEB_PRO_ENCRYPTION_KEY?.trim();
    if (configured) return configured;
    const scope = globalThis as typeof globalThis & { __vozebProSystemAiPointsProcessSecret?: Buffer };
    scope[SYSTEM_AI_POINTS_PROCESS_SECRET] ||= randomBytes(32);
    return scope[SYSTEM_AI_POINTS_PROCESS_SECRET];
}

export function readSystemAiBilling(headers: Headers): SystemAiBilling {
    const rawCost = headers.get("x-vozeb-pro-points-cost");
    const cost = rawCost === null ? undefined : Number(rawCost);
    return {
        pointsCost: cost !== undefined && Number.isFinite(cost) && cost >= 0 ? cost : undefined,
        pointsRecordId: headers.get("x-vozeb-pro-points-record-id") || undefined,
    };
}

export function hasSystemAiCharge(billing: SystemAiBilling): billing is Required<SystemAiBilling> {
    return billing.pointsCost !== undefined && Boolean(billing.pointsRecordId);
}
