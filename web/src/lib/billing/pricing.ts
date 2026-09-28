import { decimal, decimalText, hasTerminatingDecimal, type DecimalInput } from "./decimal";

export type UsageSource = "request" | "actual" | "derived" | "reserve";
export type BillableCapability = "text" | "image" | "video" | "audio";
export type PricingOperationScope = "text_generation" | "builtin_image_generation" | "standalone_image_generation" | "image_edit" | "video_generation" | "tts" | "voice_clone" | "music_generation" | "avatar" | "other";
export type PricingDimension =
    "request" | "inputTokens" | "cachedInputTokens" | "cacheCreationTokens" | "outputTokens" | "serverToolCalls" | "inputImageCount" | "count" | "megapixels" | "characters" | "quality" | "resolution" | "durationSeconds" | "format";
export type PricingBasis =
    | "TOKEN_INPUT"
    | "TOKEN_CACHED_INPUT"
    | "TOKEN_OUTPUT"
    | "CACHE_CREATION"
    | "SERVER_TOOL_CALL"
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
    | "PER_SECOND";
export type PricingConditionDimension = "quality" | "resolution" | "format" | "billingBasis" | "contextTier" | "megapixelTier";
export type PricingConditions = Partial<Record<PricingConditionDimension, string>>;
export type PricingJsonValue = string | number | boolean | null | PricingJsonValue[] | { [key: string]: PricingJsonValue };

export type PricingComponent = {
    id: string;
    dimension: PricingDimension;
    basis?: PricingBasis;
    unitPrice: string;
    per?: string;
    match?: string;
    when?: PricingConditions;
    contextThresholdTokens?: string;
    megapixelThreshold?: string;
    freeQuantity?: string;
    operationScope?: PricingOperationScope;
    missingMegapixelTier?: "normal" | "large";
};

export type PricingRateCardV1 = {
    version: 1;
    revision?: string;
    components: PricingComponent[];
};

export type ValidatedPricingRateCardV1 = PricingRateCardV1 & { revision: string };
export type PricingRateCardInputV1 = PricingRateCardV1;

export type NormalizedUsage = {
    capability: BillableCapability;
    operationScope?: PricingOperationScope;
    source: UsageSource;
    request?: string;
    inputTokens?: string;
    cachedInputTokens?: string;
    cacheCreationTokens?: string;
    outputTokens?: string;
    serverToolCalls?: string;
    inputImageCount?: string;
    maxOutputTokens?: string;
    count?: string;
    megapixels?: string;
    characters?: string;
    quality?: string;
    resolution?: string;
    durationSeconds?: string;
    format?: string;
    totalTokens?: string;
    inputVideoDurationSeconds?: string;
    billingBasis?: "default" | "with_video_input";
    contextTier?: "normal" | "long";
    megapixelTier?: "normal" | "large";
    contextInputTokens?: string;
    longContextThresholdTokens?: string;
    hasReferenceVideo?: boolean;
    framesPerSecond?: string;
    providerUsage?: Record<string, PricingJsonValue>;
};

export type BillableUsageInput = {
    capability: BillableCapability;
    operationScope?: PricingOperationScope;
    source: UsageSource;
    request?: DecimalInput;
    inputTokens?: DecimalInput;
    cachedInputTokens?: DecimalInput;
    cacheCreationTokens?: DecimalInput;
    outputTokens?: DecimalInput;
    serverToolCalls?: DecimalInput;
    inputImageCount?: DecimalInput;
    maxOutputTokens?: DecimalInput;
    count?: DecimalInput;
    megapixels?: DecimalInput;
    characters?: DecimalInput;
    quality?: string;
    resolution?: string;
    durationSeconds?: DecimalInput;
    format?: string;
    totalTokens?: DecimalInput;
    inputVideoDurationSeconds?: DecimalInput;
    billingBasis?: "default" | "with_video_input";
    contextTier?: "normal" | "long";
    megapixelTier?: "normal" | "large";
    contextInputTokens?: DecimalInput;
    longContextThresholdTokens?: DecimalInput;
    hasReferenceVideo?: boolean;
    framesPerSecond?: DecimalInput;
    providerUsage?: Record<string, PricingJsonValue>;
};

export type PricingReserve = {
    credits: string;
    rawCredits: string;
    usage: NormalizedUsage;
};

export type FinalSaleCharge = {
    credits: string;
    usage: NormalizedUsage;
    estimated: boolean;
    capped: boolean;
    uncappedCredits: string;
    platformLossCredits: string;
};

