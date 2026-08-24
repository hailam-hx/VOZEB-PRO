import { decimal, decimalText, hasTerminatingDecimal, type DecimalInput } from "./decimal";

export type UsageSource = "request" | "actual" | "derived" | "reserve";
export type BillableCapability = "text" | "image" | "video" | "audio";
export type PricingDimension = "request" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "count" | "megapixels" | "characters" | "quality" | "resolution" | "durationSeconds" | "format";

export type PricingComponent = {
    id: string;
    dimension: PricingDimension;
    unitPrice: string;
    per?: string;
    match?: string;
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
    source: UsageSource;
    request?: string;
    inputTokens?: string;
    cachedInputTokens?: string;
    outputTokens?: string;
    maxOutputTokens?: string;
    count?: string;
    megapixels?: string;
    characters?: string;
    quality?: string;
    resolution?: string;
    durationSeconds?: string;
    format?: string;
};

export type BillableUsageInput = {
    capability: BillableCapability;
    source: UsageSource;
    request?: DecimalInput;
    inputTokens?: DecimalInput;
    cachedInputTokens?: DecimalInput;
    outputTokens?: DecimalInput;
    maxOutputTokens?: DecimalInput;
    count?: DecimalInput;
    megapixels?: DecimalInput;
    characters?: DecimalInput;
    quality?: string;
    resolution?: string;
    durationSeconds?: DecimalInput;
    format?: string;
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

const numericDimensions = new Set<PricingDimension>(["request", "inputTokens", "cachedInputTokens", "outputTokens", "count", "megapixels", "characters", "durationSeconds"]);
const categoricalDimensions = new Set<PricingDimension>(["quality", "resolution", "format"]);

export function validatePricingRateCard(input: unknown): ValidatedPricingRateCardV1 {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("价格卡必须是对象");
    const value = input as Partial<PricingRateCardInputV1>;
    if (value.version !== 1 || !Array.isArray(value.components) || !value.components.length) throw new Error("价格卡版本或组件无效");
    const ids = new Set<string>();
    const components = value.components.map((component) => normalizeComponent(component, ids));
    return { version: 1, revision: pricingRateCardRevision(components), components };
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
        source: input.source,
        ...numericUsage("request", input.request),
        ...numericUsage("inputTokens", input.inputTokens),
        ...numericUsage("cachedInputTokens", input.cachedInputTokens),
        ...numericUsage("outputTokens", input.outputTokens),
        ...numericUsage("maxOutputTokens", input.maxOutputTokens),
        ...numericUsage("count", input.count),
        ...numericUsage("megapixels", input.megapixels),
        ...numericUsage("characters", input.characters),
        ...textUsage("quality", input.quality),
        ...textUsage("resolution", input.resolution),
        ...numericUsage("durationSeconds", input.durationSeconds),
        ...textUsage("format", input.format),
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
    if (categoricalDimensions.has(value.dimension) && !match) throw new Error("分类价格组件必须指定匹配值");
    if (numericDimensions.has(value.dimension) && match) throw new Error("数值价格组件不能指定匹配值");
    if (per && !hasTerminatingDecimal(decimal(1).dividedBy(decimal(per)))) throw new Error("价格组件单位必须可精确表示");
    ids.add(id);
    return { id, dimension: value.dimension, unitPrice, ...(per ? { per } : {}), ...(match ? { match } : {}) };
}

function priceUsage(rateCard: ValidatedPricingRateCardV1, usage: NormalizedUsage) {
    return rateCard.components.reduce((total, component) => total.plus(priceComponent(component, usage)), decimal(0));
}

function priceComponent(component: PricingComponent, usage: NormalizedUsage) {
    const value = usage[component.dimension];
    if (value === undefined) throw new Error(`缺少价格维度：${component.dimension}`);
    if (categoricalDimensions.has(component.dimension)) {
        if (value !== component.match) return decimal(0);
        const count = usage.count === undefined ? decimal(1) : decimal(usage.count, "生成数量");
        return decimal(component.unitPrice, "价格组件单价").times(count);
    }
    return decimal(component.unitPrice, "价格组件单价")
        .times(decimal(value, component.dimension))
        .dividedBy(decimal(component.per || "1"));
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

function numericUsage(key: "request" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "maxOutputTokens" | "count" | "megapixels" | "characters" | "durationSeconds", value: DecimalInput | undefined) {
    if (value === undefined) return {};
    const normalized = decimal(value, key);
    if (normalized.isNegative()) throw new Error(`${key}不能为负数`);
    return { [key]: normalized.toString() };
}

function textUsage(key: "quality" | "resolution" | "format", value: string | undefined) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized ? { [key]: normalized } : {};
}

function isCapability(value: unknown): value is BillableCapability {
    return value === "text" || value === "image" || value === "video" || value === "audio";
}

function isUsageSource(value: unknown): value is UsageSource {
    return value === "request" || value === "actual" || value === "derived" || value === "reserve";
}

function isDimension(value: unknown): value is PricingDimension {
    return (
        value === "request" ||
        value === "inputTokens" ||
        value === "cachedInputTokens" ||
        value === "outputTokens" ||
        value === "count" ||
        value === "megapixels" ||
        value === "characters" ||
        value === "quality" ||
        value === "resolution" ||
        value === "durationSeconds" ||
        value === "format"
    );
}
