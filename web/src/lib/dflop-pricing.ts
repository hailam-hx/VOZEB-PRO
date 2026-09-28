import type { ProviderPricingDimension, ProviderPricingDimensionKind, ProviderPricingProfile, ProviderPricingWarning } from "@/lib/billing/provider-pricing";
import { canonicalProviderPricingDimensionId } from "@/lib/billing/provider-pricing";
import { decimal } from "@/lib/billing/decimal";
import type { PricingOperationScope } from "@/lib/billing/pricing";

type PricingContext = {
    modelId: string;
    category?: string;
    endpointType?: string | null;
    syncedAt: string;
};

type ScalarDefinition = {
    kind: ProviderPricingDimensionKind;
    unit: string;
    conditions?: Record<string, string>;
};

const DFLOP_PRICING_CONTRACT_PRESETS: Readonly<
    Record<string, { imageLargeTierContract?: "megapixel_threshold" | "named_size_mapping"; profileMetadata?: Record<string, unknown>; warnings?: ProviderPricingWarning[]; dimensions?: Record<string, Record<string, unknown>> }>
> = {
    "doubao-seedream-5-0-pro-260628": {
        imageLargeTierContract: "megapixel_threshold",
        profileMetadata: {
            imageLargeThresholdMegapixels: "2.61",
            holdTierWhenSizeMissing: "large",
            defaultRequestSize: { width: 2048, height: 2048 },
            settlementTierSource: "actual_output_size",
            operationScope: "standalone_image_generation",
            contractSource: "official_endpoint_contract",
            contractUrl: "https://model.dflop.top/en/docs/reference/media-apis#post-v1-images-generations",
            verifiedAt: "2026-09-24",
        },
        warnings: [{ code: "DOC_CONTRACT_DIVERGENCE", message: "当前 Media API 以 2.61 MP 为 Seedream 5 Pro 档位阈值；旧 Image Editing Guide 的 2.36 MP 仅保留为文档差异，不进入计算。" }],
        dimensions: {
            price_per_input_image: {
                freeQuantity: "1",
                source: "official_endpoint_contract",
                verifiedAt: "2026-09-24",
                contractUrl: "https://model.dflop.top/en/docs/reference/media-apis#post-v1-images-generations",
            },
        },
    },
    "qwen-image-3.0-pro": { imageLargeTierContract: "named_size_mapping", dimensions: { price_per_input_image: { freeQuantity: "0" } } },
};

const SCALAR_FIELDS: Readonly<Record<string, ScalarDefinition>> = {
    input_per_1m: { kind: "TOKEN_INPUT", unit: "dflop_credit/1m_tokens" },
    cached_input_per_1m: { kind: "TOKEN_CACHED_INPUT", unit: "dflop_credit/1m_tokens" },
    output_per_1m: { kind: "TOKEN_OUTPUT", unit: "dflop_credit/1m_tokens" },
    cache_creation_per_1m: { kind: "CACHE_CREATION", unit: "dflop_credit/1m_tokens" },
    input_per_1m_long: { kind: "TOKEN_INPUT", unit: "dflop_credit/1m_tokens", conditions: { context: "long" } },
    cached_input_per_1m_long: { kind: "TOKEN_CACHED_INPUT", unit: "dflop_credit/1m_tokens", conditions: { context: "long" } },
    output_per_1m_long: { kind: "TOKEN_OUTPUT", unit: "dflop_credit/1m_tokens", conditions: { context: "long" } },
    price_per_server_tool_call: { kind: "SERVER_TOOL_CALL", unit: "dflop_credit/call" },
    price_per_image: { kind: "IMAGE_OUTPUT", unit: "dflop_credit/image" },
    price_per_input_image: { kind: "IMAGE_INPUT", unit: "dflop_credit/image" },
    price_per_image_large: { kind: "IMAGE_LARGE", unit: "dflop_credit/image" },
    price_per_video_second: { kind: "VIDEO_SECOND", unit: "dflop_credit/second" },
    price_per_video_task: { kind: "PER_CALL", unit: "dflop_credit/task" },
    price_per_input_video_second: { kind: "VIDEO_INPUT_SECOND", unit: "dflop_credit/second" },
    price_per_tts_char: { kind: "TTS_CHARACTER", unit: "dflop_credit/character" },
    price_per_voice_clone: { kind: "VOICE_CLONE_CALL", unit: "dflop_credit/call" },
    price_per_music_generation: { kind: "MUSIC_GENERATION", unit: "dflop_credit/generation" },
    price_per_avatar: { kind: "AVATAR_CREATE", unit: "dflop_credit/avatar" },
};

const TIER_FIELDS: Readonly<Record<string, { kind: ProviderPricingDimensionKind; unit: string; conditions: (value: string) => Record<string, string> }>> = {
    video_price_tiers: { kind: "VIDEO_SECOND", unit: "dflop_credit/second", conditions: (resolution) => ({ resolution }) },
    video_token_price_per_1m: { kind: "VIDEO_TOKEN", unit: "dflop_credit/1m_tokens", conditions: videoTokenConditions },
    video_second_stage_per_second: { kind: "VIDEO_SECOND_STAGE", unit: "dflop_credit/second", conditions: (resolution) => ({ resolution }) },
};

