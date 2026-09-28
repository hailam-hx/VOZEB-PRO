import { decimal } from "./decimal";
import type { SalePriceApprovalSnapshot } from "@/lib/auth/store-types";
import type { PricingRateCardV1 } from "./pricing";
import type { ProviderPricingStatus } from "./provider-pricing";
import { validatePricingRateCard } from "./pricing";

export type PricingCostBasis = "max_active_binding_cost" | "primary_binding_cost";
export type DflopCreditsPerCnySource = "upstream" | "manual" | "default";

export type SystemPricingPolicy = {
    version: string;
    dflopCreditsPerCny: string;
    dflopCreditsPerCnySource: DflopCreditsPerCnySource;
    dflopCurrencyConfigVersion?: string;
    cnyToUsd: string;
    hotxUsdPerCredit: string;
    markupMultiplier: string;
    minimumMarginRate: string | null;
    costBasis: PricingCostBasis;
    autoApplySalePrice: boolean;
};

export type DflopCurrencyConfig = {
    creditsPerCny: string;
    version: string;
};

export type ProviderPricingConversionSnapshot = {
    pricingPolicyVersion: string;
    dflopCreditsPerCny: string;
    dflopCreditsPerCnySource: DflopCreditsPerCnySource;
    dflopCurrencyConfigVersion?: string;
    cnyToUsd: string;
    hotxUsdPerCredit: string;
    calculatedAt: string;
};

export type SuggestedSaleRateCard = {
    rateCard: PricingRateCardV1;
    pricingPolicyVersion: string;
    calculatedAt: string;
    costBasis: PricingCostBasis;
    markupMultiplier: string;
    bindingInputs: Array<{ bindingId: string; channelId: string; provider: string; costRateRevision: string; pricingStatus: ProviderPricingStatus }>;
    conversionInputs: ProviderPricingConversionSnapshot[];
};

const DEFAULT_POLICY_VALUES: Omit<SystemPricingPolicy, "version"> = {
    dflopCreditsPerCny: "60",
    dflopCreditsPerCnySource: "default",
    cnyToUsd: "0.15",
    hotxUsdPerCredit: "1",
    markupMultiplier: "1",
    minimumMarginRate: null,
    costBasis: "max_active_binding_cost",
    autoApplySalePrice: false,
};

export const DEFAULT_SYSTEM_PRICING_POLICY: SystemPricingPolicy = withVersion(DEFAULT_POLICY_VALUES);

export function normalizeSystemPricingPolicy(input: unknown): SystemPricingPolicy {
    const value = isRecord(input) ? input : {};
    const minimumMarginRate = value.minimumMarginRate === null || value.minimumMarginRate === undefined ? null : nonNegativeDecimal(value.minimumMarginRate, "最低毛利率");
    if (minimumMarginRate !== null && !decimal(1).greaterThan(decimal(minimumMarginRate))) throw new Error("最低毛利率必须大于等于 0 且小于 1");
    const normalized: Omit<SystemPricingPolicy, "version"> = {
        dflopCreditsPerCny: positiveDecimal(value.dflopCreditsPerCny ?? DEFAULT_POLICY_VALUES.dflopCreditsPerCny, "DFLOP credits/CNY"),
        dflopCreditsPerCnySource: source(value.dflopCreditsPerCnySource),
        ...(text(value.dflopCurrencyConfigVersion) ? { dflopCurrencyConfigVersion: text(value.dflopCurrencyConfigVersion) } : {}),
        cnyToUsd: positiveDecimal(value.cnyToUsd ?? DEFAULT_POLICY_VALUES.cnyToUsd, "CNY/USD 汇率"),
        hotxUsdPerCredit: positiveDecimal(value.hotxUsdPerCredit ?? DEFAULT_POLICY_VALUES.hotxUsdPerCredit, "HOTX USD/credit"),
        markupMultiplier: positiveDecimal(value.markupMultiplier ?? DEFAULT_POLICY_VALUES.markupMultiplier, "加价系数"),
        minimumMarginRate,
        costBasis: value.costBasis === "primary_binding_cost" ? "primary_binding_cost" : "max_active_binding_cost",
        autoApplySalePrice: false,
    };
    return withVersion(normalized);
}

export function pricingPolicyVersion(policy: Omit<SystemPricingPolicy, "version"> | SystemPricingPolicy) {
    return `pricing-policy-v1:${stableJson({
        dflopCreditsPerCny: policy.dflopCreditsPerCny,
        dflopCreditsPerCnySource: policy.dflopCreditsPerCnySource,
        dflopCurrencyConfigVersion: policy.dflopCurrencyConfigVersion || null,
        cnyToUsd: policy.cnyToUsd,
        hotxUsdPerCredit: policy.hotxUsdPerCredit,
        markupMultiplier: policy.markupMultiplier,
        minimumMarginRate: policy.minimumMarginRate,
        costBasis: policy.costBasis,
        autoApplySalePrice: policy.autoApplySalePrice,
    })}`;
}

export function parseDflopCurrencyConfig(payload: unknown): DflopCurrencyConfig | undefined {
    if (!isRecord(payload) || payload.unit !== "points" || !("points_per_cny" in payload)) return undefined;
    try {
        const creditsPerCny = positiveDecimal(typeof payload.points_per_cny === "number" ? String(payload.points_per_cny) : payload.points_per_cny, "DFLOP credits/CNY");
        return { creditsPerCny, version: `dflop-currency-v1:${stableJson(payload)}` };
    } catch {
        return undefined;
    }
}

