import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PRICING_POLICY, convertDflopCreditsToHotx, normalizeSystemPricingPolicy, parseDflopCurrencyConfig, pricingConversionSnapshot, pricingPolicyVersion } from "./pricing-policy";

describe("system pricing policy", () => {
    it("uses the approved break-even defaults without enabling sale-price writes", () => {
        expect(DEFAULT_SYSTEM_PRICING_POLICY).toMatchObject({
            dflopCreditsPerCny: "60",
            dflopCreditsPerCnySource: "default",
            cnyToUsd: "0.15",
            hotxUsdPerCredit: "1",
            markupMultiplier: "1",
            minimumMarginRate: null,
            costBasis: "max_active_binding_cost",
            autoApplySalePrice: false,
        });
        expect(DEFAULT_SYSTEM_PRICING_POLICY.version).toBe(pricingPolicyVersion(DEFAULT_SYSTEM_PRICING_POLICY));
    });

    it("normalizes decimal text and preserves an explicit manual currency source", () => {
        const policy = normalizeSystemPricingPolicy({
            dflopCreditsPerCny: "060.00",
            dflopCreditsPerCnySource: "manual",
            cnyToUsd: "0.1500",
            hotxUsdPerCredit: "1.0",
            markupMultiplier: "1.2500",
            minimumMarginRate: "0.1",
            costBasis: "primary_binding_cost",
            autoApplySalePrice: true,
        });

        expect(policy).toMatchObject({ dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "manual", cnyToUsd: "0.15", hotxUsdPerCredit: "1", markupMultiplier: "1.25", minimumMarginRate: "0.1" });
        expect(policy.autoApplySalePrice).toBe(false);
        expect(policy.version).toBe(pricingPolicyVersion(policy));
    });

    it("rejects invalid conversion values and invalid margin ranges", () => {
        expect(() => normalizeSystemPricingPolicy({ cnyToUsd: "0" })).toThrow("CNY/USD");
        expect(() => normalizeSystemPricingPolicy({ markupMultiplier: "-1" })).toThrow("加价系数");
        expect(() => normalizeSystemPricingPolicy({ minimumMarginRate: "1" })).toThrow("最低毛利率");
    });
});

describe("DFLOP currency configuration", () => {
    const livePayload = { unit: "points", points_per_cny: 60.0, usd_to_cny_peg: 6.74, points_per_usd: 404.4 };

    it("accepts the confirmed machine-readable schema and versions the full payload", () => {
        const parsed = parseDflopCurrencyConfig(livePayload)!;
        expect(parsed).toMatchObject({ creditsPerCny: "60" });
        expect(parsed.version).toMatch(/^dflop-currency-v1:/);
        expect(parseDflopCurrencyConfig({ points_per_usd: 60, unit: "points" })).toBeUndefined();
        expect(parseDflopCurrencyConfig({ unit: "credits", points_per_cny: 60 })).toBeUndefined();
        expect(parseDflopCurrencyConfig({ value: 60 })).toBeUndefined();
    });

    it("does not use DFLOP's USD peg as HOTX's CNY/USD business rate", () => {
        const policy = normalizeSystemPricingPolicy({ dflopCreditsPerCny: parseDflopCurrencyConfig(livePayload)?.creditsPerCny, dflopCreditsPerCnySource: "upstream" });
        expect(convertDflopCreditsToHotx("224.532", policy)).toBe("0.56133");
        expect(convertDflopCreditsToHotx("90.72", policy)).toBe("0.2268");
        expect(convertDflopCreditsToHotx("0.000000000001", policy)).toBe("0.0000000000000025");
    });

    it("records every conversion input in an auditable snapshot", () => {
        const policy = normalizeSystemPricingPolicy({ dflopCreditsPerCnySource: "upstream", dflopCurrencyConfigVersion: "dflop-currency-v1:test" });
        expect(pricingConversionSnapshot(policy, "2026-09-24T01:00:00.000Z")).toEqual({
            pricingPolicyVersion: policy.version,
            dflopCreditsPerCny: "60",
            dflopCreditsPerCnySource: "upstream",
            dflopCurrencyConfigVersion: "dflop-currency-v1:test",
            cnyToUsd: "0.15",
            hotxUsdPerCredit: "1",
            calculatedAt: "2026-09-24T01:00:00.000Z",
        });
    });
});