const METADATA_FIELDS = new Set(["discount", "images_per_request", "long_context_threshold_tokens", "image_large_threshold_megapixels"]);
const CAPABILITY_CONTRACT_FIELDS = new Set(["callable", "endpoint_type", "supported_protocols", "supports_image_gen"]);
const PRICING_SHAPE = /(?:^price_|_per_(?:1m|call|request|image|second|char|avatar|generation)$|_price_(?:tiers|per_1m)$)/i;

export function parseDflopPricing(metadata: Record<string, unknown>, context: PricingContext): ProviderPricingProfile {
    const dimensions: ProviderPricingDimension[] = [];
    const warnings: ProviderPricingWarning[] = [];
    const unknownFields: string[] = [];
    const raw: Record<string, unknown> = {};
    const profileMetadata: Record<string, unknown> = {};
    if (context.category) profileMetadata.category = context.category;
    if (context.endpointType !== undefined) profileMetadata.endpointType = context.endpointType;
    const preset = DFLOP_PRICING_CONTRACT_PRESETS[canonicalModelId(context.modelId)];
    if (preset?.imageLargeTierContract) profileMetadata.imageLargeTierContract = preset.imageLargeTierContract;
    if (preset?.profileMetadata) Object.assign(profileMetadata, structuredClone(preset.profileMetadata));
    if (preset?.warnings) warnings.push(...structuredClone(preset.warnings));

    for (const [field, value] of Object.entries(metadata)) {
        if (CAPABILITY_CONTRACT_FIELDS.has(field)) raw[field] = cloneJsonValue(value);
        const scalar = SCALAR_FIELDS[field] || contextualScalar(field, context);
        const tier = TIER_FIELDS[field];
        const isPricingField = Boolean(scalar || tier || METADATA_FIELDS.has(field) || PRICING_SHAPE.test(field));
        if (!isPricingField) continue;
        raw[field] = cloneJsonValue(value);

        if (field === "discount") continue;
        if (field === "images_per_request") {
            if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) profileMetadata.imagesPerRequest = value;
            else warnings.push(invalidWarning(field));
            continue;
        }
        if (field === "long_context_threshold_tokens") {
            if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) profileMetadata.longContextThresholdTokens = value;
            else warnings.push(invalidWarning(field));
            continue;
        }
        if (field === "image_large_threshold_megapixels") {
            const amount = decimalText(value);
            if (amount !== undefined && decimal(amount).greaterThan(decimal(0))) profileMetadata.imageLargeThresholdMegapixels = amount;
            else warnings.push(invalidWarning(field));
            continue;
        }
        if (scalar) {
            const amount = decimalText(value);
            if (amount === undefined) warnings.push(invalidWarning(field));
            else if (field === "price_per_image" && isAuditedGpt5BuiltinImageContract(context)) {
                profileMetadata.unscopedProviderPrices = { ...(isRecord(profileMetadata.unscopedProviderPrices) ? profileMetadata.unscopedProviderPrices : {}), [field]: amount };
                profileMetadata.builtinImageGenerationContract = {
                    operationScope: "builtin_image_generation",
                    billingBasis: "token",
                    source: "official_endpoint_contract",
                    contractUrl: "https://model.dflop.top/en/docs/guides/image-editing#route-3-gpt-5x-chat-with-the-image_generation-tool",
                    verifiedAt: "2026-09-24",
                };
            } else dimensions.push(createDimension(field, scalar.kind, scalar.unit, amount, context.syncedAt, scalar.conditions, preset?.dimensions?.[field], field === "price_per_video_task" ? "video_generation" : undefined));
            continue;
        }
        if (tier) {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                warnings.push(invalidWarning(field));
                continue;
            }
            for (const [conditionValue, tierValue] of Object.entries(value)) {
                if (!conditionValue.trim()) {
                    warnings.push(invalidWarning(field));
                    continue;
                }
                const amount = decimalText(tierValue);
                if (amount === undefined) warnings.push(invalidWarning(`${field}.${conditionValue}`));
                else dimensions.push(createDimension(field, tier.kind, tier.unit, amount, context.syncedAt, tier.conditions(conditionValue)));
            }
            continue;
        }
        unknownFields.push(field);
        warnings.push({ code: "UNKNOWN_FIELD", field, message: `DFLOP 返回了未识别的价格字段 ${field}` });
    }

    const discount = decimalText(metadata.discount);
    if (metadata.discount !== undefined && discount === undefined) warnings.push(invalidWarning("discount"));
    if (!dimensions.length) warnings.push({ code: "MISSING_BASIS", message: "DFLOP 模型没有可识别的结构化计价依据" });
    if (canonicalModelId(context.modelId) === "grok-4.7" && hasCompleteLongContextContract(metadata)) {
        warnings.push({ code: "DOC_REGISTRY_CONTRACT_DIVERGENCE", message: "DFLOP Models 文档未列出 Grok 4.7 长上下文档位，但 live registry 提供了完整机器可读 contract；执行以 registry 为准。" });
    }
    const hasInvalidValue = warnings.some((warning) => warning.code === "INVALID_VALUE");
    const status = !dimensions.length ? "NEEDS_REVIEW" : unknownFields.length || hasInvalidValue ? "PARTIAL" : "READY";
    return {
        provider: "dflop",
        modelId: context.modelId,
        status,
        syncedAt: context.syncedAt,
        raw,
        ...(discount !== undefined ? { discount } : {}),
        dimensions,
        unknownFields,
        missingFields: [],
        warnings,
        ...(Object.keys(profileMetadata).length ? { metadata: profileMetadata } : {}),
    };
}

