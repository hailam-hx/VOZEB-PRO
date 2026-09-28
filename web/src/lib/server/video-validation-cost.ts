import { decimal } from "@/lib/billing/decimal";
import { calculateNormalizedUsagePrice, normalizeBillableUsage, validatePricingRateCard, type PricingRateCardV1 } from "@/lib/billing/pricing";
import type { ProviderPricingProfile } from "@/lib/billing/provider-pricing";
import { computeSeedanceHoldUsage, safeSeedanceFrame, type SeedanceModelFamily } from "@/lib/billing/seedance-usage";
import type { ValidationProviderCost, VideoValidationCandidate, VideoValidationNormalizedContext } from "@/lib/video-validation";

export function estimateVideoValidationProviderCost(input: { rateCard: PricingRateCardV1; context: VideoValidationNormalizedContext }): { ok: true; costHotxCredits: string } | { ok: false; reasonCode: "COST_NOT_ESTIMATABLE" } {
    try {
        const card = validatePricingRateCard(input.rateCard);
        const applicable = card.components.filter((component) => !component.when?.resolution || canonicalResolution(component.when.resolution) === canonicalResolution(input.context.resolution));
        if (!applicable.length) return { ok: false, reasonCode: "COST_NOT_ESTIMATABLE" };
        const usage = normalizeBillableUsage({ capability: "video", source: "reserve", count: input.context.count, durationSeconds: input.context.durationSeconds, resolution: input.context.resolution });
        const costHotxCredits = calculateNormalizedUsagePrice({ rateCard: { version: 1, components: applicable }, usage });
        return { ok: true, costHotxCredits };
    } catch {
        return { ok: false, reasonCode: "COST_NOT_ESTIMATABLE" };
    }
}

