import type { LogicalModel } from "@/lib/auth/store-types";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";

import { decimal } from "./decimal";
import { chargeablePricingQuantity, countUnicodeCodePoints, estimateTextInputTokens, validatePricingRateCard, type BillableCapability, type PricingBasis, type PricingComponent } from "./pricing";
import { computeSeedanceHoldUsage, estimateSeedanceUsage, type SeedanceFrame, type SeedanceModelFamily } from "./seedance-usage";

export type CreativeSaleEstimateStatus = "ESTIMATED" | "CONSERVATIVE_ESTIMATE" | "OFFICIAL_SALE_PRICE_MISSING" | "PRICING_DIMENSION_MISSING" | "USAGE_INPUT_MISSING" | "NOT_ESTIMATABLE";
export type EstimationReason =
    | "FIXED_IMAGE_COUNT"
    | "FIXED_INPUT_IMAGE_COUNT"
    | "FIXED_CHARACTER_COUNT"
    | "FIXED_CALL_COUNT"
    | "FIXED_GENERATION_COUNT"
    | "REQUESTED_OUTPUT_DURATION"
    | "VERIFIED_INPUT_VIDEO_DURATION"
    | "DETERMINISTIC_VIDEO_TOKEN_USAGE"
    | "VERIFIED_REFERENCE_DURATION"
    | "KNOWN_INPUT_TOKEN_ESTIMATE"
    | "FREE_OFFICIAL_PRICE"
    | "MAX_OUTPUT_TOKEN_BOUND"
    | "CACHE_CREATION_BOUND"
    | "SERVER_TOOL_CALL_BOUND"
    | "REFERENCE_VIDEO_DURATION_CEILING"
    | "SAFE_PIXEL_BOUND"
    | "INPUT_VIDEO_DURATION_CEILING"
    | "AVATAR_DURATION_CEILING"
    | "MISSING_OFFICIAL_SALE_PRICE"
    | "PRICING_DIMENSION_MISSING"
    | "MAX_OUTPUT_TOKENS_MISSING"
    | "CACHE_CREATION_USAGE_UNKNOWN"
    | "SERVER_TOOL_CALL_COUNT_UNKNOWN"
    | "INPUT_VIDEO_DURATION_UNKNOWN"
    | "AVATAR_DURATION_UNKNOWN"
    | "UNSUPPORTED_PRICING_BASIS";

export type CreativeSaleEstimateComponent = {
    componentId: string;
    dimension: PricingBasis;
    quantity: string;
    unit: string;
    rate: string;
    credits: string;
};

export type CreativeSaleEstimate = {
    status: CreativeSaleEstimateStatus;
    credits?: string;
    upperBoundCredits?: string;
    components: CreativeSaleEstimateComponent[];
    details: {
        saleRateCardRevision?: string;
        pricingBasis: PricingBasis[];
        assumptions: string[];
        reasons: EstimationReason[];
        billingBasis?: "default" | "with_video_input";
        resolution?: string;
        estimatedTokens?: string;
        inputVideoDurationSeconds?: string;
        outputDurationSeconds?: string;
    };
};

export type CreativeSaleRequestContext = {
    capability: BillableCapability;
    prompt?: string;
    count?: number | string;
    resolution?: string;
    resolutionTier?: string;
    megapixelTier?: "normal" | "large";
    quality?: string;
    format?: string;
    durationSeconds?: number | string;
    maxOutputTokens?: number | string;
    cacheCreationTokens?: number | string;
    serverToolCallCount?: number | string;
    hasReferenceVideo?: boolean;
    verifiedAssets?: CreativeAsset[];
    inputImageCount?: number | string;
    verifiedInputVideoDurationSeconds?: number | string;
    verifiedInputAudioDurationSeconds?: number | string;
    inputDurationCeilingSeconds?: number | string;
    seedanceModelFamily?: SeedanceModelFamily;
    seedanceFrame?: SeedanceFrame;
    seedanceConservativeFrame?: boolean;
};

type QuantityResult = { quantity: string; conservative?: boolean; assumption?: string; reason?: EstimationReason } | { missing: true; reason?: EstimationReason } | { unsupported: true; reason?: EstimationReason };