export class PricingUsageDimensionError extends Error {
    readonly code = "pricing_usage_dimension_missing";
    readonly requiredDimension: PricingDimension | PricingConditionDimension;
    readonly priceComponentId: string;
    readonly priceCardId: string;

    constructor(input: { message: string; requiredDimension: PricingDimension | PricingConditionDimension; priceComponentId: string; priceCardId: string }) {
        super(input.message);
        this.name = "PricingUsageDimensionError";
        this.requiredDimension = input.requiredDimension;
        this.priceComponentId = input.priceComponentId;
        this.priceCardId = input.priceCardId;
    }
}

const numericDimensions = new Set<PricingDimension>(["request", "inputTokens", "cachedInputTokens", "cacheCreationTokens", "outputTokens", "serverToolCalls", "inputImageCount", "count", "megapixels", "characters", "durationSeconds"]);
const categoricalDimensions = new Set<PricingDimension>(["quality", "resolution", "format"]);
const conditionDimensions: PricingConditionDimension[] = ["quality", "resolution", "format", "billingBasis", "contextTier", "megapixelTier"];
const textPricingDimensions = new Set<PricingDimension>(["request", "inputTokens", "cachedInputTokens", "cacheCreationTokens", "outputTokens", "serverToolCalls", "characters"]);

export function validatePricingRateCard(input: unknown): ValidatedPricingRateCardV1 {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("价格卡必须是对象");
    const value = input as Partial<PricingRateCardInputV1>;
    if (value.version !== 1 || !Array.isArray(value.components) || !value.components.length) throw new Error("价格卡版本或组件无效");
    const ids = new Set<string>();
    const components = value.components.map((component) => normalizeComponent(component, ids));
    return { version: 1, revision: pricingRateCardRevision(components), components };
}

export function validatePricingRateCardForCapability(input: unknown, capability: BillableCapability): ValidatedPricingRateCardV1 {
    const rateCard = validatePricingRateCard(input);
    if (capability !== "text") return rateCard;
    for (const component of rateCard.components) {
        if (!textPricingDimensions.has(component.dimension)) throw new Error(`文本能力价格卡不支持维度：${component.dimension}`);
        const unsupportedCondition = conditionDimensions.find((dimension) => dimension !== "contextTier" && component.when?.[dimension] !== undefined);
        if (unsupportedCondition) throw new Error(`文本能力价格卡不支持条件维度：${unsupportedCondition}`);
    }
    return rateCard;
}

export function normalizePricingRateCard(input: unknown) {
    try {
        return validatePricingRateCard(input);
    } catch {
        return undefined;
    }
}

export function normalizeBillableUsage(input: BillableUsageInput): NormalizedUsage {
    if (!isCapability(input.capability)) throw new Error("计费用量能力无效");
    if (!isUsageSource(input.source)) throw new Error("计费用量来源无效");
    return {
        capability: input.capability,
        operationScope: input.operationScope || defaultOperationScope(input.capability),
        source: input.source,
        ...numericUsage("request", input.request),
        ...numericUsage("inputTokens", input.inputTokens),
        ...numericUsage("cachedInputTokens", input.cachedInputTokens),
        ...numericUsage("cacheCreationTokens", input.cacheCreationTokens),
        ...numericUsage("outputTokens", input.outputTokens),
        ...numericUsage("serverToolCalls", input.serverToolCalls),
        ...numericUsage("inputImageCount", input.inputImageCount),
        ...numericUsage("maxOutputTokens", input.maxOutputTokens),
        ...numericUsage("count", input.count),
        ...numericUsage("megapixels", input.megapixels),
        ...numericUsage("characters", input.characters),
        ...textUsage("quality", input.quality),
        ...textUsage("resolution", input.resolution),
        ...numericUsage("durationSeconds", input.durationSeconds),
        ...textUsage("format", input.format),
        ...numericUsage("totalTokens", input.totalTokens),
        ...numericUsage("inputVideoDurationSeconds", input.inputVideoDurationSeconds),
        ...textUsage("billingBasis", input.billingBasis),
        ...textUsage("contextTier", input.contextTier),
        ...textUsage("megapixelTier", input.megapixelTier),
        ...numericUsage("contextInputTokens", input.contextInputTokens),
        ...numericUsage("longContextThresholdTokens", input.longContextThresholdTokens),
        ...(typeof input.hasReferenceVideo === "boolean" ? { hasReferenceVideo: input.hasReferenceVideo } : {}),
        ...numericUsage("framesPerSecond", input.framesPerSecond),
        ...(input.providerUsage ? { providerUsage: structuredClone(input.providerUsage) } : {}),
    };
}

