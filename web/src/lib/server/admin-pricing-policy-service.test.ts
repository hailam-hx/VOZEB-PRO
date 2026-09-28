import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PRICING_POLICY } from "@/lib/billing/pricing-policy";
import { buildAdminPricingPolicy } from "./admin-pricing-policy-service";

describe("admin pricing policy service", () => {
    it("accepts only administrator-editable fields and preserves server-managed currency metadata", () => {
        const current = { ...DEFAULT_SYSTEM_PRICING_POLICY, dflopCreditsPerCny: "75", dflopCreditsPerCnySource: "upstream" as const, dflopCurrencyConfigVersion: "currency-v2" };
        const next = buildAdminPricingPolicy(current, { cnyToUsd: "0.16", markupMultiplier: "1.3", minimumMarginRate: "0.2", costBasis: "primary_binding_cost", autoApplySalePrice: true });
        expect(next).toMatchObject({ dflopCreditsPerCny: "75", dflopCreditsPerCnySource: "upstream", dflopCurrencyConfigVersion: "currency-v2", cnyToUsd: "0.16", markupMultiplier: "1.3", autoApplySalePrice: false });
    });

    it("rejects client-supplied policy versions and managed DFLOP currency fields", () => {
        expect(() => buildAdminPricingPolicy(DEFAULT_SYSTEM_PRICING_POLICY, { version: "forged" } as never)).toThrow("不允许");
        expect(() => buildAdminPricingPolicy(DEFAULT_SYSTEM_PRICING_POLICY, { dflopCreditsPerCny: "1" } as never)).toThrow("不允许");
    });

    it("accepts an unchanged server-managed snapshot while still normalizing editable fields", () => {
        expect(buildAdminPricingPolicy(DEFAULT_SYSTEM_PRICING_POLICY, { ...DEFAULT_SYSTEM_PRICING_POLICY, cnyToUsd: "0.16" })).toMatchObject({
            dflopCreditsPerCny: "60",
            dflopCreditsPerCnySource: "default",
            cnyToUsd: "0.16",
        });
    });
});