type NormalizedRequestContext = ReturnType<typeof normalizedContext>;
type PricingDimensionEstimator = {
    requiredInputs: string[];
    estimateKind: "exact" | "upper-bound-capable";
    authoritativeUsage: string;
    estimate: (component: PricingComponent, context: NormalizedRequestContext) => QuantityResult & { inputDurationSeconds?: string };
};

const outputCount = (component: PricingComponent, context: NormalizedRequestContext): QuantityResult => {
    if (component.dimension === "megapixels") {
        const megapixels = imageMegapixels(context.resolution, context.count);
        return megapixels ? { quantity: megapixels, reason: "FIXED_IMAGE_COUNT" } : { missing: true, reason: "PRICING_DIMENSION_MISSING" };
    }
    return { quantity: context.count, reason: "FIXED_GENERATION_COUNT" };
};
const callCount = (): QuantityResult => ({ quantity: "1", reason: "FIXED_CALL_COUNT" });
const outputSeconds = (_component: PricingComponent, context: NormalizedRequestContext): QuantityResult =>
    context.durationSeconds ? { quantity: decimal(context.durationSeconds).times(decimal(context.count)).toString(), reason: "REQUESTED_OUTPUT_DURATION" } : { missing: true, reason: "PRICING_DIMENSION_MISSING" };