export function calculatePricingReserve(input: { rateCard: PricingRateCardV1 | PricingRateCardInputV1; usage: NormalizedUsage }): PricingReserve {
    const rateCard = validatePricingRateCard(input.rateCard);
    const request = input.usage;
    const usage = request.capability === "text" ? textReserveUsage(request) : { ...request, source: "reserve" as const };
    const rawCredits = priceUsage(rateCard, usage);
    return { rawCredits: decimalText(rawCredits), credits: rawCredits.ceilToDecimalPlaces(8).toString(), usage };
}

export function calculateNormalizedUsagePrice(input: { rateCard: PricingRateCardV1 | PricingRateCardInputV1; usage: NormalizedUsage }) {
    return decimalText(priceUsage(validatePricingRateCard(input.rateCard), input.usage));
}

export function estimateVideoTokenCount(input: { outputDurationSeconds: DecimalInput; inputDurationSeconds?: DecimalInput; width: DecimalInput; height: DecimalInput; framesPerSecond?: DecimalInput }) {
    const outputDuration = decimal(input.outputDurationSeconds, "输出视频时长");
    const inputDuration = decimal(input.inputDurationSeconds ?? 0, "输入视频时长");
    const width = decimal(input.width, "视频宽度");
    const height = decimal(input.height, "视频高度");
    const framesPerSecond = decimal(input.framesPerSecond ?? 24, "视频帧率");
    if (outputDuration.isNegative() || outputDuration.isZero() || inputDuration.isNegative() || width.isNegative() || width.isZero() || height.isNegative() || height.isZero() || framesPerSecond.isNegative() || framesPerSecond.isZero()) {
        throw new Error("视频 token 估算参数无效");
    }
    return outputDuration.plus(inputDuration).times(width).times(height).times(framesPerSecond).dividedBy(decimal(1024)).ceilToDecimalPlaces(0).toString();
}

export function estimateTextInputTokens(value: string) {
    return String(new TextEncoder().encode(value).length);
}

export function countUnicodeCodePoints(value: string) {
    return String(Array.from(value).length);
}

export function calculateFinalSaleCharge(input: { rateCard: PricingRateCardV1 | PricingRateCardInputV1; reserve: PricingReserve; actualUsage?: NormalizedUsage; derivedUsage?: NormalizedUsage; providerCostUsd?: DecimalInput }): FinalSaleCharge {
    const rateCard = validatePricingRateCard(input.rateCard);
    const usage = input.actualUsage || input.derivedUsage || input.reserve.usage;
    const estimated = !input.actualUsage && !input.derivedUsage;
    const calculated = priceUsage(rateCard, usage);
    const reserve = decimal(input.reserve.credits, "预留积分");
    if (!reserve.hasAtMostDecimalPlaces(8)) throw new Error("预留积分必须保留至 8 位小数");
    const uncapped = calculated.roundHalfUp(8);
    const capped = uncapped.greaterThan(reserve);
    const charge = capped ? reserve : uncapped;
    return {
        credits: charge.toString(),
        uncappedCredits: uncapped.toString(),
        platformLossCredits: (capped ? uncapped.minus(charge) : decimal(0)).toString(),
        usage,
        estimated,
        capped,
    };
}

function normalizeComponent(input: unknown, ids: Set<string>): PricingComponent {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("价格组件无效");
    const value = input as Partial<PricingComponent>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id || ids.has(id)) throw new Error("价格组件 ID 无效或重复");
    if (!isDimension(value.dimension)) throw new Error("价格组件维度无效");
    const unitPrice = nonNegativeDecimal(value.unitPrice, "价格组件单价");
    const per = value.per === undefined ? undefined : positiveDecimal(value.per, "价格组件单位");
    const match = typeof value.match === "string" ? value.match.trim() : undefined;
    const when = normalizeConditions(value.when);
    const contextThresholdTokens = value.contextThresholdTokens === undefined ? undefined : positiveDecimal(value.contextThresholdTokens, "长上下文阈值");
    const megapixelThreshold = value.megapixelThreshold === undefined ? undefined : positiveDecimal(value.megapixelThreshold, "图片像素档位阈值");
    const freeQuantity = value.freeQuantity === undefined ? undefined : nonNegativeDecimal(value.freeQuantity, "价格组件免费数量");
    const operationScope = value.operationScope === undefined ? undefined : normalizeOperationScope(value.operationScope);
    const missingMegapixelTier = value.missingMegapixelTier === "normal" || value.missingMegapixelTier === "large" ? value.missingMegapixelTier : undefined;
    if (when?.contextTier && !contextThresholdTokens) throw new Error("长上下文价格组件缺少 token 阈值");
    if (when?.megapixelTier && !megapixelThreshold) throw new Error("图片像素档位组件缺少 MP 阈值");
    if (categoricalDimensions.has(value.dimension) && !match) throw new Error("分类价格组件必须指定匹配值");
    if (numericDimensions.has(value.dimension) && match) throw new Error("数值价格组件不能指定匹配值");
    if (per && !hasTerminatingDecimal(decimal(1).dividedBy(decimal(per)))) throw new Error("价格组件单位必须可精确表示");
    ids.add(id);
    const basis = value.basis === undefined ? undefined : normalizePricingBasis(value.basis);
    return {
        id,
        dimension: value.dimension,
        ...(basis ? { basis } : {}),
        unitPrice,
        ...(per ? { per } : {}),
        ...(match ? { match } : {}),
        ...(when ? { when } : {}),
        ...(contextThresholdTokens ? { contextThresholdTokens } : {}),
        ...(megapixelThreshold ? { megapixelThreshold } : {}),
        ...(freeQuantity ? { freeQuantity } : {}),
        ...(operationScope ? { operationScope } : {}),
        ...(missingMegapixelTier ? { missingMegapixelTier } : {}),
    };
}

