import type { LogicalModel, LogicalModelBinding, SystemModelChannel } from "@/lib/auth/store-types";
import { decimal } from "@/lib/billing/decimal";
import { validatePricingRateCard, type PricingConditions, type ValidatedPricingRateCardV1 } from "@/lib/billing/pricing";
import { normalizeImageQualityProfile, normalizeMidjourneyQualityFlag, publicLogicalImageQualityProfile, type ImageQualityErrorCode, type ImageQualityIntent, type ImageQualityOption, type ResolvedImageQualityContext } from "@/lib/image-quality-profile";
import type { CreativeSaleRequestContext } from "@/lib/billing/creative-sale-estimator";

export type ResolveImageQualityInput = {
    logicalModel: LogicalModel;
    binding: LogicalModelBinding;
    channel: SystemModelChannel;
    userPrompt: string;
    intent: ImageQualityIntent;
    requestedSize?: string;
    requestedAspectRatio?: string;
    requestCount?: number;
};

export class ImageQualityResolutionError extends Error {
    constructor(
        public readonly code: ImageQualityErrorCode,
        message: string,
        public readonly currentProfileRevision?: string,
        public readonly status = code === "QUALITY_PROFILE_CHANGED" ? 409 : 400,
    ) {
        super(message);
        this.name = "ImageQualityResolutionError";
    }
}

export function imageQualityEstimateRequest(context: ResolvedImageQualityContext): CreativeSaleRequestContext {
    return {
        capability: "image",
        count: context.billableOutputCount,
        ...(context.resolvedSize ? { resolution: context.resolvedSize } : {}),
        ...(context.resolvedResolutionTier ? { resolutionTier: context.resolvedResolutionTier } : {}),
        ...(context.resolvedPixelTier ? { megapixelTier: context.resolvedPixelTier as "normal" | "large" } : {}),
        ...(context.selectedQualityValue ? { quality: context.selectedQualityValue } : {}),
    };
}

export function resolveImageQualityForBinding(input: ResolveImageQualityInput): ResolvedImageQualityContext {
    const profile = normalizeImageQualityProfile(input.binding.imageQualityProfile);
    if (!profile) throw qualityError("QUALITY_CONTEXT_UNRESOLVABLE", "当前 binding 尚未配置可执行画质档案");
    if (!profileExecutable(profile.validation)) throw qualityError("QUALITY_CONTEXT_UNRESOLVABLE", profile.validation.reasons.find((reason) => reason.severity === "blocking")?.message || "当前画质档案需要管理员检查", profile.profileRevision);
    const publicProfile = publicLogicalImageQualityProfile(input.logicalModel.bindings.filter((binding) => binding.enabled));
    if (!publicProfile) throw qualityError("QUALITY_CONTEXT_UNRESOLVABLE", "当前逻辑模型没有可公开使用的画质档案", profile.profileRevision);
    checkRevision(input.intent, publicProfile);
    const rateCard = currentRateCard(input.logicalModel);
    const requestCount = positiveInteger(input.requestCount) || 1;
    const billableOutputCount = providerImagesPerRequest(input.binding) || requestCount;
    const base = {
        version: 1 as const,
        logicalModelId: input.logicalModel.id,
        bindingId: input.binding.id,
        qualityProfileRevision: profile.profileRevision,
        controlType: profile.controlType,
        selectionMode: profile.selectionMode,
        effectivePrompt: input.userPrompt,
        requestCount,
        billableOutputCount,
        pricingConditions: {} as Record<string, string>,
        saleRateCardRevision: rateCard.revision,
    };

    if (profile.selectionMode === "none") {
        if (input.intent.value) throw qualityError("QUALITY_OPTION_UNAVAILABLE", "当前模型没有独立画质选项", publicProfile.profileRevision);
        const dimensions = dimensionsFromSize(input.requestedSize);
        const context = { ...base, ...(dimensions ? { resolvedSize: dimensions.size, resolvedWidth: dimensions.width, resolvedHeight: dimensions.height } : {}) };
        assertPricingContext(rateCard, context.pricingConditions);
        return context;
    }

    if (profile.selectionMode === "derived") return resolveDerivedPixelTier(input, profile.options, rateCard, base);

    const selectedValue = input.intent.value || profile.defaultValue;
    const option = profile.options.find((candidate) => candidate.value === selectedValue);
    if (!option) throw qualityError("QUALITY_OPTION_UNAVAILABLE", "所选画质已不可用，请重新选择", publicProfile.profileRevision);
    const common = { ...base, selectedQualityValue: option.value, optionRevision: option.optionRevision };

    if (option.effect.type === "prompt_flag") {
        const context = {
            ...common,
            resolvedPromptSuffix: option.effect.promptSuffix,
            effectivePrompt: normalizeMidjourneyQualityFlag(input.userPrompt, option.effect.promptSuffix),
            pricingConditions: { quality: option.value },
            ...resolvedOptionalSize(input.requestedSize),
        };
        assertPricingContext(rateCard, context.pricingConditions);
        return context;
    }
    if (option.effect.type === "resolution_tier") {
        const resolvedSize = resolveExactSize(option, input.requestedSize, input.requestedAspectRatio);
        assertBindingSize(input.binding, resolvedSize);
        const dimensions = dimensionsFromSize(resolvedSize)!;
        const context = { ...common, resolvedSize, resolvedWidth: dimensions.width, resolvedHeight: dimensions.height, resolvedResolutionTier: option.effect.resolutionTier, pricingConditions: { resolution: option.effect.resolutionTier } };
        assertPricingContext(rateCard, context.pricingConditions, { resolution: [resolvedSize] });
        return context;
    }
    if (option.effect.type === "request_parameter") {
        const pricingConditions = { quality: option.value };
        const context = { ...common, requestParameters: { [option.effect.requestParameter.name]: option.effect.requestParameter.value }, pricingConditions, ...resolvedOptionalSize(input.requestedSize) };
        assertPricingContext(rateCard, pricingConditions);
        return context;
    }
    if (option.effect.type === "model_variant") {
        const targetBindingId = option.effect.targetBindingId;
        const target = input.logicalModel.bindings.find((binding) => binding.id === targetBindingId && binding.enabled);
        if (!target || target.channelId !== input.channel.id || !input.channel.enabled || !input.channel.models.some((model) => model.toLowerCase() === target.upstreamModel.toLowerCase())) {
            throw qualityError("QUALITY_TARGET_BINDING_INVALID", "所选画质对应的模型 binding 当前不可用", publicProfile.profileRevision);
        }
        const context = { ...common, bindingId: target.id, pricingConditions: { quality: option.value }, ...resolvedOptionalSize(input.requestedSize) };
        assertPricingContext(rateCard, context.pricingConditions);
        return context;
    }
    throw qualityError("QUALITY_CONTEXT_UNRESOLVABLE", "画质 effect 无法执行", publicProfile.profileRevision);
}