function contextualScalar(field: string, context: PricingContext): ScalarDefinition | undefined {
    const semantic = `${context.category || ""} ${context.endpointType || ""}`.toLowerCase();
    if (field === "price_per_generation") {
        if (semantic.includes("music")) return { kind: "MUSIC_GENERATION", unit: "dflop_credit/generation" };
        if (semantic.includes("avatar") || semantic.includes("digital human")) return { kind: "AVATAR_CREATE", unit: "dflop_credit/generation" };
        return { kind: "PER_GENERATION", unit: "dflop_credit/generation" };
    }
    if (field === "price_per_call") {
        if (semantic.includes("voice") && semantic.includes("clone")) return { kind: "VOICE_CLONE_CALL", unit: "dflop_credit/call" };
        if (semantic.includes("transcript") || semantic.includes("subtitle") || semantic.includes("speech-to-text")) return { kind: "TRANSCRIPT_CALL", unit: "dflop_credit/call" };
        return { kind: "PER_CALL", unit: "dflop_credit/call" };
    }
    if (field === "price_per_second") {
        if (semantic.includes("avatar") || semantic.includes("digital human") || semantic.includes("lipsync")) return { kind: "AVATAR_SECOND", unit: "dflop_credit/second" };
        if (semantic.includes("video")) return { kind: "VIDEO_SECOND", unit: "dflop_credit/second" };
        return { kind: "PER_SECOND", unit: "dflop_credit/second" };
    }
    return undefined;
}

function createDimension(
    field: string,
    kind: ProviderPricingDimensionKind,
    unit: string,
    amount: string,
    syncedAt: string,
    conditions?: Record<string, string>,
    metadata?: Record<string, unknown>,
    operationScope?: PricingOperationScope,
): ProviderPricingDimension {
    const normalizedConditions = conditions ? Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key.trim(), value.trim().toLowerCase()])) : undefined;
    const id = canonicalProviderPricingDimensionId({ kind, conditions: normalizedConditions });
    return {
        id,
        kind,
        key: field,
        unit,
        source: "upstream",
        upstreamValue: amount,
        effectiveValue: amount,
        syncedAt,
        operationScope: operationScope || operationScopeForKind(kind),
        ...(normalizedConditions ? { conditions: normalizedConditions } : {}),
        ...(metadata ? { metadata: structuredClone(metadata) } : {}),
    };
}

function operationScopeForKind(kind: ProviderPricingDimensionKind): PricingOperationScope {
    if (kind.startsWith("TOKEN_") || kind === "CACHE_CREATION" || kind === "SERVER_TOOL_CALL") return "text_generation";
    if (kind.startsWith("IMAGE_")) return "standalone_image_generation";
    if (kind.startsWith("VIDEO_")) return "video_generation";
    if (kind === "TTS_CHARACTER" || kind === "PER_CHARACTER") return "tts";
    if (kind === "VOICE_CLONE_CALL") return "voice_clone";
    if (kind === "MUSIC_GENERATION") return "music_generation";
    if (kind.startsWith("AVATAR_")) return "avatar";
    return "other";
}

function isAuditedGpt5BuiltinImageContract(context: PricingContext) {
    return context.category?.toLowerCase() === "text" && /^gpt-5\.(?:5|6(?:-[a-z0-9.-]+)?)$/i.test(canonicalModelId(context.modelId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalModelId(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}

function hasCompleteLongContextContract(metadata: Record<string, unknown>) {
    return ["long_context_threshold_tokens", "input_per_1m_long", "cached_input_per_1m_long", "output_per_1m_long"].every((field) => metadata[field] !== undefined);
}

function videoTokenConditions(value: string): Record<string, string> {
    const [billingBasis, resolution, ...rest] = value.split("@").map((part) => part.trim());
    if (billingBasis && resolution && !rest.length) return { billingBasis, resolution };
    if (billingBasis === "default" || billingBasis === "with_video_input") return { billingBasis };
    return { tier: value };
}

function decimalText(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    if (typeof value === "number" && !Number.isFinite(value)) return undefined;
    try {
        const parsed = decimal(value, "DFLOP 价格");
        return parsed.isNegative() ? undefined : parsed.toString();
    } catch {
        return undefined;
    }
}

function invalidWarning(field: string): ProviderPricingWarning {
    return { code: "INVALID_VALUE", field, message: `DFLOP 价格字段 ${field} 不是有效的非负有限小数` };
}

function cloneJsonValue<T>(value: T): T {
    if (value === undefined) return value;
    return structuredClone(value);
}