function priceUsage(rateCard: ValidatedPricingRateCardV1, usage: NormalizedUsage) {
    return rateCard.components.reduce((total, component) => total.plus(priceComponent(rateCard, component, usage)), decimal(0));
}

function priceComponent(rateCard: ValidatedPricingRateCardV1, component: PricingComponent, usage: NormalizedUsage) {
    if (component.operationScope && component.operationScope !== (usage.operationScope || defaultOperationScope(usage.capability))) return decimal(0);
    for (const dimension of conditionDimensions) {
        const expected = component.when?.[dimension];
        if (expected === undefined) continue;
        if (usage[dimension] === undefined) throw new PricingUsageDimensionError({ message: `缺少价格条件维度：${dimension}`, requiredDimension: dimension, priceComponentId: component.id, priceCardId: rateCard.revision });
    }
    for (const dimension of conditionDimensions) {
        const expected = component.when?.[dimension];
        if (expected === undefined) continue;
        if (!categoricalValuesEqual(dimension, usage[dimension]!, expected)) return decimal(0);
    }
    const value = usage[component.dimension];
    if (value === undefined) throw new PricingUsageDimensionError({ message: `缺少价格维度：${component.dimension}`, requiredDimension: component.dimension, priceComponentId: component.id, priceCardId: rateCard.revision });
    if (categoricalDimensions.has(component.dimension)) {
        if (!categoricalValuesEqual(component.dimension, value, component.match!)) return decimal(0);
        const count = usage.count === undefined ? decimal(1) : decimal(usage.count, "生成数量");
        return decimal(component.unitPrice, "价格组件单价").times(count);
    }
    return decimal(component.unitPrice, "价格组件单价")
        .times(chargeablePricingQuantity(component, value))
        .dividedBy(decimal(component.per || "1"));
}

export function chargeablePricingQuantity(component: Pick<PricingComponent, "freeQuantity">, quantity: DecimalInput) {
    const raw = decimal(quantity, "价格组件数量");
    const chargeable = raw.minus(decimal(component.freeQuantity || "0", "价格组件免费数量"));
    return chargeable.isNegative() ? decimal(0) : chargeable;
}

function categoricalValuesEqual(dimension: PricingDimension | PricingConditionDimension, actual: string, expected: string) {
    if (dimension !== "resolution") return actual === expected;
    return canonicalResolution(actual) === canonicalResolution(expected);
}

function canonicalResolution(value: string) {
    const match = /^(\d+)p?$/i.exec(value.trim());
    return match ? match[1] : value.trim();
}

function normalizeConditions(input: unknown): PricingConditions | undefined {
    if (input === undefined) return undefined;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("价格组件条件无效");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some((key) => !conditionDimensions.includes(key as PricingConditionDimension))) throw new Error("价格组件条件维度无效");
    const when = conditionDimensions.reduce<PricingConditions>((result, dimension) => {
        const condition = value[dimension];
        if (condition !== undefined) {
            if (typeof condition !== "string" || !condition.trim()) throw new Error("价格组件条件值无效");
            result[dimension] = condition.trim();
        }
        return result;
    }, {});
    if (!Object.keys(when).length) throw new Error("价格组件条件不能为空");
    return when;
}