export function convertDflopCreditsToHotx(value: string, policy: SystemPricingPolicy) {
    const credits = decimal(value, "DFLOP credits");
    if (credits.isNegative()) throw new Error("DFLOP credits 不能为负数");
    return credits.dividedBy(decimal(policy.dflopCreditsPerCny)).times(decimal(policy.cnyToUsd)).dividedBy(decimal(policy.hotxUsdPerCredit)).toString();
}

export function pricingConversionSnapshot(policy: SystemPricingPolicy, calculatedAt: string): ProviderPricingConversionSnapshot {
    return {
        pricingPolicyVersion: policy.version,
        dflopCreditsPerCny: policy.dflopCreditsPerCny,
        dflopCreditsPerCnySource: policy.dflopCreditsPerCnySource,
        ...(policy.dflopCurrencyConfigVersion ? { dflopCurrencyConfigVersion: policy.dflopCurrencyConfigVersion } : {}),
        cnyToUsd: policy.cnyToUsd,
        hotxUsdPerCredit: policy.hotxUsdPerCredit,
        calculatedAt,
    };
}

export function normalizeSuggestedSaleRateCard(value: unknown): SuggestedSaleRateCard | undefined {
    if (!isRecord(value)) return undefined;
    const pricingPolicyVersion = text(value.pricingPolicyVersion);
    const calculatedAt = text(value.calculatedAt);
    const markupMultiplier = positiveDecimal(value.markupMultiplier, "建议售价加价系数");
    const costBasis = value.costBasis === "primary_binding_cost" ? "primary_binding_cost" : value.costBasis === "max_active_binding_cost" ? "max_active_binding_cost" : undefined;
    if (!pricingPolicyVersion || !calculatedAt || !costBasis || !Array.isArray(value.bindingInputs) || !Array.isArray(value.conversionInputs)) return undefined;
    let rateCard: PricingRateCardV1;
    try {
        rateCard = validatePricingRateCard(value.rateCard);
    } catch {
        return undefined;
    }
    const bindingInputs = value.bindingInputs.flatMap((item) => {
        if (!isRecord(item)) return [];
        const bindingId = text(item.bindingId);
        const channelId = text(item.channelId);
        const provider = text(item.provider);
        const costRateRevision = text(item.costRateRevision);
        const pricingStatus = item.pricingStatus;
        if (!bindingId || !channelId || !provider || !costRateRevision || (pricingStatus !== "READY" && pricingStatus !== "PARTIAL" && pricingStatus !== "NEEDS_REVIEW" && pricingStatus !== "STALE")) return [];
        return [{ bindingId, channelId, provider, costRateRevision, pricingStatus: pricingStatus as ProviderPricingStatus }];
    });
    const conversionInputs = value.conversionInputs.flatMap((item) => {
        if (!isRecord(item)) return [];
        const pricingPolicyVersion = text(item.pricingPolicyVersion);
        const dflopCreditsPerCny = text(item.dflopCreditsPerCny);
        const cnyToUsd = text(item.cnyToUsd);
        const hotxUsdPerCredit = text(item.hotxUsdPerCredit);
        const calculatedAt = text(item.calculatedAt);
        const source = item.dflopCreditsPerCnySource;
        if (!pricingPolicyVersion || !dflopCreditsPerCny || !cnyToUsd || !hotxUsdPerCredit || !calculatedAt || (source !== "upstream" && source !== "manual" && source !== "default")) return [];
        return [
            {
                pricingPolicyVersion,
                dflopCreditsPerCny,
                dflopCreditsPerCnySource: source as DflopCreditsPerCnySource,
                ...(text(item.dflopCurrencyConfigVersion) ? { dflopCurrencyConfigVersion: text(item.dflopCurrencyConfigVersion) } : {}),
                cnyToUsd,
                hotxUsdPerCredit,
                calculatedAt,
            },
        ];
    });
    return { rateCard, pricingPolicyVersion, calculatedAt, costBasis, markupMultiplier, bindingInputs, conversionInputs };
}

export function normalizeSalePriceApproval(value: unknown): SalePriceApprovalSnapshot | undefined {
    if (!isRecord(value)) return undefined;
    const suggestedRevision = text(value.suggestedRevision);
    const pricingPolicyVersion = text(value.pricingPolicyVersion);
    const calculatedAt = text(value.calculatedAt);
    const markupMultiplier = positiveDecimal(value.markupMultiplier, "审批建议售价加价系数");
    const costBasis = value.costBasis === "primary_binding_cost" ? "primary_binding_cost" : value.costBasis === "max_active_binding_cost" ? "max_active_binding_cost" : undefined;
    const approvedAt = text(value.approvedAt);
    const approvedBy = text(value.approvedBy);
    if (!suggestedRevision || !pricingPolicyVersion || !calculatedAt || !costBasis || !approvedAt || !approvedBy) return undefined;
    return { suggestedRevision, pricingPolicyVersion, calculatedAt, costBasis, markupMultiplier, approvedAt, approvedBy, ...(text(value.batchOperationId) ? { batchOperationId: text(value.batchOperationId) } : {}) };
}

function withVersion(policy: Omit<SystemPricingPolicy, "version">): SystemPricingPolicy {
    return { ...policy, version: pricingPolicyVersion(policy) };
}

function positiveDecimal(value: unknown, label: string) {
    const normalized = decimal(decimalInput(value), label);
    if (!normalized.greaterThan(decimal(0))) throw new Error(`${label}必须大于零`);
    return normalized.toString();
}

function nonNegativeDecimal(value: unknown, label: string) {
    const normalized = decimal(decimalInput(value), label);
    if (normalized.isNegative()) throw new Error(`${label}不能为负数`);
    return normalized.toString();
}

function decimalInput(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
}

function source(value: unknown): DflopCreditsPerCnySource {
    return value === "upstream" || value === "manual" ? value : "default";
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value))
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(",")}}`;
    return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 500) : "";
}
