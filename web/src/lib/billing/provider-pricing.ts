import { convertDflopCreditsToHotx, pricingConversionSnapshot, type ProviderPricingConversionSnapshot, type SystemPricingPolicy } from "./pricing-policy";
import type { ProviderCostUnit } from "./money";
import { validatePricingRateCard, type PricingComponent, type PricingOperationScope, type PricingRateCardV1 } from "./pricing";
import { resolveSeedanceModelFamily } from "./seedance-usage";

export type ProviderPricingStatus = "READY" | "PARTIAL" | "NEEDS_REVIEW" | "STALE";
export type ProviderOperationPricingStatus = ProviderPricingStatus | "UNSUPPORTED";
export type OperationPricingStatus = Partial<Record<PricingOperationScope, { status: ProviderOperationPricingStatus; reasons: string[] }>>;

export type ProviderPricingDimensionKind =
    | "TOKEN_INPUT"
    | "TOKEN_CACHED_INPUT"
    | "TOKEN_OUTPUT"
    | "CACHE_CREATION"
    | "IMAGE_OUTPUT"
    | "IMAGE_INPUT"
    | "IMAGE_LARGE"
    | "VIDEO_SECOND"
    | "VIDEO_INPUT_SECOND"
    | "VIDEO_TOKEN"
    | "VIDEO_SECOND_STAGE"
    | "TTS_CHARACTER"
    | "VOICE_CLONE_CALL"
    | "MUSIC_GENERATION"
    | "AVATAR_CREATE"
    | "AVATAR_SECOND"
    | "TRANSCRIPT_CALL"
    | "PER_GENERATION"
    | "PER_CALL"
    | "PER_CHARACTER"
    | "PER_SECOND"
    | "SERVER_TOOL_CALL"
    | "REQUEST"
    | "OTHER";

export type ProviderPricingDimension = {
    id: string;
    kind: ProviderPricingDimensionKind;
    key?: string;
    unit: string;
    source: "upstream" | "manual";
    upstreamValue?: string;
    effectiveValue: string;
    syncedAt: string;
    conditions?: Record<string, string>;
    metadata?: Record<string, unknown>;
    providerCostHotxCredits?: string;
    operationScope?: PricingOperationScope;
};

export type ProviderPricingWarning = {
    code:
        | "INVALID_VALUE"
        | "UNKNOWN_FIELD"
        | "MISSING_BASIS"
        | "MISSING_UPSTREAM_VALUE"
        | "PRICING_DRIFT"
        | "NON_EXECUTABLE_DIMENSION"
        | "UNSUPPORTED_CACHE_CREATION"
        | "UNSUPPORTED_LONG_CONTEXT_TIER"
        | "UNSUPPORTED_SERVER_TOOL_CALL"
        | "UNSUPPORTED_IMAGE_SIZE_TIER"
        | "UNSUPPORTED_IMAGE_INPUT_COST"
        | "UNSUPPORTED_SECOND_STAGE"
        | "MISSING_USAGE_CONTRACT"
        | "MISSING_MACHINE_READABLE_SIZE_THRESHOLD"
        | "MISSING_MACHINE_READABLE_SIZE_TIER_MAPPING"
        | "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT"
        | "AMBIGUOUS_BILLING_AFTER_CAPABILITY_PROBE"
        | "MISSING_AUTHORITATIVE_SIZE_TIER_MAPPING"
        | "DOC_CONTRACT_DIVERGENCE"
        | "DOC_REGISTRY_CONTRACT_DIVERGENCE";
    field?: string;
    message: string;
};

export type ProviderPricingProfile = {
    provider: "dflop";
    modelId: string;
    status: ProviderPricingStatus;
    syncedAt: string;
    raw: Record<string, unknown>;
    discount?: string;
    dimensions: ProviderPricingDimension[];
    unknownFields: string[];
    missingFields: string[];
    warnings: ProviderPricingWarning[];
    metadata?: Record<string, unknown>;
    conversion?: ProviderPricingConversionSnapshot;
    operationPricingStatus?: OperationPricingStatus;
};

export function providerCapabilityRegistryFingerprint(profile: Pick<ProviderPricingProfile, "modelId" | "raw" | "metadata">) {
    return `dflop-capability-v1:${stableJson({
        modelId: profile.modelId
            .trim()
            .replace(/^models\//i, "")
            .toLowerCase(),
        raw: profile.raw,
        registry: {
            category: profile.metadata?.category,
            endpointType: profile.metadata?.endpointType,
            supportedProtocols: profile.raw.supported_protocols,
            supportsImageGeneration: profile.raw.supports_image_gen,
        },
    })}`;
}