function textReserveUsage(usage: NormalizedUsage): NormalizedUsage {
    if (usage.inputTokens === undefined) throw new Error("文本预留需要已测量输入 token");
    if (usage.maxOutputTokens === undefined) throw new Error("文本预留需要最大输出 token");
    const { maxOutputTokens: _maxOutputTokens, ...snapshot } = usage;
    return { ...snapshot, capability: "text", source: "reserve", cachedInputTokens: usage.cachedInputTokens || "0", inputTokens: usage.inputTokens, outputTokens: usage.maxOutputTokens };
}

export function pricingRateCardRevision(components: PricingComponent[]) {
    return `rate-card-v1:${JSON.stringify(components)}`;
}

function positiveDecimal(value: unknown, label: string) {
    const normalized = decimal(value as DecimalInput, label);
    if (!normalized.greaterThan(decimal(0))) throw new Error(`${label}必须大于零`);
    return normalized.toString();
}

function nonNegativeDecimal(value: unknown, label: string) {
    const normalized = decimal(value as DecimalInput, label);
    if (normalized.isNegative()) throw new Error(`${label}不能为负数`);
    return normalized.toString();
}

function numericUsage(
    key:
        | "request"
        | "inputTokens"
        | "cachedInputTokens"
        | "cacheCreationTokens"
        | "outputTokens"
        | "serverToolCalls"
        | "inputImageCount"
        | "maxOutputTokens"
        | "count"
        | "megapixels"
        | "characters"
        | "durationSeconds"
        | "totalTokens"
        | "inputVideoDurationSeconds"
        | "framesPerSecond"
        | "contextInputTokens"
        | "longContextThresholdTokens",
    value: DecimalInput | undefined,
) {
    if (value === undefined) return {};
    const normalized = decimal(value, key);
    if (normalized.isNegative()) throw new Error(`${key}不能为负数`);
    return { [key]: normalized.toString() };
}

function textUsage(key: "quality" | "resolution" | "format" | "billingBasis" | "contextTier" | "megapixelTier", value: string | undefined) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized ? { [key]: normalized } : {};
}

function isCapability(value: unknown): value is BillableCapability {
    return value === "text" || value === "image" || value === "video" || value === "audio";
}

function isUsageSource(value: unknown): value is UsageSource {
    return value === "request" || value === "actual" || value === "derived" || value === "reserve";
}

function defaultOperationScope(capability: BillableCapability): PricingOperationScope {
    if (capability === "text") return "text_generation";
    if (capability === "image") return "standalone_image_generation";
    if (capability === "video") return "video_generation";
    return "tts";
}

function normalizeOperationScope(value: unknown): PricingOperationScope {
    if (typeof value !== "string" || !operationScopes.has(value as PricingOperationScope)) throw new Error("价格组件 operation scope 无效");
    return value as PricingOperationScope;
}

const operationScopes = new Set<PricingOperationScope>(["text_generation", "builtin_image_generation", "standalone_image_generation", "image_edit", "video_generation", "tts", "voice_clone", "music_generation", "avatar", "other"]);

function isDimension(value: unknown): value is PricingDimension {
    return (
        value === "request" ||
        value === "inputTokens" ||
        value === "cachedInputTokens" ||
        value === "cacheCreationTokens" ||
        value === "outputTokens" ||
        value === "serverToolCalls" ||
        value === "inputImageCount" ||
        value === "count" ||
        value === "megapixels" ||
        value === "characters" ||
        value === "quality" ||
        value === "resolution" ||
        value === "durationSeconds" ||
        value === "format"
    );
}

function normalizePricingBasis(value: unknown): PricingBasis {
    if (typeof value !== "string" || !pricingBases.has(value as PricingBasis)) throw new Error("价格组件计价基准无效");
    return value as PricingBasis;
}

const pricingBases = new Set<PricingBasis>([
    "TOKEN_INPUT",
    "TOKEN_CACHED_INPUT",
    "TOKEN_OUTPUT",
    "CACHE_CREATION",
    "SERVER_TOOL_CALL",
    "IMAGE_OUTPUT",
    "IMAGE_INPUT",
    "IMAGE_LARGE",
    "VIDEO_SECOND",
    "VIDEO_INPUT_SECOND",
    "VIDEO_TOKEN",
    "VIDEO_SECOND_STAGE",
    "TTS_CHARACTER",
    "VOICE_CLONE_CALL",
    "MUSIC_GENERATION",
    "AVATAR_CREATE",
    "AVATAR_SECOND",
    "TRANSCRIPT_CALL",
    "PER_GENERATION",
    "PER_CALL",
    "PER_CHARACTER",
    "PER_SECOND",
]);