export const pricingDimensionEstimatorRegistry: Record<PricingBasis, PricingDimensionEstimator> = {
    TOKEN_INPUT: {
        requiredInputs: ["prompt"],
        estimateKind: "exact",
        authoritativeUsage: "request input tokens",
        estimate: (_component, context) => ({ quantity: context.capability === "text" ? estimateTextInputTokens(context.prompt) : "0", reason: "KNOWN_INPUT_TOKEN_ESTIMATE" }),
    },
    TOKEN_CACHED_INPUT: { requiredInputs: [], estimateKind: "exact", authoritativeUsage: "actual cached input tokens", estimate: () => ({ quantity: "0", assumption: "cache-hit-not-assumed" }) },
    TOKEN_OUTPUT: {
        requiredInputs: ["maxOutputTokens"],
        estimateKind: "upper-bound-capable",
        authoritativeUsage: "actual output tokens",
        estimate: (_component, context) =>
            context.maxOutputTokens ? { quantity: context.maxOutputTokens, conservative: true, assumption: "configured-max-output-tokens", reason: "MAX_OUTPUT_TOKEN_BOUND" } : { missing: true, reason: "MAX_OUTPUT_TOKENS_MISSING" },
    },
    CACHE_CREATION: {
        requiredInputs: ["cacheCreationTokens"],
        estimateKind: "upper-bound-capable",
        authoritativeUsage: "actual cache creation tokens",
        estimate: (_component, context) => (context.cacheCreationTokens ? { quantity: context.cacheCreationTokens, conservative: true, reason: "CACHE_CREATION_BOUND" } : { missing: true, reason: "CACHE_CREATION_USAGE_UNKNOWN" }),
    },
    SERVER_TOOL_CALL: {
        requiredInputs: ["serverToolCallCount"],
        estimateKind: "upper-bound-capable",
        authoritativeUsage: "actual server tool calls",
        estimate: (_component, context) => (context.serverToolCallCount ? { quantity: context.serverToolCallCount, conservative: true, reason: "SERVER_TOOL_CALL_BOUND" } : { missing: true, reason: "SERVER_TOOL_CALL_COUNT_UNKNOWN" }),
    },
    IMAGE_OUTPUT: { requiredInputs: ["count"], estimateKind: "exact", authoritativeUsage: "successful output images", estimate: (component, context) => ({ ...outputCount(component, context), reason: "FIXED_IMAGE_COUNT" }) },
    IMAGE_INPUT: { requiredInputs: ["verifiedAssets"], estimateKind: "exact", authoritativeUsage: "accepted input images", estimate: (_component, context) => ({ quantity: context.inputImageCount, reason: "FIXED_INPUT_IMAGE_COUNT" }) },
    IMAGE_LARGE: { requiredInputs: ["count", "resolution"], estimateKind: "exact", authoritativeUsage: "successful large output images", estimate: outputCount },
    VIDEO_SECOND: { requiredInputs: ["durationSeconds"], estimateKind: "exact", authoritativeUsage: "actual output video seconds", estimate: outputSeconds },
    VIDEO_INPUT_SECOND: {
        requiredInputs: ["verifiedInputVideoDurationSeconds"],
        estimateKind: "upper-bound-capable",
        authoritativeUsage: "verified input video seconds",
        estimate: (_component, context) => {
            if (!context.hasReferenceVideo) return { quantity: "0", reason: "VERIFIED_INPUT_VIDEO_DURATION" };
            if (context.verifiedInputVideoDurationSeconds) return { quantity: decimal(context.verifiedInputVideoDurationSeconds).times(decimal(context.count)).toString(), reason: "VERIFIED_INPUT_VIDEO_DURATION" };
            return context.inputDurationCeilingSeconds
                ? { quantity: decimal(context.inputDurationCeilingSeconds).times(decimal(context.count)).toString(), conservative: true, assumption: "input-video-duration-ceiling", reason: "INPUT_VIDEO_DURATION_CEILING" }
                : { missing: true, reason: "INPUT_VIDEO_DURATION_UNKNOWN" };
        },
    },
    VIDEO_TOKEN: { requiredInputs: ["durationSeconds", "seedanceFrame"], estimateKind: "upper-bound-capable", authoritativeUsage: "authoritative completion tokens", estimate: (_component, context) => seedanceQuantity(context) },
    VIDEO_SECOND_STAGE: { requiredInputs: ["durationSeconds"], estimateKind: "exact", authoritativeUsage: "actual second-stage output seconds", estimate: outputSeconds },
    TTS_CHARACTER: { requiredInputs: ["prompt"], estimateKind: "exact", authoritativeUsage: "normalized input characters", estimate: (_component, context) => ({ quantity: countUnicodeCodePoints(context.prompt), reason: "FIXED_CHARACTER_COUNT" }) },
    VOICE_CLONE_CALL: { requiredInputs: [], estimateKind: "exact", authoritativeUsage: "successful clone request", estimate: callCount },
    MUSIC_GENERATION: { requiredInputs: ["count"], estimateKind: "exact", authoritativeUsage: "generation requests", estimate: outputCount },
    AVATAR_CREATE: { requiredInputs: [], estimateKind: "exact", authoritativeUsage: "avatar creation request", estimate: callCount },
    AVATAR_SECOND: {
        requiredInputs: ["durationSeconds or verified audio duration"],
        estimateKind: "upper-bound-capable",
        authoritativeUsage: "actual avatar output seconds",
        estimate: (_component, context) => {
            const duration = context.durationSeconds || context.verifiedInputAudioDurationSeconds;
            if (duration) return { quantity: decimal(duration).times(decimal(context.count)).toString(), reason: "REQUESTED_OUTPUT_DURATION" };
            return context.inputDurationCeilingSeconds
                ? { quantity: decimal(context.inputDurationCeilingSeconds).times(decimal(context.count)).toString(), conservative: true, assumption: "avatar-duration-ceiling", reason: "AVATAR_DURATION_CEILING" }
                : { missing: true, reason: "AVATAR_DURATION_UNKNOWN" };
        },
    },
    TRANSCRIPT_CALL: { requiredInputs: [], estimateKind: "exact", authoritativeUsage: "transcript request", estimate: callCount },
    PER_GENERATION: { requiredInputs: ["count"], estimateKind: "exact", authoritativeUsage: "generation requests", estimate: outputCount },
    PER_CALL: { requiredInputs: [], estimateKind: "exact", authoritativeUsage: "API request", estimate: callCount },
    PER_CHARACTER: { requiredInputs: ["prompt"], estimateKind: "exact", authoritativeUsage: "normalized input characters", estimate: (_component, context) => ({ quantity: countUnicodeCodePoints(context.prompt), reason: "FIXED_CHARACTER_COUNT" }) },
    PER_SECOND: { requiredInputs: ["durationSeconds"], estimateKind: "exact", authoritativeUsage: "actual billed seconds", estimate: outputSeconds },
};