export function canonicalProviderPricingDimensionId(input: Pick<ProviderPricingDimension, "kind" | "conditions">) {
    const kind = input.kind.toLowerCase().replaceAll("_", "-");
    const conditions = Object.entries(canonicalPricingConditions(input.kind, input.conditions))
        .map(([key, value]) => [normalizeIdentifierPart(key), normalizeIdentifierPart(value)] as const)
        .filter(([key, value]) => key && value)
        .sort(([left], [right]) => left.localeCompare(right));
    return conditions.length ? `${kind}:${conditions.map(([key, value]) => `${key}=${value}`).join(",")}` : kind;
}

function canonicalPricingConditions(kind: ProviderPricingDimensionKind, conditions: Record<string, string> | undefined) {
    if (!conditions?.tier) return conditions || {};
    if (kind === "VIDEO_TOKEN") {
        const [billingBasis, resolution, ...rest] = conditions.tier.split("@").map((part) => part.trim().toLowerCase());
        if ((billingBasis !== "default" && billingBasis !== "with_video_input") || rest.length) return conditions;
        const { tier: _legacyTier, ...current } = conditions;
        return { ...current, billingBasis, ...(resolution ? { resolution } : {}) };
    }
    if ((kind === "VIDEO_SECOND" || kind === "VIDEO_SECOND_STAGE") && /^\d+p$/i.test(conditions.tier.trim())) {
        const { tier: resolution, ...current } = conditions;
        return { ...current, resolution: resolution.trim().toLowerCase() };
    }
    return conditions;
}

export function normalizeProviderPricingProfile(value: unknown): ProviderPricingProfile | undefined {
    if (!isRecord(value) || value.provider !== "dflop" || typeof value.modelId !== "string" || typeof value.syncedAt !== "string") return undefined;
    if (!isStatus(value.status) || !Array.isArray(value.dimensions)) return undefined;
    const dimensions = dedupeDimensions(value.dimensions.map(normalizeDimension).filter((item): item is ProviderPricingDimension => Boolean(item)));
    const raw = isRecord(value.raw) ? structuredClone(value.raw) : {};
    const metadata = isRecord(value.metadata) ? structuredClone(value.metadata) : undefined;
    const conversion = normalizeConversion(value.conversion);
    const operationPricingStatus = normalizeOperationPricingStatus(value.operationPricingStatus);
    const presentDimensions = new Set(dimensions.map((dimension) => dimension.id));
    const missingFields = [...new Set(stringArray(value.missingFields).map(canonicalLegacyDimensionField))].filter((field) => !presentDimensions.has(field));
    const nonExecutableFields = new Set(providerPricingNonExecutableFields({ dimensions }));
    const warnings = (
        Array.isArray(value.warnings)
            ? value.warnings
                  .filter(isRecord)
                  .flatMap((warning) =>
                      typeof warning.code === "string" && typeof warning.message === "string"
                          ? [{ code: warning.code as ProviderPricingWarning["code"], message: warning.message, ...(typeof warning.field === "string" ? { field: warning.field } : {}) }]
                          : [],
                  )
            : []
    ).filter((warning) => {
        if (warning.code === "MISSING_UPSTREAM_VALUE" && warning.field && presentDimensions.has(canonicalLegacyDimensionField(warning.field))) return false;
        if (warning.code === "NON_EXECUTABLE_DIMENSION" && warning.field && !nonExecutableFields.has(warning.field)) return false;
        return true;
    });
    const unknownFields = stringArray(value.unknownFields);
    const status = value.status === "STALE" && !missingFields.length ? (!dimensions.length ? "NEEDS_REVIEW" : unknownFields.length || warnings.length ? "PARTIAL" : "READY") : value.status;
    return {
        provider: "dflop",
        modelId: value.modelId,
        status,
        syncedAt: value.syncedAt,
        raw,
        ...(typeof value.discount === "string" ? { discount: value.discount } : {}),
        dimensions,
        unknownFields,
        missingFields,
        warnings,
        ...(metadata ? { metadata } : {}),
        ...(conversion ? { conversion } : {}),
        ...(operationPricingStatus ? { operationPricingStatus } : {}),
    };
}

