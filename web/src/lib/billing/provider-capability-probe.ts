import type { PricingOperationScope } from "./pricing";
import { canonicalProviderPricingDimensionId, providerCapabilityRegistryFingerprint, type ProviderPricingDimension, type ProviderPricingProfile, type ProviderPricingWarning } from "./provider-pricing";

export type CapabilityProbeBillingBasis = "unresolved" | "token_only" | "per_image" | "token_plus_image" | "size_tier";

export type CapabilityProbeResult = {
    version: 1;
    provider: "dflop";
    modelId: string;
    channelId: string;
    bindingId: string;
    operationScope: PricingOperationScope;
    endpoint: string;
    outcome: "supported" | "unsupported" | "inconclusive";
    supported: boolean;
    statusCode: number;
    upstreamErrorCode?: string;
    usageSeen: boolean;
    imageOutputSeen: boolean;
    billingEvidence: {
        basis: CapabilityProbeBillingBasis;
        authoritative: boolean;
        source: "none" | "response_usage" | "provider_task_record" | "response_tier" | "controlled_provider_probe";
        [key: string]: unknown;
    };
    probedAt: string;
    registryFingerprint: string;
    requestId?: string;
    taskId?: string;
    cases?: Array<Record<string, unknown>>;
};

export function capabilityProbeFingerprint(profile: Pick<ProviderPricingProfile, "modelId" | "raw" | "metadata">) {
    return providerCapabilityRegistryFingerprint(profile);
}

export function capabilityProbeStillApplies(result: CapabilityProbeResult, profile: Pick<ProviderPricingProfile, "modelId" | "raw" | "metadata">) {
    return canonicalModelId(result.modelId) === canonicalModelId(profile.modelId) && result.registryFingerprint === capabilityProbeFingerprint(profile);
}

export function applyCapabilityProbeToPricingProfile(profile: ProviderPricingProfile, result: CapabilityProbeResult): ProviderPricingProfile {
    if (canonicalModelId(profile.modelId) !== canonicalModelId(result.modelId)) throw new Error("探测结果模型不匹配");
    if (!capabilityProbeStillApplies(result, profile)) throw new Error("探测结果与当前 DFLOP registry revision 不匹配");

    const rawImagePrice = scalarText(profile.raw.price_per_image);
    const metadata: Record<string, unknown> = {
        ...(profile.metadata || {}),
        ...(rawImagePrice ? { unscopedProviderPrices: { ...record(profile.metadata?.unscopedProviderPrices), price_per_image: rawImagePrice } } : {}),
        capabilityProbes: { ...record(profile.metadata?.capabilityProbes), [result.operationScope]: structuredClone(result) },
    };
    const retainedWarnings = profile.warnings.filter(
        (warning) =>
            warning.code !== "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT" &&
            warning.code !== "AMBIGUOUS_BILLING_AFTER_CAPABILITY_PROBE" &&
            warning.code !== "MISSING_MACHINE_READABLE_SIZE_TIER_MAPPING" &&
            warning.code !== "MISSING_AUTHORITATIVE_SIZE_TIER_MAPPING",
    );
    let dimensions = profile.dimensions.filter((dimension) => !(dimension.kind === "IMAGE_OUTPUT" && dimension.key === "price_per_image"));
    let warnings = retainedWarnings;
    let status = profile.status;

    if (result.operationScope === "standalone_image_generation") {
        dimensions = dimensions.filter((dimension) => dimension.kind !== "IMAGE_LARGE");
        const mapping = record(result.billingEvidence.sizeTierByRequestSize);
        if (result.billingEvidence.authoritative && result.billingEvidence.basis === "size_tier" && Object.keys(mapping).length && rawImagePrice) {
            const largePrice = scalarText(profile.raw.price_per_image_large);
            const mapped = Object.entries(mapping).flatMap(([resolution, tier]) => {
                if (tier === "1K") return [imageOutputDimension(rawImagePrice, profile.syncedAt, result.operationScope, resolution)];
                if (tier === "2K" && largePrice) return [imageLargeDimension(largePrice, profile.syncedAt, result.operationScope, resolution)];
                return [];
            });
            const mappedDimensionIds = new Set(mapped.map((dimension) => dimension.id));
            const missingFields = profile.missingFields.filter((field) => !mappedDimensionIds.has(field));
            warnings = retainedWarnings.filter((warning) => !(warning.code === "MISSING_UPSTREAM_VALUE" && warning.field && mappedDimensionIds.has(warning.field)));
            dimensions = [...dimensions, ...mapped];
            metadata.imageLargeTierContract = "audited_exact_size_mapping";
            metadata.imageSizeTierMapping = { source: "controlled_provider_probe", verifiedAt: result.probedAt, mappingVersion: result.registryFingerprint, requestSizeToTier: structuredClone(mapping) };
            status = statusWithoutProbeWarning({ ...profile, missingFields }, warnings);
            return { ...profile, status, dimensions, missingFields, warnings, metadata, conversion: undefined, operationPricingStatus: undefined };
        } else {
            warnings = [...retainedWarnings, { code: "MISSING_AUTHORITATIVE_SIZE_TIER_MAPPING", field: "price_per_image_large", message: "受控探测尚未取得 request size 到 DFLOP authoritative billing tier 的确定映射" }];
            status = "PARTIAL";
        }
        return { ...profile, status, dimensions, warnings, metadata, conversion: undefined, operationPricingStatus: undefined };
    }

    if (result.outcome === "unsupported") {
        metadata.builtinImageGenerationContract = { operationScope: result.operationScope, billingBasis: "unsupported", source: "controlled_provider_probe", verifiedAt: result.probedAt };
        status = statusWithoutProbeWarning(profile, retainedWarnings);
    } else if (!result.billingEvidence.authoritative || result.billingEvidence.basis === "unresolved") {
        warnings = [...retainedWarnings, probeWarning()];
        metadata.builtinImageGenerationContract = { operationScope: result.operationScope, billingBasis: "unresolved", source: "controlled_provider_probe", verifiedAt: result.probedAt };
        status = "PARTIAL";
    } else {
        metadata.builtinImageGenerationContract = { operationScope: result.operationScope, billingBasis: result.billingEvidence.basis, source: "controlled_provider_probe", verifiedAt: result.probedAt };
        if ((result.billingEvidence.basis === "per_image" || result.billingEvidence.basis === "token_plus_image") && rawImagePrice) dimensions = [...dimensions, imageOutputDimension(rawImagePrice, profile.syncedAt, result.operationScope)];
        status = statusWithoutProbeWarning(profile, retainedWarnings);
    }

    return { ...profile, status, dimensions, warnings, metadata, conversion: undefined, operationPricingStatus: undefined };
}