export function estimateCreativeSaleCredits(input: { logicalModel: LogicalModel; requestContext: CreativeSaleRequestContext }): CreativeSaleEstimate {
    const emptyDetails: CreativeSaleEstimate["details"] = { pricingBasis: [], assumptions: [], reasons: [] };
    if (!input.logicalModel.saleRateCard) return { status: "OFFICIAL_SALE_PRICE_MISSING", components: [], details: { ...emptyDetails, reasons: ["MISSING_OFFICIAL_SALE_PRICE"] } };
    let rateCard;
    try {
        rateCard = validatePricingRateCard(input.logicalModel.saleRateCard);
    } catch {
        return { status: "NOT_ESTIMATABLE", components: [], details: { ...emptyDetails, reasons: ["UNSUPPORTED_PRICING_BASIS"] } };
    }
    const context = normalizedContext(input.requestContext);
    const billableComponents = rateCard.components.filter((component) => !decimal(component.unitPrice).isZero());
    if (!billableComponents.length) {
        return { status: "ESTIMATED", credits: "0", components: [], details: { ...emptyDetails, saleRateCardRevision: rateCard.revision, reasons: ["FREE_OFFICIAL_PRICE"] } };
    }
    const hasVideoToken = billableComponents.some((component) => pricingBasis(component, context.capability) === "VIDEO_TOKEN");
    const matching: PricingComponent[] = [];
    let unresolvedCondition = false;
    for (const component of billableComponents) {
        const basis = pricingBasis(component, context.capability);
        if (hasVideoToken && basis === "VIDEO_SECOND") continue;
        const match = componentConditionsMatch(component, context);
        if (match === undefined) unresolvedCondition = true;
        else if (match) matching.push(component);
    }
    const useLargeImageTier = matching.some((component) => pricingBasis(component, context.capability) === "IMAGE_LARGE");
    const applicable = matching.filter((component) => !(pricingBasis(component, context.capability) === "IMAGE_OUTPUT" && useLargeImageTier));
    const configuredBases = [...new Set(billableComponents.map((component) => pricingBasis(component, context.capability)))];
    const missingConfiguredBasis = configuredBases.some(
        (basis) =>
            !(hasVideoToken && basis === "VIDEO_SECOND") &&
            !(basis === "IMAGE_LARGE" && configuredBases.includes("IMAGE_OUTPUT")) &&
            !(basis === "IMAGE_OUTPUT" && useLargeImageTier) &&
            !applicable.some((component) => pricingBasis(component, context.capability) === basis),
    );
    const details: CreativeSaleEstimate["details"] = {
        saleRateCardRevision: rateCard.revision,
        pricingBasis: applicable.map((component) => pricingBasis(component, context.capability)),
        assumptions: [],
        reasons: [],
        ...(context.billingBasis ? { billingBasis: context.billingBasis } : {}),
        ...(context.resolution ? { resolution: context.resolution } : {}),
        ...(context.durationSeconds ? { outputDurationSeconds: context.durationSeconds } : {}),
    };
    if (!applicable.length || unresolvedCondition || missingConfiguredBasis) return { status: "PRICING_DIMENSION_MISSING", components: [], details: { ...details, reasons: ["PRICING_DIMENSION_MISSING"] } };

    const components: CreativeSaleEstimateComponent[] = [];
    let total = decimal(0);
    let conservative = false;
    let seedanceUsage: ReturnType<typeof seedanceQuantity> | undefined;
    for (const component of applicable) {
        const basis = pricingBasis(component, context.capability);
        const quantity = pricingDimensionEstimatorRegistry[basis].estimate(component, context);
        if (basis === "VIDEO_TOKEN") seedanceUsage ||= quantity;
        if ("unsupported" in quantity) return { status: "NOT_ESTIMATABLE", components, details: { ...details, reasons: [...details.reasons, quantity.reason || "UNSUPPORTED_PRICING_BASIS"] } };
        if ("missing" in quantity) return { status: "USAGE_INPUT_MISSING", components, details: { ...details, reasons: [...details.reasons, quantity.reason || "PRICING_DIMENSION_MISSING"] } };
        const chargeableQuantity = chargeablePricingQuantity(component, quantity.quantity).toString();
        const credits = decimal(component.unitPrice)
            .times(decimal(chargeableQuantity))
            .dividedBy(decimal(component.per || "1"));
        components.push({ componentId: component.id, dimension: basis, quantity: chargeableQuantity, unit: component.per || "1", rate: component.unitPrice, credits: credits.toString() });
        total = total.plus(credits);
        conservative ||= quantity.conservative === true;
        if (quantity.assumption) details.assumptions.push(quantity.assumption);
        if (quantity.reason && !details.reasons.includes(quantity.reason)) details.reasons.push(quantity.reason);
        if (basis === "VIDEO_TOKEN") {
            details.estimatedTokens = quantity.quantity;
            details.inputVideoDurationSeconds = seedanceUsage && "inputDurationSeconds" in seedanceUsage ? seedanceUsage.inputDurationSeconds : "0";
        }
    }
    const credits = total.ceilToDecimalPlaces(8).toString();
    return conservative ? { status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: credits, components, details } : { status: "ESTIMATED", credits, components, details };
}

