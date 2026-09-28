import { estimateCreativeSaleCredits, type CreativeSaleEstimate, type CreativeSaleEstimateComponent, type CreativeSaleEstimateStatus } from "@/lib/billing/creative-sale-estimator";
import { decimal } from "@/lib/billing/decimal";
import { resolveSeedanceModelFamily, safeSeedanceFrame, seedanceFrameDimensions } from "@/lib/billing/seedance-usage";
import type { CreativeAsset, CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";

import type { CreativeModelOption } from "./creative-generation-controls";

type EstimateConfig = Pick<AiConfig, "apiSource" | "size" | "quality" | "videoSeconds" | "vquality" | "audioFormat" | "logicalModels">;

export type CreativeCreditEstimate =
    | { status: "PLANNING" }
    | { status: "ESTIMATED"; credits: string; components?: CreativeSaleEstimateComponent[]; details?: CreativeSaleEstimate["details"] }
    | { status: "CONSERVATIVE_ESTIMATE"; upperBoundCredits: string; components?: CreativeSaleEstimateComponent[]; details?: CreativeSaleEstimate["details"] }
    | { status: Exclude<CreativeSaleEstimateStatus, "ESTIMATED" | "CONSERVATIVE_ESTIMATE">; components?: CreativeSaleEstimateComponent[]; details?: CreativeSaleEstimate["details"] };

export function estimateCreativeCredits({
    config,
    prompt,
    smartPlanning,
    selectedModels,
    preferences,
    referenceAssets = [],
    referenceVideos,
}: {
    config: EstimateConfig;
    prompt: string;
    smartPlanning: boolean;
    selectedModels: CreativeModelOption[];
    preferences: CreativeGenerationPreferences;
    referenceAssets?: CreativeAsset[];
    /** @deprecated Use referenceAssets. */
    referenceVideos?: CreativeAsset[];
}): CreativeCreditEstimate {
    if (smartPlanning || !selectedModels.length) return { status: "PLANNING" };
    const assets = referenceAssets.length ? referenceAssets : referenceVideos || [];
    const estimates: CreativeSaleEstimate[] = [];
    for (const model of selectedModels) {
        const logicalModel = config.logicalModels.find((candidate) => candidate.id === model.id || candidate.bindings.some((binding) => binding.upstreamModel === model.id));
        if (!logicalModel) return emptyEstimate("OFFICIAL_SALE_PRICE_MISSING");
        const imageQuality = model.capability === "image" ? imageQualityPreview(logicalModel.imageQualityProfile || model.imageQualityProfile, preferences.image, config.size) : undefined;
        const count = model.capability === "image" ? imageQuality?.billableOutputCount || positiveInteger(preferences.image?.count) : model.capability === "video" ? positiveInteger(preferences.video?.count) : 1;
        const resolution = model.capability === "image" ? imageQuality?.resolvedSize || preferences.image?.size || config.size : model.capability === "video" ? preferences.video?.quality || config.vquality : undefined;
        const family = resolveSeedanceFamily(
            logicalModel.id,
            model.id,
            logicalModel.bindings.map((binding) => binding.upstreamModel),
        );
        const aspectRatio = model.capability === "video" ? preferences.video?.size || config.size : undefined;
        const explicitFrame = family ? seedanceFrameDimensions(resolution, aspectRatio, family) : undefined;
        const safeFrame = family ? explicitFrame || safeSeedanceFrame(resolution, model.generationParameters?.aspectRatios || [], family) : undefined;
        const estimate = estimateCreativeSaleCredits({
            logicalModel,
            requestContext: {
                capability: model.capability,
                prompt,
                count,
                resolution,
                resolutionTier: imageQuality?.resolutionTier,
                megapixelTier: imageQuality?.megapixelTier,
                quality: model.capability === "image" ? imageQuality?.quality || preferences.image?.quality || config.quality : model.capability === "video" ? resolution : undefined,
                format: model.capability === "audio" ? preferences.audio?.format || config.audioFormat : undefined,
                durationSeconds: model.capability === "video" ? preferences.video?.seconds || config.videoSeconds : undefined,
                maxOutputTokens: maximumOutputTokens(logicalModel.bindings.map((binding) => binding.maxOutputTokens)),
                hasReferenceVideo: assets.some((asset) => asset.type === "video"),
                verifiedAssets: assets,
                seedanceModelFamily: family,
                seedanceFrame: safeFrame,
                seedanceConservativeFrame: Boolean(family && !explicitFrame),
            },
        });
        if (estimate.status === "ESTIMATED" && !estimate.credits) return emptyEstimate("NOT_ESTIMATABLE");
        if (estimate.status === "CONSERVATIVE_ESTIMATE" && !estimate.upperBoundCredits) return emptyEstimate("NOT_ESTIMATABLE");
        if (estimate.status !== "ESTIMATED" && estimate.status !== "CONSERVATIVE_ESTIMATE") {
            return { status: estimate.status, components: estimate.components, details: estimate.details };
        }
        estimates.push(estimate);
    }
    const conservative = estimates.some((estimate) => estimate.status === "CONSERVATIVE_ESTIMATE");
    const total = estimates.reduce((sum, estimate) => sum.plus(decimal(estimate.status === "CONSERVATIVE_ESTIMATE" ? estimate.upperBoundCredits! : estimate.credits!)), decimal(0)).toString();
    const components = estimates.flatMap((estimate) => estimate.components);
    const details =
        estimates.length === 1
            ? estimates[0].details
            : {
                  pricingBasis: components.map((component) => component.dimension),
                  assumptions: [...new Set(estimates.flatMap((estimate) => estimate.details.assumptions))],
                  reasons: [...new Set(estimates.flatMap((estimate) => estimate.details.reasons))],
              };
    return conservative ? { status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: total, components, details } : { status: "ESTIMATED", credits: total, components, details };
}

function imageQualityPreview(profile: CreativeModelOption["imageQualityProfile"], preference: CreativeGenerationPreferences["image"], configuredSize: string) {
    if (!profile) return undefined;
    const value = preference?.quality || profile.defaultValue;
    const option = profile.options.find((candidate) => candidate.value === value);
    const requestedSize = preference?.size || configuredSize;
    if (!option) return { billableOutputCount: profile.billableOutputCount, quality: value };
    if (option.effect.type === "resolution_tier") {
        const resolvedSize = /^\d+x\d+$/i.test(requestedSize) ? requestedSize : option.effect.sizeByAspectRatio?.[requestedSize];
        if (!resolvedSize || !option.effect.exactSizes.includes(resolvedSize)) return { billableOutputCount: profile.billableOutputCount, quality: value };
        return { billableOutputCount: profile.billableOutputCount, quality: value, resolvedSize, resolutionTier: option.effect.resolutionTier };
    }
    if (profile.controlType === "pixel_tier" && /^\d+x\d+$/i.test(requestedSize)) {
        const [width, height] = requestedSize.split("x");
        const megapixels = decimal(width).times(decimal(height)).dividedBy(decimal(1_000_000));
        const normal = profile.options.find((candidate) => candidate.effect.type === "pixel_tier" && candidate.effect.pixelTier === "normal");
        const threshold = normal?.effect.type === "pixel_tier" ? normal.effect.maxMegapixels : undefined;
        return { billableOutputCount: profile.billableOutputCount, quality: value, resolvedSize: requestedSize, megapixelTier: threshold && megapixels.greaterThan(decimal(threshold)) ? ("large" as const) : ("normal" as const) };
    }
    return { billableOutputCount: profile.billableOutputCount, quality: value, ...(/^\d+x\d+$/i.test(requestedSize) ? { resolvedSize: requestedSize } : {}) };
}

function emptyEstimate(status: Exclude<CreativeSaleEstimateStatus, "ESTIMATED" | "CONSERVATIVE_ESTIMATE">): CreativeCreditEstimate {
    return { status, components: [], details: { pricingBasis: [], assumptions: [], reasons: [] } };
}

function resolveSeedanceFamily(...values: Array<string | string[]>) {
    for (const value of values.flat()) {
        const family = resolveSeedanceModelFamily(value);
        if (family) return family;
    }
    return undefined;
}

function maximumOutputTokens(values: Array<number | undefined>) {
    const configured = values.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0);
    return configured.length ? Math.max(...configured) : undefined;
}

function positiveInteger(value: number | undefined) {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 1;
}