export function reapplyStoredCapabilityProbe(profile: ProviderPricingProfile): ProviderPricingProfile {
    const probes = record(profile.metadata?.capabilityProbes);
    return Object.values(probes).reduce<ProviderPricingProfile>((current, value) => {
        const probe = normalizeCapabilityProbeResult(value);
        return probe && capabilityProbeStillApplies(probe, current) ? applyCapabilityProbeToPricingProfile(current, probe) : current;
    }, profile);
}

export function normalizeCapabilityProbeResult(value: unknown): CapabilityProbeResult | undefined {
    const item = record(value);
    const evidence = record(item.billingEvidence);
    if (item.version !== 1 || item.provider !== "dflop" || typeof item.modelId !== "string" || typeof item.channelId !== "string" || typeof item.bindingId !== "string") return undefined;
    if (typeof item.operationScope !== "string" || typeof item.endpoint !== "string" || !["supported", "unsupported", "inconclusive"].includes(String(item.outcome))) return undefined;
    if (typeof item.supported !== "boolean" || typeof item.statusCode !== "number" || typeof item.usageSeen !== "boolean" || typeof item.imageOutputSeen !== "boolean") return undefined;
    if (!["unresolved", "token_only", "per_image", "token_plus_image", "size_tier"].includes(String(evidence.basis)) || typeof evidence.authoritative !== "boolean" || typeof evidence.source !== "string") return undefined;
    if (typeof item.probedAt !== "string" || typeof item.registryFingerprint !== "string") return undefined;
    return structuredClone(value) as CapabilityProbeResult;
}

function imageOutputDimension(value: string, syncedAt: string, operationScope: PricingOperationScope, resolution?: string): ProviderPricingDimension {
    return {
        id: canonicalProviderPricingDimensionId({ kind: "IMAGE_OUTPUT", ...(resolution ? { conditions: { resolution } } : {}) }),
        kind: "IMAGE_OUTPUT",
        key: "price_per_image",
        unit: "dflop_credit/image",
        source: "upstream",
        upstreamValue: value,
        effectiveValue: value,
        syncedAt,
        operationScope,
        ...(resolution ? { conditions: { resolution } } : {}),
    };
}

function imageLargeDimension(value: string, syncedAt: string, operationScope: PricingOperationScope, resolution: string): ProviderPricingDimension {
    return {
        id: canonicalProviderPricingDimensionId({ kind: "IMAGE_LARGE", conditions: { resolution } }),
        kind: "IMAGE_LARGE",
        key: "price_per_image_large",
        unit: "dflop_credit/image",
        source: "upstream",
        upstreamValue: value,
        effectiveValue: value,
        syncedAt,
        operationScope,
        conditions: { resolution },
    };
}

function statusWithoutProbeWarning(profile: ProviderPricingProfile, warnings: ProviderPricingWarning[]) {
    if (profile.missingFields.length) return "STALE" as const;
    if (!profile.dimensions.some((dimension) => dimension.kind !== "IMAGE_OUTPUT") || profile.unknownFields.length || warnings.length) return "PARTIAL" as const;
    return "READY" as const;
}

function probeWarning(): ProviderPricingWarning {
    return { code: "AMBIGUOUS_BILLING_AFTER_CAPABILITY_PROBE", field: "price_per_image", message: "能力探测已确认可生成图片，但 authoritative usage 尚不能证明 token 与图片价格是否叠加" };
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function scalarText(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function canonicalModelId(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}