export function pricingBasis(component: PricingComponent, capability: BillableCapability): PricingBasis {
    if (component.basis) return component.basis;
    if (component.dimension === "inputTokens") return "TOKEN_INPUT";
    if (component.dimension === "cachedInputTokens") return "TOKEN_CACHED_INPUT";
    if (component.dimension === "outputTokens") return component.when?.billingBasis ? "VIDEO_TOKEN" : "TOKEN_OUTPUT";
    if (component.dimension === "characters") return capability === "audio" ? "TTS_CHARACTER" : "PER_CHARACTER";
    if (component.dimension === "request") return capability === "image" ? "IMAGE_OUTPUT" : "PER_CALL";
    if (component.dimension === "count") return capability === "image" ? "IMAGE_OUTPUT" : capability === "audio" ? "PER_GENERATION" : "PER_GENERATION";
    if (component.dimension === "durationSeconds") {
        if (component.id.startsWith("video-input-second")) return "VIDEO_INPUT_SECOND";
        if (component.id.startsWith("video-second-stage") || component.id === "stage") return "VIDEO_SECOND_STAGE";
        return capability === "video" ? "VIDEO_SECOND" : "PER_SECOND";
    }
    if (component.dimension === "megapixels") return "IMAGE_OUTPUT";
    return capability === "image" ? "IMAGE_OUTPUT" : "PER_GENERATION";
}

export type ModelEstimatorCoverageStatus = "EXACT" | "CONSERVATIVE" | "MISSING_OFFICIAL_PRICE" | "UNSUPPORTED_PRICING_BASIS" | "USAGE_INPUT_MISSING";
export type ModelEstimatorCoverageCategory = "text" | "image" | "video" | "audio" | "music" | "avatar" | "other";
export type ModelEstimatorCoverageBreakdown = { total: number; exact: number; conservative: number; missingOfficialPrice: number; unsupportedPricingBasis: number; usageInputMissing: number };
export type ModelEstimatorCoverage = {
    totalRoutableModels: number;
    officialPriceConfigured: number;
    exactEstimate: number;
    conservativeEstimate: number;
    missingOfficialSalePrice: number;
    unsupportedPricingBasis: number;
    usageInputMissing: number;
    byCategory: Record<ModelEstimatorCoverageCategory, ModelEstimatorCoverageBreakdown>;
    byPricingBasis: Partial<Record<PricingBasis, ModelEstimatorCoverageBreakdown>>;
    reasonBreakdown: Partial<Record<EstimationReason, number>>;
    models: Array<{ modelId: string; category: ModelEstimatorCoverageCategory; status: ModelEstimatorCoverageStatus; pricingBasis: PricingBasis[]; reasons: EstimationReason[] }>;
};

const emptyCoverageBreakdown = (): ModelEstimatorCoverageBreakdown => ({ total: 0, exact: 0, conservative: 0, missingOfficialPrice: 0, unsupportedPricingBasis: 0, usageInputMissing: 0 });

