import { normalizeSystemPricingPolicy, type SystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { AuthInputError } from "@/lib/auth/store-foundation";

const EDITABLE_FIELDS = new Set(["cnyToUsd", "hotxUsdPerCredit", "markupMultiplier", "minimumMarginRate", "costBasis", "autoApplySalePrice"]);
const SERVER_MANAGED_FIELDS = new Set(["version", "dflopCreditsPerCny", "dflopCreditsPerCnySource", "dflopCurrencyConfigVersion"]);

export function buildAdminPricingPolicy(current: SystemPricingPolicy, input: unknown): SystemPricingPolicy {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AuthInputError("定价策略无效");
    const submitted = input as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(submitted)) {
        if (EDITABLE_FIELDS.has(key)) patch[key] = value;
        else if (!SERVER_MANAGED_FIELDS.has(key) || value !== current[key as keyof SystemPricingPolicy]) throw new AuthInputError(`定价策略字段 ${key} 不允许由客户端修改`);
    }
    try {
        return normalizeSystemPricingPolicy({ ...current, ...patch });
    } catch (error) {
        throw new AuthInputError(error instanceof Error ? error.message : "定价策略无效");
    }
}