function normalizeConversion(value: unknown): ProviderPricingConversionSnapshot | undefined {
    if (!isRecord(value)) return undefined;
    const pricingPolicyVersion = stringValue(value.pricingPolicyVersion);
    const dflopCreditsPerCny = stringValue(value.dflopCreditsPerCny);
    const cnyToUsd = stringValue(value.cnyToUsd);
    const hotxUsdPerCredit = stringValue(value.hotxUsdPerCredit);
    const calculatedAt = stringValue(value.calculatedAt);
    const source = value.dflopCreditsPerCnySource;
    if (!pricingPolicyVersion || !dflopCreditsPerCny || !cnyToUsd || !hotxUsdPerCredit || !calculatedAt || (source !== "upstream" && source !== "manual" && source !== "default")) return undefined;
    return {
        pricingPolicyVersion,
        dflopCreditsPerCny,
        dflopCreditsPerCnySource: source,
        ...(stringValue(value.dflopCurrencyConfigVersion) ? { dflopCurrencyConfigVersion: stringValue(value.dflopCurrencyConfigVersion) } : {}),
        cnyToUsd,
        hotxUsdPerCredit,
        calculatedAt,
    };
}

function normalizeDimension(value: unknown): ProviderPricingDimension | undefined {
    if (!isRecord(value) || !isKind(value.kind) || typeof value.unit !== "string" || typeof value.effectiveValue !== "string" || typeof value.syncedAt !== "string") return undefined;
    if (value.source !== "upstream" && value.source !== "manual") return undefined;
    const rawConditions = isRecord(value.conditions) ? Object.fromEntries(Object.entries(value.conditions).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined;
    const canonicalConditions = canonicalPricingConditions(value.kind, rawConditions);
    const conditions = Object.keys(canonicalConditions).length ? canonicalConditions : undefined;
    const metadata = isRecord(value.metadata) ? structuredClone(value.metadata) : undefined;
    return {
        id: canonicalProviderPricingDimensionId({ kind: value.kind, conditions }),
        kind: value.kind,
        unit: value.unit,
        source: value.source,
        effectiveValue: value.effectiveValue,
        syncedAt: value.syncedAt,
        ...(typeof value.key === "string" ? { key: value.key } : {}),
        ...(typeof value.upstreamValue === "string" ? { upstreamValue: value.upstreamValue } : {}),
        ...(conditions && Object.keys(conditions).length ? { conditions } : {}),
        ...(metadata ? { metadata } : {}),
        ...(typeof value.providerCostHotxCredits === "string" ? { providerCostHotxCredits: value.providerCostHotxCredits } : {}),
        ...(typeof value.operationScope === "string" ? { operationScope: value.operationScope as PricingOperationScope } : {}),
    };
}

function dedupeDimensions(dimensions: ProviderPricingDimension[]) {
    const deduped = new Map<string, ProviderPricingDimension>();
    for (const dimension of dimensions) {
        const identity = dimensionIdentity(dimension);
        const current = deduped.get(identity);
        if (!current) {
            deduped.set(identity, dimension);
            continue;
        }
        if (dimension.source === "manual" && current.source !== "manual") {
            deduped.set(identity, { ...dimension, upstreamValue: current.upstreamValue ?? dimension.upstreamValue, syncedAt: current.syncedAt > dimension.syncedAt ? current.syncedAt : dimension.syncedAt });
        } else if (current.source !== "manual" && dimension.syncedAt > current.syncedAt) {
            deduped.set(identity, dimension);
        }
    }
    return [...deduped.values()];
}

function canonicalLegacyDimensionField(field: string) {
    const videoToken = field.match(/^video-token:tier=(default|with_video_input)(?:@(.+))?$/i);
    if (videoToken) return canonicalProviderPricingDimensionId({ kind: "VIDEO_TOKEN", conditions: { billingBasis: videoToken[1], ...(videoToken[2] ? { resolution: videoToken[2] } : {}) } });
    const videoSecond = field.match(/^(video-second(?:-stage)?):tier=(\d+p)$/i);
    if (videoSecond) return `${videoSecond[1].toLowerCase()}:resolution=${videoSecond[2].toLowerCase()}`;
    return field;
}

export function reconcileProviderPricingProfile(previous: ProviderPricingProfile | undefined, incoming: ProviderPricingProfile): ProviderPricingProfile {
    if (!previous) return incoming;
    const previousDimensions = new Map(previous.dimensions.map((dimension) => [dimensionIdentity(dimension), dimension]));
    const incomingIdentities = new Set<string>();
    const warnings = [...incoming.warnings];
    const dimensions = incoming.dimensions.map((dimension) => {
        const identity = dimensionIdentity(dimension);
        incomingIdentities.add(identity);
        const current = previousDimensions.get(identity);
        if (current?.source !== "manual") return dimension;
        const reconciled = { ...dimension, source: "manual" as const, effectiveValue: current.effectiveValue, providerCostHotxCredits: undefined };
        if (reconciled.upstreamValue !== reconciled.effectiveValue) warnings.push({ code: "PRICING_DRIFT", field: dimension.id, message: `${dimension.id} 的人工价格与 DFLOP 上游价格不同` });
        return reconciled;
    });
    const missingFields: string[] = [];
    const completeSeedanceLiteTiers = hasCompleteSeedanceLiteTokenTiers(incoming);
    for (const dimension of previous.dimensions) {
        if (incomingIdentities.has(dimensionIdentity(dimension))) continue;
        if (dimension.key && isRecord(incoming.metadata?.unscopedProviderPrices) && incoming.metadata.unscopedProviderPrices[dimension.key] !== undefined) continue;
        if (completeSeedanceLiteTiers && dimension.source === "upstream" && (dimension.kind === "VIDEO_SECOND_STAGE" || (dimension.kind === "VIDEO_TOKEN" && !dimension.conditions?.resolution))) continue;
        dimensions.push({ ...dimension, providerCostHotxCredits: undefined });
        missingFields.push(dimension.id);
        warnings.push({ code: "MISSING_UPSTREAM_VALUE", field: dimension.id, message: `DFLOP 上游本次未返回 ${dimension.id}，已保留最后有效价格` });
    }
    const savedProbes = isRecord(previous.metadata?.capabilityProbes) ? previous.metadata.capabilityProbes : undefined;
    const applicableProbes = savedProbes
        ? Object.fromEntries(
              Object.entries(savedProbes).filter(
                  ([, probe]) =>
                      isRecord(probe) &&
                      probe.registryFingerprint === providerCapabilityRegistryFingerprint(incoming) &&
                      String(probe.modelId || "")
                          .trim()
                          .toLowerCase() === incoming.modelId.trim().toLowerCase(),
              ),
          )
        : {};
    const metadata = Object.keys(applicableProbes).length ? { ...(incoming.metadata || {}), capabilityProbes: applicableProbes } : incoming.metadata;
    const hasDrift = warnings.some((warning) => warning.code === "PRICING_DRIFT");
    return { ...incoming, status: missingFields.length ? "STALE" : hasDrift && incoming.status === "READY" ? "PARTIAL" : incoming.status, dimensions, missingFields, warnings, ...(metadata ? { metadata } : {}), conversion: undefined };
}

function hasCompleteSeedanceLiteTokenTiers(profile: ProviderPricingProfile) {
    if (profile.provider !== "dflop" || !profile.modelId.toLowerCase().endsWith("-lite") || !resolveSeedanceModelFamily(profile.modelId) || profile.raw.video_second_stage_per_second !== undefined) return false;
    const resolutions = isRecord(profile.raw.video_price_tiers) ? Object.keys(profile.raw.video_price_tiers) : [];
    if (!resolutions.length || !isRecord(profile.raw.video_token_price_per_1m)) return false;
    return resolutions.every((resolution) =>
        ["default", "with_video_input"].every((billingBasis) => profile.dimensions.some((dimension) => dimension.kind === "VIDEO_TOKEN" && dimension.conditions?.resolution === resolution && dimension.conditions?.billingBasis === billingBasis)),
    );
}

export function restoreProviderPricingDimension(profile: ProviderPricingProfile, dimensionId: string): ProviderPricingProfile {
    const dimensions = profile.dimensions.map((dimension) =>
        dimension.id === dimensionId && dimension.upstreamValue !== undefined ? { ...dimension, source: "upstream" as const, effectiveValue: dimension.upstreamValue, providerCostHotxCredits: undefined } : dimension,
    );
    const warnings = profile.warnings.filter((warning) => !(warning.code === "PRICING_DRIFT" && warning.field === dimensionId));
    return { ...profile, dimensions, warnings, status: profile.status === "PARTIAL" && !warnings.length ? "READY" : profile.status, conversion: undefined };
}

export function applyProviderPricingConversion(profile: ProviderPricingProfile, policy: SystemPricingPolicy, calculatedAt: string): ProviderPricingProfile {
    const dimensions = profile.dimensions.map((dimension) => ({ ...dimension, providerCostHotxCredits: convertDflopCreditsToHotx(dimension.effectiveValue, policy) }));
    const nonExecutable = providerPricingNonExecutableDimensions({ ...profile, dimensions });
    const executableWarningCodes = new Set<ProviderPricingWarning["code"]>([
        "NON_EXECUTABLE_DIMENSION",
        "UNSUPPORTED_CACHE_CREATION",
        "UNSUPPORTED_LONG_CONTEXT_TIER",
        "UNSUPPORTED_SERVER_TOOL_CALL",
        "UNSUPPORTED_IMAGE_SIZE_TIER",
        "UNSUPPORTED_IMAGE_INPUT_COST",
        "UNSUPPORTED_SECOND_STAGE",
        "MISSING_USAGE_CONTRACT",
        "MISSING_MACHINE_READABLE_SIZE_THRESHOLD",
        "MISSING_MACHINE_READABLE_SIZE_TIER_MAPPING",
        "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT",
        "AMBIGUOUS_BILLING_AFTER_CAPABILITY_PROBE",
    ]);
    const warnings = [
        ...profile.warnings.filter((warning) => !executableWarningCodes.has(warning.code)),
        ...nonExecutable.map((dimension) => ({ code: nonExecutableReason(dimension, executableContext(profile)), field: dimension.key || dimension.id, message: nonExecutableMessage(dimension, executableContext(profile)) })),
    ];
    return {
        ...profile,
        status: profile.status === "READY" && (nonExecutable.length > 0 || profile.unknownFields.length > 0) ? "PARTIAL" : profile.status,
        dimensions,
        warnings,
        conversion: pricingConversionSnapshot(policy, calculatedAt),
        operationPricingStatus: buildOperationPricingStatus({ ...profile, dimensions }, nonExecutable),
    };
}

function buildOperationPricingStatus(profile: ProviderPricingProfile, nonExecutable: ProviderPricingDimension[]): OperationPricingStatus {
    const blocked = new Set(nonExecutable.map(dimensionIdentity));
    const statuses: OperationPricingStatus = {};
    for (const dimension of profile.dimensions.filter((item) => item.effectiveValue !== "0")) {
        const scope = dimension.operationScope || operationScopeForDimension(dimension.kind);
        const reason = blocked.has(dimensionIdentity(dimension)) ? nonExecutableReason(dimension, executableContext(profile)) : undefined;
        const current = statuses[scope];
        statuses[scope] = {
            status: reason || current?.status === "PARTIAL" ? "PARTIAL" : "READY",
            reasons: [...new Set([...(current?.reasons || []), ...(reason ? [reason] : [])])],
        };
    }
    if (isRecord(profile.metadata?.builtinImageGenerationContract) && (profile.metadata.builtinImageGenerationContract.billingBasis === "token" || profile.metadata.builtinImageGenerationContract.billingBasis === "token_only")) {
        statuses.builtin_image_generation = { status: statuses.text_generation?.status || "READY", reasons: statuses.text_generation?.reasons || [] };
    }
    if (isRecord(profile.metadata?.capabilityProbes)) {
        for (const [scope, value] of Object.entries(profile.metadata.capabilityProbes)) {
            if (!isRecord(value)) continue;
            const operationScope = scope as PricingOperationScope;
            const evidence = isRecord(value.billingEvidence) ? value.billingEvidence : undefined;
            if (value.outcome === "unsupported") statuses[operationScope] = { status: "UNSUPPORTED", reasons: [value.upstreamErrorCode === "tool_not_supported" ? "TOOL_NOT_SUPPORTED" : "UPSTREAM_OPERATION_UNSUPPORTED"] };
            else if (!evidence?.authoritative || evidence.basis === "unresolved")
                statuses[operationScope] = { status: "PARTIAL", reasons: [operationScope === "standalone_image_generation" ? "MISSING_AUTHORITATIVE_SIZE_TIER_MAPPING" : "AMBIGUOUS_BILLING_AFTER_CAPABILITY_PROBE"] };
            else if (!statuses[operationScope] || statuses[operationScope]?.status === "READY") statuses[operationScope] = { status: "READY", reasons: [] };
        }
    }
    return statuses;
}

function normalizeOperationPricingStatus(value: unknown): OperationPricingStatus | undefined {
    if (!isRecord(value)) return undefined;
    const result: OperationPricingStatus = {};
    for (const [scope, entry] of Object.entries(value)) {
        if (!isRecord(entry) || (!isStatus(entry.status) && entry.status !== "UNSUPPORTED")) continue;
        result[scope as PricingOperationScope] = { status: entry.status, reasons: stringArray(entry.reasons) };
    }
    return Object.keys(result).length ? result : undefined;
}

export function providerPricingNonExecutableFields(profile: Pick<ProviderPricingProfile, "dimensions">) {
    return [...new Set(providerPricingNonExecutableDimensions(profile).map((dimension) => dimension.key || dimension.id))];
}

function providerPricingNonExecutableDimensions(profile: Pick<ProviderPricingProfile, "dimensions"> & { metadata?: Record<string, unknown> }) {
    const context = executableContext(profile);
    return profile.dimensions.filter((dimension) => dimension.effectiveValue !== "0" && !executablePricingComponent(dimension, context));
}

export function providerPricingProfileToCostRateCard(profile: ProviderPricingProfile): PricingRateCardV1 | undefined {
    const context = executableContext(profile);
    const tokenVideo = profile.dimensions.some((dimension) => dimension.kind === "VIDEO_TOKEN" && executablePricingComponent(dimension, context));
    const components = profile.dimensions.flatMap((dimension) => {
        if (dimension.effectiveValue === "0") return [];
        if (tokenVideo && dimension.kind === "VIDEO_SECOND") return [];
        const component = executablePricingComponent(dimension, context);
        if (!component || dimension.providerCostHotxCredits === undefined) return [];
        const priced = { ...component, unitPrice: dimension.providerCostHotxCredits };
        const contract = isRecord(profile.metadata?.builtinImageGenerationContract) ? profile.metadata.builtinImageGenerationContract : undefined;
        const duplicateForBuiltin = component.operationScope === "text_generation" && (contract?.billingBasis === "token" || contract?.billingBasis === "token_only" || contract?.billingBasis === "token_plus_image");
        return duplicateForBuiltin ? [priced, { ...priced, id: `${priced.id}:builtin-image`, operationScope: "builtin_image_generation" as const }] : [priced];
    });
    return components.length ? validatePricingRateCard({ version: 1, components }) : undefined;
}

export function providerPricingCostUnit(policy: SystemPricingPolicy): ProviderCostUnit {
    return {
        kind: "provider-native",
        provider: "hotx",
        unit: "credit",
        usdConversion: { version: policy.version, usdPerUnit: policy.hotxUsdPerCredit },
    };
}

type ExecutableContext = {
    hasLongContext: boolean;
    longContextThresholdTokens?: string;
    imageLargeThresholdMegapixels?: string;
    imageLargeTierContract?: string;
    holdTierWhenSizeMissing?: "normal" | "large";
    category?: string;
    builtinImageBillingBasis?: string;
};

function executableContext(profile: Pick<ProviderPricingProfile, "dimensions"> & { metadata?: Record<string, unknown> }): ExecutableContext {
    const threshold = profile.metadata?.longContextThresholdTokens;
    const imageThreshold = profile.metadata?.imageLargeThresholdMegapixels;
    return {
        hasLongContext: profile.dimensions.some((dimension) => dimension.conditions?.context === "long"),
        ...(typeof threshold === "number" && Number.isSafeInteger(threshold) && threshold > 0 ? { longContextThresholdTokens: String(threshold) } : {}),
        ...(typeof imageThreshold === "string" && imageThreshold ? { imageLargeThresholdMegapixels: imageThreshold } : {}),
        ...(typeof profile.metadata?.imageLargeTierContract === "string" ? { imageLargeTierContract: profile.metadata.imageLargeTierContract } : {}),
        ...(profile.metadata?.holdTierWhenSizeMissing === "normal" || profile.metadata?.holdTierWhenSizeMissing === "large" ? { holdTierWhenSizeMissing: profile.metadata.holdTierWhenSizeMissing } : {}),
        ...(typeof profile.metadata?.category === "string" ? { category: profile.metadata.category.toLowerCase() } : {}),
        ...(isRecord(profile.metadata?.builtinImageGenerationContract) && typeof profile.metadata.builtinImageGenerationContract.billingBasis === "string" ? { builtinImageBillingBasis: profile.metadata.builtinImageGenerationContract.billingBasis } : {}),
    };
}

function operationScopeForDimension(kind: ProviderPricingDimensionKind): PricingOperationScope {
    if (kind.startsWith("TOKEN_") || kind === "CACHE_CREATION" || kind === "SERVER_TOOL_CALL") return "text_generation";
    if (kind.startsWith("IMAGE_")) return "standalone_image_generation";
    if (kind.startsWith("VIDEO_")) return "video_generation";
    if (kind === "TTS_CHARACTER" || kind === "PER_CHARACTER") return "tts";
    if (kind === "VOICE_CLONE_CALL") return "voice_clone";
    if (kind === "MUSIC_GENERATION") return "music_generation";
    if (kind.startsWith("AVATAR_")) return "avatar";
    return "other";
}

function executablePricingComponent(dimension: ProviderPricingDimension, context: ExecutableContext): Omit<PricingComponent, "unitPrice"> | undefined {
    const base = { id: dimension.id, operationScope: dimension.operationScope || operationScopeForDimension(dimension.kind) };
    const textTier = dimension.conditions?.context === "long" ? "long" : context.hasLongContext ? "normal" : undefined;
    const tier = textTier && context.longContextThresholdTokens ? { when: { contextTier: textTier }, contextThresholdTokens: context.longContextThresholdTokens } : textTier ? undefined : {};
    if (dimension.kind === "TOKEN_INPUT" && tier) return { ...base, dimension: "inputTokens", basis: "TOKEN_INPUT", per: "1000000", ...tier };
    if (dimension.kind === "TOKEN_CACHED_INPUT" && tier) return { ...base, dimension: "cachedInputTokens", basis: "TOKEN_CACHED_INPUT", per: "1000000", ...tier };
    if (dimension.kind === "TOKEN_OUTPUT" && tier) return { ...base, dimension: "outputTokens", basis: "TOKEN_OUTPUT", per: "1000000", ...tier };
    if (dimension.kind === "CACHE_CREATION") return { ...base, dimension: "cacheCreationTokens", basis: "CACHE_CREATION", per: "1000000" };
    if (dimension.kind === "SERVER_TOOL_CALL") return { ...base, dimension: "serverToolCalls", basis: "SERVER_TOOL_CALL", per: "1" };
    if (dimension.kind === "IMAGE_OUTPUT" && (context.category !== "text" || (dimension.operationScope === "builtin_image_generation" && (context.builtinImageBillingBasis === "per_image" || context.builtinImageBillingBasis === "token_plus_image"))))
        return {
            ...base,
            dimension: "count",
            basis: "IMAGE_OUTPUT",
            per: "1",
            ...(dimension.conditions?.resolution
                ? { when: { resolution: dimension.conditions.resolution } }
                : context.imageLargeThresholdMegapixels
                  ? { when: { megapixelTier: "normal" }, megapixelThreshold: context.imageLargeThresholdMegapixels, ...(context.holdTierWhenSizeMissing ? { missingMegapixelTier: context.holdTierWhenSizeMissing } : {}) }
                  : {}),
        };
    if (dimension.kind === "IMAGE_INPUT")
        return {
            ...base,
            dimension: "inputImageCount",
            basis: "IMAGE_INPUT",
            per: "1",
            ...(typeof dimension.metadata?.freeQuantity === "string" ? { freeQuantity: dimension.metadata.freeQuantity } : {}),
        };
    if (dimension.kind === "IMAGE_LARGE" && context.imageLargeThresholdMegapixels)
        return {
            ...base,
            dimension: "count",
            basis: "IMAGE_LARGE",
            per: "1",
            when: { megapixelTier: "large" },
            megapixelThreshold: context.imageLargeThresholdMegapixels,
            ...(context.holdTierWhenSizeMissing ? { missingMegapixelTier: context.holdTierWhenSizeMissing } : {}),
        };
    if (dimension.kind === "IMAGE_LARGE" && dimension.conditions?.resolution) return { ...base, dimension: "count", basis: "IMAGE_LARGE", per: "1", when: { resolution: dimension.conditions.resolution } };
    if (dimension.kind === "VIDEO_SECOND") return { ...base, dimension: "durationSeconds", basis: "VIDEO_SECOND", per: "1", ...(dimension.conditions?.resolution ? { when: { resolution: dimension.conditions.resolution } } : {}) };
    if (dimension.kind === "VIDEO_INPUT_SECOND") return { ...base, dimension: "durationSeconds", basis: "VIDEO_INPUT_SECOND", per: "1" };
    if (dimension.kind === "VIDEO_TOKEN" && dimension.conditions?.billingBasis)
        return { ...base, dimension: "outputTokens", basis: "VIDEO_TOKEN", per: "1000000", when: { billingBasis: dimension.conditions.billingBasis, ...(dimension.conditions.resolution ? { resolution: dimension.conditions.resolution } : {}) } };
    if (dimension.kind === "VIDEO_SECOND_STAGE" && dimension.conditions?.resolution) return { ...base, dimension: "durationSeconds", basis: "VIDEO_SECOND_STAGE", per: "1", when: { resolution: dimension.conditions.resolution } };
    if (dimension.kind === "TTS_CHARACTER") return { ...base, dimension: "characters", basis: "TTS_CHARACTER", per: "1" };
    if (dimension.kind === "VOICE_CLONE_CALL") return { ...base, dimension: "request", basis: "VOICE_CLONE_CALL", per: "1" };
    if (dimension.kind === "MUSIC_GENERATION") return { ...base, dimension: "count", basis: "MUSIC_GENERATION", per: "1" };
    if (dimension.kind === "AVATAR_CREATE") return { ...base, dimension: "request", basis: "AVATAR_CREATE", per: "1" };
    if (dimension.kind === "AVATAR_SECOND") return { ...base, dimension: "durationSeconds", basis: "AVATAR_SECOND", per: "1" };
    if (dimension.kind === "TRANSCRIPT_CALL") return { ...base, dimension: "request", basis: "TRANSCRIPT_CALL", per: "1" };
    if (dimension.kind === "PER_GENERATION") return { ...base, dimension: "count", basis: "PER_GENERATION", per: "1" };
    if (dimension.kind === "PER_CALL" || dimension.kind === "REQUEST") return { ...base, dimension: "request", basis: "PER_CALL", per: "1" };
    if (dimension.kind === "PER_CHARACTER") return { ...base, dimension: "characters", basis: "PER_CHARACTER", per: "1" };
    if (dimension.kind === "PER_SECOND") return { ...base, dimension: "durationSeconds", basis: "PER_SECOND", per: "1" };
    return undefined;
}

function nonExecutableReason(dimension: ProviderPricingDimension, context: ExecutableContext): ProviderPricingWarning["code"] {
    if (dimension.kind === "CACHE_CREATION") return "UNSUPPORTED_CACHE_CREATION";
    if (dimension.conditions?.context === "long") return "UNSUPPORTED_LONG_CONTEXT_TIER";
    if (dimension.kind === "SERVER_TOOL_CALL") return "UNSUPPORTED_SERVER_TOOL_CALL";
    if (dimension.kind === "IMAGE_LARGE" && context.imageLargeTierContract === "megapixel_threshold") return "MISSING_MACHINE_READABLE_SIZE_THRESHOLD";
    if (dimension.kind === "IMAGE_LARGE" && context.imageLargeTierContract === "named_size_mapping") return "MISSING_MACHINE_READABLE_SIZE_TIER_MAPPING";
    if (dimension.kind === "IMAGE_LARGE") return "UNSUPPORTED_IMAGE_SIZE_TIER";
    if (dimension.kind === "IMAGE_OUTPUT" && context.category === "text") return "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT";
    if (dimension.kind === "IMAGE_OUTPUT") return "MISSING_USAGE_CONTRACT";
    if (dimension.kind === "IMAGE_INPUT") return "UNSUPPORTED_IMAGE_INPUT_COST";
    if (dimension.kind === "VIDEO_SECOND_STAGE") return "UNSUPPORTED_SECOND_STAGE";
    return "NON_EXECUTABLE_DIMENSION";
}

function nonExecutableMessage(dimension: ProviderPricingDimension, context: ExecutableContext) {
    const field = dimension.key || dimension.id;
    if (dimension.kind === "IMAGE_LARGE" && context.imageLargeTierContract === "megapixel_threshold") return `DFLOP 文档描述了图片尺寸阈值，但 live registry 未提供机器可读阈值：${field}`;
    if (dimension.kind === "IMAGE_LARGE" && context.imageLargeTierContract === "named_size_mapping") return `DFLOP live registry 未提供可执行的图片尺寸档位映射：${field}`;
    if (dimension.kind === "IMAGE_LARGE") return `图片大尺寸价格缺少可确定匹配的上游尺寸条件：${field}`;
    if (dimension.kind === "IMAGE_OUTPUT" && context.category === "text") return `跨模态图片价格尚未证明 endpoint、operation、authoritative usage 与 token 是否叠加：${field}`;
    if (dimension.kind === "IMAGE_OUTPUT") return `当前 usage contract 无法可靠取得图片输出数量：${field}`;
    if (dimension.conditions?.context === "long") return `长上下文价格缺少可执行阈值：${field}`;
    return `未进入可执行成本模型：${field}`;
}

function dimensionIdentity(dimension: ProviderPricingDimension) {
    return `${canonicalProviderPricingDimensionId(dimension)}\0${dimension.unit.trim().toLowerCase()}`;
}

function isStatus(value: unknown): value is ProviderPricingStatus {
    return value === "READY" || value === "PARTIAL" || value === "NEEDS_REVIEW" || value === "STALE";
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}

function isKind(value: unknown): value is ProviderPricingDimensionKind {
    return (
        value === "TOKEN_INPUT" ||
        value === "TOKEN_CACHED_INPUT" ||
        value === "TOKEN_OUTPUT" ||
        value === "CACHE_CREATION" ||
        value === "IMAGE_OUTPUT" ||
        value === "IMAGE_INPUT" ||
        value === "IMAGE_LARGE" ||
        value === "VIDEO_SECOND" ||
        value === "VIDEO_INPUT_SECOND" ||
        value === "VIDEO_TOKEN" ||
        value === "VIDEO_SECOND_STAGE" ||
        value === "TTS_CHARACTER" ||
        value === "VOICE_CLONE_CALL" ||
        value === "MUSIC_GENERATION" ||
        value === "AVATAR_CREATE" ||
        value === "AVATAR_SECOND" ||
        value === "TRANSCRIPT_CALL" ||
        value === "PER_GENERATION" ||
        value === "PER_CALL" ||
        value === "PER_CHARACTER" ||
        value === "PER_SECOND" ||
        value === "SERVER_TOOL_CALL" ||
        value === "REQUEST" ||
        value === "OTHER"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeIdentifierPart(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "-");
}
