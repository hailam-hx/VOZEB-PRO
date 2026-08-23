import { describe, expect, it } from "vitest";

import { convertProviderCostToUsd, validateProviderCostUnit, sumProviderAttemptCostUsd, type ProviderCostUnit } from "./money";

describe("provider cost money", () => {
    it("converts provider-native cost with its versioned USD snapshot without intermediate rounding", () => {
        const native: ProviderCostUnit = {
            kind: "provider-native",
            provider: "vendor",
            unit: "tokens",
            usdConversion: { version: "vendor-2026-08", usdPerUnit: "0.333333333333333333" },
        };

        expect(convertProviderCostToUsd("3", native)).toBe("0.999999999999999999");
        expect(
            sumProviderAttemptCostUsd([
                { amount: "0.1", unit: { kind: "fiat", currency: "USD" } },
                { amount: "3", unit: native },
            ]),
        ).toBe("1.099999999999999999");
    });

    it("rejects provider-native cost without a conversion snapshot and fiat cost that is not USD", () => {
        expect(() => convertProviderCostToUsd("1", { kind: "provider-native", provider: "vendor", unit: "tokens" } as ProviderCostUnit)).toThrow("USD 转换快照");
        expect(() => convertProviderCostToUsd("1", { kind: "fiat", currency: "VND" } as unknown as ProviderCostUnit)).toThrow("USD");
    });

    it("surfaces an invalid provider conversion snapshot during configuration validation", () => {
        expect(() => validateProviderCostUnit({ kind: "provider-native", provider: "vendor", unit: "tokens", usdConversion: { version: "v1", usdPerUnit: "0" } })).toThrow("USD 转换快照");
    });
});