function resolveDerivedPixelTier(input: ResolveImageQualityInput, options: ImageQualityOption[], rateCard: ValidatedPricingRateCardV1, base: Omit<ResolvedImageQualityContext, "pricingConditions"> & { pricingConditions: Record<string, string> }) {
    const dimensions = dimensionsFromSize(input.requestedSize);
    if (!dimensions) throw qualityError("QUALITY_CONTEXT_UNRESOLVABLE", "当前画质必须先选择精确像素尺寸", base.qualityProfileRevision);
    assertBindingSize(input.binding, dimensions.size);
    const threshold = uniqueMegapixelThreshold(rateCard);
    if (!threshold) throw qualityError("QUALITY_PRICING_UNAVAILABLE", "正式售价缺少唯一的像素档位阈值", base.qualityProfileRevision);
    const profileThresholds = new Set(options.flatMap((option) => (option.effect.type === "pixel_tier" ? [option.effect.minMegapixels, option.effect.maxMegapixels].filter(Boolean) : [])));
    if (profileThresholds.size && (profileThresholds.size !== 1 || !profileThresholds.has(threshold))) throw qualityError("QUALITY_PRICING_UNAVAILABLE", "画质档案与正式售价像素阈值不一致", base.qualityProfileRevision);
    const megapixels = decimal(dimensions.width).times(decimal(dimensions.height)).dividedBy(decimal(1_000_000));
    const pixelTier = megapixels.greaterThan(decimal(threshold)) ? "large" : "normal";
    if (!options.some((option) => option.effect.type === "pixel_tier" && option.effect.pixelTier === pixelTier)) throw qualityError("QUALITY_PRICING_UNAVAILABLE", `正式售价缺少 ${pixelTier} 像素档位`, base.qualityProfileRevision);
    const pricingConditions = { megapixelTier: pixelTier };
    assertPricingContext(rateCard, pricingConditions);
    return {
        ...base,
        resolvedSize: dimensions.size,
        resolvedWidth: dimensions.width,
        resolvedHeight: dimensions.height,
        resolvedPixelTier: pixelTier,
        pricingConditions,
    } satisfies ResolvedImageQualityContext;
}