export function calculateModelEstimatorCoverage(models: LogicalModel[]): ModelEstimatorCoverage {
    const result: ModelEstimatorCoverage = {
        totalRoutableModels: 0,
        officialPriceConfigured: 0,
        exactEstimate: 0,
        conservativeEstimate: 0,
        missingOfficialSalePrice: 0,
        unsupportedPricingBasis: 0,
        usageInputMissing: 0,
        byCategory: { text: emptyCoverageBreakdown(), image: emptyCoverageBreakdown(), video: emptyCoverageBreakdown(), audio: emptyCoverageBreakdown(), music: emptyCoverageBreakdown(), avatar: emptyCoverageBreakdown(), other: emptyCoverageBreakdown() },
        byPricingBasis: {},
        reasonBreakdown: {},
        models: [],
    };
    for (const model of models.filter((candidate) => candidate.enabled && candidate.bindings.some((binding) => binding.enabled))) {
        result.totalRoutableModels += 1;
        let bases: PricingBasis[] = [];
        let status: ModelEstimatorCoverageStatus;
        let reasons: EstimationReason[];
        if (!model.saleRateCard) {
            status = "MISSING_OFFICIAL_PRICE";
            reasons = ["MISSING_OFFICIAL_SALE_PRICE"];
        } else {
            result.officialPriceConfigured += 1;
            try {
                const rateCard = validatePricingRateCard(model.saleRateCard);
                const billable = rateCard.components.filter((component) => !decimal(component.unitPrice).isZero());
                bases = [...new Set(billable.map((component) => pricingBasis(component, model.capability)))];
                if (!billable.length) {
                    status = "EXACT";
                    reasons = ["FREE_OFFICIAL_PRICE"];
                } else if (bases.includes("SERVER_TOOL_CALL")) {
                    status = "USAGE_INPUT_MISSING";
                    reasons = ["SERVER_TOOL_CALL_COUNT_UNKNOWN"];
                } else if (bases.includes("CACHE_CREATION")) {
                    status = "USAGE_INPUT_MISSING";
                    reasons = ["CACHE_CREATION_USAGE_UNKNOWN"];
                } else if (bases.includes("TOKEN_OUTPUT")) {
                    status = "CONSERVATIVE";
                    reasons = ["MAX_OUTPUT_TOKEN_BOUND"];
                } else {
                    status = "EXACT";
                    reasons = exactCoverageReasons(bases);
                }
            } catch {
                status = "UNSUPPORTED_PRICING_BASIS";
                reasons = ["UNSUPPORTED_PRICING_BASIS"];
            }
        }
        const category = coverageCategory(model.capability, bases);
        recordCoverageBreakdown(result.byCategory[category], status);
        for (const basis of bases) {
            const breakdown = (result.byPricingBasis[basis] ||= emptyCoverageBreakdown());
            recordCoverageBreakdown(breakdown, status);
        }
        for (const reason of reasons) result.reasonBreakdown[reason] = (result.reasonBreakdown[reason] || 0) + 1;
        if (status === "EXACT") result.exactEstimate += 1;
        else if (status === "CONSERVATIVE") result.conservativeEstimate += 1;
        else if (status === "MISSING_OFFICIAL_PRICE") result.missingOfficialSalePrice += 1;
        else if (status === "USAGE_INPUT_MISSING") result.usageInputMissing += 1;
        else result.unsupportedPricingBasis += 1;
        result.models.push({ modelId: model.id, category, status, pricingBasis: bases, reasons });
    }
    return result;
}

function recordCoverageBreakdown(breakdown: ModelEstimatorCoverageBreakdown, status: ModelEstimatorCoverageStatus) {
    breakdown.total += 1;
    if (status === "EXACT") breakdown.exact += 1;
    else if (status === "CONSERVATIVE") breakdown.conservative += 1;
    else if (status === "MISSING_OFFICIAL_PRICE") breakdown.missingOfficialPrice += 1;
    else if (status === "USAGE_INPUT_MISSING") breakdown.usageInputMissing += 1;
    else breakdown.unsupportedPricingBasis += 1;
}

