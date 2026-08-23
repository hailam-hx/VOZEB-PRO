import { describe, expect, it } from "vitest";

import { convertProviderCostToUsd, validatePaymentAmount, validateProviderCostUnit, sumProviderAttemptCostUsd, type ProviderCostUnit } from "./money";

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

describe("payment amount", () => {
    it("normalizes a fiat provider amount without accepting decimal or exponent overrides", () => {
        expect(validatePaymentAmount({ kind: "fiat", currency: "vnd", amountMinor: "125000", minorUnitExponent: 0 })).toEqual({
            kind: "fiat",
            currency: "VND",
            amountMinor: "125000",
            minorUnitExponent: 0,
        });
        expect(() => validatePaymentAmount({ kind: "fiat", currency: "VND", amountMinor: "125000.1", minorUnitExponent: 0 })).toThrow("最小单位");
        expect(() => validatePaymentAmount({ kind: "fiat", currency: "VND", amountMinor: "125000", minorUnitExponent: 2 })).toThrow("币种指数");
    });

    it("keeps a crypto-ready transaction identity while rejecting unsafe atomic values", () => {
        expect(validatePaymentAmount({ kind: "crypto", asset: "USDT", network: "TRON", amountAtomic: "1000000", decimals: 6, txHash: "0xabc" })).toEqual({
            kind: "crypto",
            asset: "USDT",
            network: "TRON",
            amountAtomic: "1000000",
            decimals: 6,
            txHash: "0xabc",
        });
        expect(() => validatePaymentAmount({ kind: "crypto", asset: "USDT", network: "TRON", amountAtomic: Number.MAX_SAFE_INTEGER + 1, decimals: 6 })).toThrow("原子单位");
    });
});