function checkRevision(intent: ImageQualityIntent, profile: NonNullable<ReturnType<typeof publicLogicalImageQualityProfile>>) {
    if (!intent.logicalProfileRevision || intent.logicalProfileRevision === profile.profileRevision) return;
    if (profile.selectionMode !== "explicit") throw qualityError("QUALITY_PROFILE_CHANGED", "画质配置已更新，请重新确认后提交", profile.profileRevision, 409);
    const option = profile.options.find((candidate) => candidate.value === intent.value);
    if (!option) throw qualityError("QUALITY_OPTION_UNAVAILABLE", "所选画质已被移除，请重新选择", profile.profileRevision);
    if (!intent.optionRevision || intent.optionRevision !== option.optionRevision) throw qualityError("QUALITY_PROFILE_CHANGED", "所选画质语义已更新，请重新确认后提交", profile.profileRevision, 409);
}

function resolveExactSize(option: ImageQualityOption, requestedSize?: string, requestedAspectRatio?: string) {
    if (option.effect.type !== "resolution_tier") throw qualityError("QUALITY_CONTEXT_UNRESOLVABLE", "画质档案不是分辨率档位");
    const size = normalizedSize(requestedSize);
    if (size) {
        if (!option.effect.exactSizes.includes(size)) throw qualityError("QUALITY_OPTION_UNAVAILABLE", `所选画质不支持精确尺寸 ${size}`);
        return size;
    }
    const ratio = requestedAspectRatio?.trim();
    const mapped = ratio && option.effect.sizeByAspectRatio?.[ratio];
    if (!mapped || !option.effect.exactSizes.includes(mapped)) throw qualityError("QUALITY_OPTION_UNAVAILABLE", `当前比例 ${ratio || "未指定"} 没有上游确认的精确尺寸`);
    return mapped;
}

function currentRateCard(logicalModel: LogicalModel) {
    if (!logicalModel.saleRateCard) throw qualityError("QUALITY_PRICING_UNAVAILABLE", "当前模型尚未配置正式售价");
    try {
        return validatePricingRateCard(logicalModel.saleRateCard);
    } catch {
        throw qualityError("QUALITY_PRICING_UNAVAILABLE", "当前模型正式售价无法用于计价");
    }
}

function assertPricingContext(rateCard: ValidatedPricingRateCardV1, conditions: PricingConditions, alternatives: Partial<Record<keyof PricingConditions, string[]>> = {}) {
    const relevant = rateCard.components.filter((component) => !component.operationScope || component.operationScope === "standalone_image_generation" || component.operationScope === "image_edit");
    const conditioned = relevant.filter((component) => component.when && Object.keys(component.when).length);
    if (!conditioned.length) return;
    if (
        !conditioned.some((component) =>
            Object.entries(component.when || {}).every(([key, value]) => {
                const dimension = key as keyof PricingConditions;
                return [conditions[dimension], ...(alternatives[dimension] || [])].some((candidate) => candidate?.toLowerCase() === value.toLowerCase());
            }),
        )
    )
        throw qualityError("QUALITY_PRICING_UNAVAILABLE", "当前画质无法匹配正式售价维度", rateCard.revision);
}

function uniqueMegapixelThreshold(rateCard: ValidatedPricingRateCardV1) {
    const values = Array.from(new Set(rateCard.components.map((component) => component.megapixelThreshold).filter((value): value is string => Boolean(value))));
    return values.length === 1 ? values[0] : undefined;
}

function assertBindingSize(binding: LogicalModelBinding, size: string) {
    const supported = binding.generationParameters?.pixelSizes || [];
    if (!binding.generationParameters?.supportsCustomSize && supported.length && !supported.includes(size)) throw qualityError("QUALITY_OPTION_UNAVAILABLE", `当前 binding 不支持精确尺寸 ${size}`);
}

function dimensionsFromSize(value?: string) {
    const size = normalizedSize(value);
    if (!size) return undefined;
    const [width, height] = size.split("x").map(Number);
    return width > 0 && height > 0 ? { size, width, height } : undefined;
}

function resolvedOptionalSize(value?: string) {
    const dimensions = dimensionsFromSize(value);
    return dimensions ? { resolvedSize: dimensions.size, resolvedWidth: dimensions.width, resolvedHeight: dimensions.height } : {};
}

function normalizedSize(value?: string) {
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(value?.trim() || "");
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 ? `${width}x${height}` : undefined;
}

function providerImagesPerRequest(binding: LogicalModelBinding) {
    const value = binding.providerPricingProfile?.metadata?.imagesPerRequest ?? binding.upstreamMetadata?.runtime?.imagesPerRequest;
    return positiveInteger(value);
}

function positiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function profileExecutable(validation: { status: string; reasons: Array<{ severity: string }> }) {
    return (validation.status === "VALID" || validation.status === "DRIFT") && !validation.reasons.some((reason) => reason.severity === "blocking");
}

function qualityError(code: ImageQualityErrorCode, message: string, revision?: string, status?: number) {
    return new ImageQualityResolutionError(code, message, revision, status);
}