function exactCoverageReasons(bases: PricingBasis[]): EstimationReason[] {
    const reasons = new Set<EstimationReason>();
    for (const basis of bases) {
        if (basis === "IMAGE_OUTPUT" || basis === "IMAGE_LARGE") reasons.add("FIXED_IMAGE_COUNT");
        else if (basis === "IMAGE_INPUT") reasons.add("FIXED_INPUT_IMAGE_COUNT");
        else if (basis === "VIDEO_TOKEN") reasons.add("DETERMINISTIC_VIDEO_TOKEN_USAGE");
        else if (basis === "VIDEO_SECOND" || basis === "VIDEO_SECOND_STAGE" || basis === "PER_SECOND") reasons.add("REQUESTED_OUTPUT_DURATION");
        else if (basis === "VIDEO_INPUT_SECOND") reasons.add("VERIFIED_INPUT_VIDEO_DURATION");
        else if (basis === "TTS_CHARACTER" || basis === "PER_CHARACTER") reasons.add("FIXED_CHARACTER_COUNT");
        else if (basis === "MUSIC_GENERATION" || basis === "PER_GENERATION") reasons.add("FIXED_GENERATION_COUNT");
        else if (basis === "TOKEN_INPUT" || basis === "TOKEN_CACHED_INPUT") reasons.add("KNOWN_INPUT_TOKEN_ESTIMATE");
        else reasons.add("FIXED_CALL_COUNT");
    }
    return [...reasons];
}

function coverageCategory(capability: LogicalModel["capability"], bases: PricingBasis[]): ModelEstimatorCoverageCategory {
    if (bases.includes("MUSIC_GENERATION")) return "music";
    if (bases.some((basis) => basis === "AVATAR_CREATE" || basis === "AVATAR_SECOND")) return "avatar";
    return capability;
}

function normalizedContext(input: CreativeSaleRequestContext) {
    const verifiedAssets = input.verifiedAssets || [];
    const hasReferenceVideo = input.hasReferenceVideo ?? verifiedAssets.some((asset) => asset.type === "video");
    const verifiedInputVideoDurationSeconds = decimalText(input.verifiedInputVideoDurationSeconds) || verifiedDuration(verifiedAssets, "video");
    const verifiedInputAudioDurationSeconds = decimalText(input.verifiedInputAudioDurationSeconds) || verifiedDuration(verifiedAssets, "audio");
    return {
        ...input,
        prompt: input.prompt || "",
        count: positiveDecimalText(input.count) || "1",
        durationSeconds: positiveDecimalText(input.durationSeconds),
        maxOutputTokens: positiveDecimalText(input.maxOutputTokens),
        cacheCreationTokens: nonNegativeDecimalText(input.cacheCreationTokens),
        serverToolCallCount: nonNegativeDecimalText(input.serverToolCallCount),
        inputImageCount: nonNegativeDecimalText(input.inputImageCount) || String(verifiedAssets.filter((asset) => asset.type === "image").length),
        verifiedInputVideoDurationSeconds,
        verifiedInputAudioDurationSeconds,
        inputDurationCeilingSeconds: positiveDecimalText(input.inputDurationCeilingSeconds),
        resolution: canonicalResolution(input.resolution),
        billingBasis: hasReferenceVideo ? ("with_video_input" as const) : ("default" as const),
        hasReferenceVideo,
    };
}

function componentConditionsMatch(component: PricingComponent, context: ReturnType<typeof normalizedContext>) {
    for (const [key, expected] of Object.entries(component.when || {})) {
        if (key === "resolution") {
            const actual = [context.resolutionTier, context.resolution].filter((value): value is string => Boolean(value));
            if (!actual.length) return undefined;
            if (!actual.some((value) => canonicalResolution(value) === canonicalResolution(expected))) return false;
            continue;
        }
        const actual = context[key as "quality" | "format" | "billingBasis" | "megapixelTier"];
        if (!actual) return undefined;
        if (actual !== expected) return false;
    }
    if (component.dimension === "quality") return context.quality ? component.match === context.quality : undefined;
    if (component.dimension === "resolution") return context.resolution ? canonicalResolution(component.match) === context.resolution : undefined;
    if (component.dimension === "format") return context.format ? component.match === context.format : undefined;
    return true;
}