export function estimateValidationCost(input: {
    rateCard: PricingRateCardV1;
    context: VideoValidationNormalizedContext;
    providerPricingProfile?: ProviderPricingProfile;
    actualCostCapability?: "AVAILABLE" | "UNAVAILABLE";
    seedanceModelFamily?: SeedanceModelFamily;
    aspectRatios?: string[];
}):
    | {
          ok: true;
          estimatedProviderCost: ValidationProviderCost | null;
          estimatedCredits: string;
          boundEvidence: {
              source: "FIXED_RATE_CARD" | "SEEDANCE_TOKEN_CEILING" | "UPSTREAM_GENERIC_CEILING" | "DFLOP_SPECIAL_PUBLIC_REGISTRY";
              pricingRevision: string;
              durationSeconds: string;
              count: string;
              tokens?: string;
              frame?: { width: string; height: string };
              pricingSource?: string;
          };
          actualCostCapability: "AVAILABLE" | "UNAVAILABLE";
      }
    | { ok: false; reasonCode: "BUDGET_BOUND_UNAVAILABLE" | "COST_NOT_ESTIMATABLE" } {
    try {
        const card = validatePricingRateCard(input.rateCard);
        const billingBasis = input.context.references.some((reference) => reference.fixture === "video") ? "with_video_input" : "default";
        const matching = card.components.filter(
            (component) => (!component.when?.resolution || canonicalResolution(component.when.resolution) === canonicalResolution(input.context.resolution)) && (!component.when?.billingBasis || component.when.billingBasis === billingBasis),
        );
        const applicable = matching.filter(
            (component) =>
                !["VIDEO_SECOND", "VIDEO_TOKEN", "VIDEO_SECOND_STAGE"].includes(component.basis || "") ||
                !matching.some((other) => other !== component && other.basis === component.basis && other.when?.billingBasis === component.when?.billingBasis && other.when?.resolution && !component.when?.resolution),
        );
        if (!applicable.length) return { ok: false, reasonCode: "COST_NOT_ESTIMATABLE" };
        if (applicable.some((component) => component.basis === "VIDEO_TOKEN")) {
            const token = applicable.filter((component) => component.basis === "VIDEO_TOKEN");
            if (!input.seedanceModelFamily || !input.aspectRatios?.length || token.length !== 1 || applicable.some((component) => !["VIDEO_TOKEN", "VIDEO_SECOND"].includes(component.basis || "")))
                return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
            const frame = safeSeedanceFrame(input.context.resolution, input.aspectRatios, input.seedanceModelFamily);
            const dimension = input.providerPricingProfile?.dimensions.find((entry) => entry.id === token[0].id && entry.kind === "VIDEO_TOKEN");
            if (!frame || !dimension || dimension.source !== "upstream" || !dimension.upstreamValue || dimension.effectiveValue !== dimension.upstreamValue || !dimension.unit.startsWith("dflop_credit/"))
                return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
            const hold = computeSeedanceHoldUsage({ family: input.seedanceModelFamily, outputDurationSeconds: input.context.durationSeconds, frame, hasReferenceVideo: billingBasis === "with_video_input" });
            const quantity = decimal(hold.tokens).times(decimal(input.context.count));
            const divisor = decimal(token[0].per || "1");
            const raw = decimal(dimension.upstreamValue).times(quantity).dividedBy(divisor);
            const normalized = decimal(token[0].unitPrice).times(quantity).dividedBy(divisor);
            if (raw.isZero() || raw.isNegative() || !input.providerPricingProfile?.conversion || convertedRawCost(raw, input.providerPricingProfile).greaterThan(normalized)) return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
            return {
                ok: true,
                estimatedProviderCost: { amount: raw.toString(), currency: "DFLOP_CREDITS", unit: "task" },
                estimatedCredits: normalized.ceilToDecimalPlaces(8).toString(),
                boundEvidence: { source: "SEEDANCE_TOKEN_CEILING", pricingRevision: card.revision, durationSeconds: input.context.durationSeconds, count: input.context.count, tokens: quantity.toString(), frame },
                actualCostCapability: input.actualCostCapability || "UNAVAILABLE",
            };
        }
        if (input.providerPricingProfile?.dimensions.some((dimension) => ["VIDEO_TOKEN", "VIDEO_INPUT_SECOND", "VIDEO_SECOND_STAGE"].includes(dimension.kind))) return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
        if (
            applicable.some(
                (component) =>
                    !["VIDEO_SECOND", "PER_SECOND", "PER_GENERATION", "PER_CALL"].includes(component.basis || "") ||
                    !["durationSeconds", "request", "count"].includes(component.dimension) ||
                    Object.keys(component.when || {}).some((key) => key !== "resolution"),
            )
        )
            return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
        const usage = normalizeBillableUsage({ capability: "video", source: "reserve", request: 1, count: input.context.count, durationSeconds: input.context.durationSeconds, resolution: input.context.resolution });
        const amount = decimal(calculateNormalizedUsagePrice({ rateCard: { version: 1, components: applicable }, usage }));
        if (amount.isNegative()) return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
        let providerCost = rawDflopCost(input.providerPricingProfile, applicable, input.context);
        let boundedCredits = amount;
        let source: "FIXED_RATE_CARD" | "UPSTREAM_GENERIC_CEILING" = "FIXED_RATE_CARD";
        if (input.providerPricingProfile?.provider === "dflop" && !providerCost) {
            const fallback = upstreamGenericCeiling(input.providerPricingProfile, applicable, input.context);
            if (!fallback) return { ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" };
            providerCost = fallback.providerCost;
            boundedCredits = fallback.credits;
            source = "UPSTREAM_GENERIC_CEILING";
        }
        return {
            ok: true,
            estimatedProviderCost: providerCost,
            estimatedCredits: boundedCredits.ceilToDecimalPlaces(8).toString(),
            boundEvidence: { source, pricingRevision: card.revision, durationSeconds: input.context.durationSeconds, count: input.context.count },
            actualCostCapability: input.actualCostCapability || "UNAVAILABLE",
        };
    } catch {
        return { ok: false, reasonCode: "COST_NOT_ESTIMATABLE" };
    }
}

function convertedRawCost(raw: ReturnType<typeof decimal>, profile: ProviderPricingProfile) {
    const conversion = profile.conversion!;
    return raw.dividedBy(decimal(conversion.dflopCreditsPerCny)).times(decimal(conversion.cnyToUsd)).dividedBy(decimal(conversion.hotxUsdPerCredit));
}

function upstreamGenericCeiling(profile: ProviderPricingProfile, components: PricingRateCardV1["components"], context: VideoValidationNormalizedContext) {
    if (components.length !== 1 || components[0].basis !== "VIDEO_SECOND" || !profile.conversion) return null;
    const generic = profile.dimensions.find((entry) => entry.id === "video-second" && entry.kind === "VIDEO_SECOND" && entry.source === "upstream" && entry.upstreamValue === entry.effectiveValue);
    const tiers = profile.raw.video_price_tiers;
    if (!generic?.upstreamValue || profile.raw.price_per_video_second !== generic.upstreamValue || !tiers || typeof tiers !== "object" || Array.isArray(tiers)) return null;
    const maximum = decimal(generic.upstreamValue);
    if (Object.values(tiers).some((value) => typeof value !== "string" || decimal(value).greaterThan(maximum))) return null;
    const raw = maximum.times(decimal(context.durationSeconds)).times(decimal(context.count));
    const credits = convertedRawCost(raw, profile);
    if (decimal(components[0].unitPrice).times(decimal(context.durationSeconds)).times(decimal(context.count)).greaterThan(credits)) return null;
    return { providerCost: { amount: raw.toString(), currency: "DFLOP_CREDITS", unit: "task" }, credits };
}

function rawDflopCost(profile: ProviderPricingProfile | undefined, components: PricingRateCardV1["components"], context: VideoValidationNormalizedContext): ValidationProviderCost | null {
    if (!profile || profile.provider !== "dflop" || (profile.discount && decimal(profile.discount).toString() !== "1")) return null;
    let total = decimal(0);
    for (const component of components) {
        const dimension = profile.dimensions.find((entry) => entry.id === component.id && entry.kind === component.basis);
        if (!dimension || dimension.source !== "upstream" || dimension.upstreamValue === undefined || dimension.effectiveValue !== dimension.upstreamValue || !dimension.unit.startsWith("dflop_credit/")) return null;
        if (dimension.providerCostHotxCredits && decimal(dimension.providerCostHotxCredits).greaterThan(decimal(component.unitPrice))) return null;
        const quantity = component.basis === "PER_CALL" ? decimal(1) : component.basis === "PER_GENERATION" ? decimal(context.count) : decimal(context.durationSeconds).times(decimal(context.count));
        total = total.plus(
            decimal(dimension.upstreamValue)
                .times(quantity)
                .dividedBy(decimal(component.per || "1")),
        );
    }
    return { amount: total.toString(), currency: "DFLOP_CREDITS", unit: "task" };
}

export function selectLowestCostCanaries<T extends VideoValidationCandidate>(items: T[]): T[] {
    const selected = new Map<string, T>();
    for (const item of items) {
        const key = item.contractFingerprintHash ? `${item.contractFingerprintVersion}:${item.contractFingerprintHash}` : item.fingerprintHash ? `${item.fingerprintVersion}:${item.fingerprintHash}:${item.caseId}` : `${item.family}:${item.caseId}`;
        const current = selected.get(key);
        if (!current || less(item, current)) selected.set(key, item);
    }
    return [...selected.values()];
}

function less(left: VideoValidationCandidate, right: VideoValidationCandidate) {
    const leftCost = decimal(left.estimatedCost);
    const rightCost = decimal(right.estimatedCost);
    return rightCost.greaterThan(leftCost) || (!leftCost.greaterThan(rightCost) && !rightCost.greaterThan(leftCost) && ((left.priority ?? 0) - (right.priority ?? 0) || left.bindingId.localeCompare(right.bindingId)) < 0);
}

function canonicalResolution(value: string) {
    const match = /^(\d+)p?$/i.exec(value.trim());
    return match ? match[1] : value.trim().toLowerCase();
}