function seedanceQuantity(context: NormalizedRequestContext): QuantityResult & { inputDurationSeconds?: string } {
    if (!context.durationSeconds || !context.seedanceFrame || !context.seedanceModelFamily) return { missing: true, reason: "PRICING_DIMENSION_MISSING" };
    if (context.hasReferenceVideo && !context.verifiedInputVideoDurationSeconds) {
        const hold = computeSeedanceHoldUsage({ family: context.seedanceModelFamily, outputDurationSeconds: context.durationSeconds, frame: context.seedanceFrame, hasReferenceVideo: true });
        return {
            quantity: decimal(hold.tokens).times(decimal(context.count)).toString(),
            inputDurationSeconds: hold.holdInputVideoDurationSeconds,
            conservative: true,
            assumption: "reference-video-duration-ceiling",
            reason: "REFERENCE_VIDEO_DURATION_CEILING",
        };
    }
    const estimate = estimateSeedanceUsage({
        outputDurationSeconds: context.durationSeconds,
        verifiedInputVideoDurationSeconds: context.verifiedInputVideoDurationSeconds,
        frame: context.seedanceFrame,
        hasReferenceVideo: context.hasReferenceVideo,
        conservativeFrame: context.seedanceConservativeFrame === true,
    });
    if (estimate.status === "REFERENCE_DURATION_UNKNOWN") return { missing: true, reason: "INPUT_VIDEO_DURATION_UNKNOWN" };
    return {
        quantity: decimal(estimate.tokens).times(decimal(context.count)).toString(),
        inputDurationSeconds: estimate.effectiveInputVideoDurationSeconds,
        reason: context.hasReferenceVideo ? "VERIFIED_REFERENCE_DURATION" : "DETERMINISTIC_VIDEO_TOKEN_USAGE",
        ...(estimate.status === "CONSERVATIVE_ESTIMATE" ? { conservative: true, assumption: "safe-resolution-frame" } : {}),
        ...(estimate.status === "CONSERVATIVE_ESTIMATE" ? { reason: "SAFE_PIXEL_BOUND" as const } : {}),
    };
}

function verifiedDuration(assets: CreativeAsset[], type: "video" | "audio") {
    const matching = assets.filter((asset) => asset.type === type);
    if (!matching.length || matching.some((asset) => !verifiedMediaProbe(asset.metadata) || !Number.isSafeInteger(asset.durationMs) || Number(asset.durationMs) <= 0)) return undefined;
    return matching.reduce((total, asset) => total.plus(decimal(asset.durationMs!).dividedBy(decimal(1000))), decimal(0)).toString();
}

function verifiedMediaProbe(metadata: Record<string, unknown>) {
    const probe = metadata.mediaProbe;
    return Boolean(probe && typeof probe === "object" && !Array.isArray(probe) && (probe as Record<string, unknown>).status === "verified" && (probe as Record<string, unknown>).source === "ffprobe");
}

function imageMegapixels(resolution: string | undefined, count: string) {
    const match = /^(\d+)x(\d+)$/i.exec(resolution || "");
    return match ? decimal(match[1]).times(decimal(match[2])).times(decimal(count)).dividedBy(decimal(1_000_000)).toString() : undefined;
}

function canonicalResolution(value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    const video = /^(480|720|1080)p?$/i.exec(normalized);
    return video ? `${video[1]}p` : normalized;
}

function decimalText(value: string | number | undefined) {
    if (value === undefined || value === "") return undefined;
    try {
        const parsed = decimal(value);
        return parsed.isNegative() ? undefined : parsed.toString();
    } catch {
        return undefined;
    }
}

function positiveDecimalText(value: string | number | undefined) {
    const parsed = decimalText(value);
    return parsed && decimal(parsed).greaterThan(decimal(0)) ? parsed : undefined;
}

function nonNegativeDecimalText(value: string | number | undefined) {
    return decimalText(value);
}
