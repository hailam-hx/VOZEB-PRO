import { describe, expect, it } from "vitest";

import { quoteTopUp, type TopUpPreset, type TopUpPricingConfig } from "./top-up-pricing";

const config: TopUpPricingConfig = {
    version: "top-up-v1",
    currency: "VND",
    minorUnitExponent: 0,
    customerFx: { version: "vnd-usd-2026-08-23", usdPerVnd: "0.00004" },
};

const preset: TopUpPreset = {
    id: "starter",
    name: "Starter",
    description: "",
    nominalNativeAmount: "500000",
    enabled: true,
    sortOrder: 10,
};

describe("top-up pricing", () => {
    it("quotes a custom VND amount from the trusted FX snapshot", () => {
        expect(quoteTopUp({ request: { customAmountVnd: "125001", creditAmount: "999999" } as never, config })).toMatchObject({
            currency: "VND",
            currencyExponent: 0,
            nominalNativeAmount: "125001",
            payableNativeAmount: "125001",
            nominalUsdValue: "5.00004",
            paidUsdValue: "5.00004",
            creditAmount: "5.00004",
            paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "125001", minorUnitExponent: 0 },
            pricingVersion: "top-up-v1",
            customerFx: { version: "vnd-usd-2026-08-23", usdPerVnd: "0.00004" },
        });
    });

    it("quotes an enabled preset without trusting a client amount", () => {
        expect(quoteTopUp({ request: { presetId: preset.id, customAmountVnd: "1" }, config, preset })).toMatchObject({
            presetId: "starter",
            nominalNativeAmount: "500000",
            creditAmount: "20",
            paymentAmount: { amountMinor: "500000" },
        });
    });

    it("keeps nominal credits while promotion and percentage coupon lower only payable value", () => {
        expect(
            quoteTopUp({
                request: { presetId: preset.id },
                config,
                preset,
                promotion: { id: "summer", label: "Summer", payableNativeAmount: "400000" },
                coupon: { userCouponId: "coupon-one", templateId: "ten-off", type: "percentage", value: "1000" },
            }),
        ).toMatchObject({
            nominalNativeAmount: "500000",
            promotionDiscountNativeAmount: "100000",
            couponDiscountNativeAmount: "40000",
            payableNativeAmount: "360000",
            nominalUsdValue: "20",
            paidUsdValue: "14.4",
            creditAmount: "20",
            promotion: { id: "summer" },
            coupon: { templateId: "ten-off" },
        });
    });

    it("requires a fixed coupon to match VND", () => {
        expect(() =>
            quoteTopUp({
                request: { customAmountVnd: "250000" },
                config,
                coupon: { userCouponId: "coupon-one", templateId: "fixed", type: "fixed", value: "50000", currency: "USD" },
            }),
        ).toThrow("币种");
    });

    it.each([
        ["custom", { request: { customAmountVnd: "250000.1" }, config }],
        ["preset", { request: { presetId: "fractional" }, config, preset: { ...preset, id: "fractional", nominalNativeAmount: "250000.1" } }],
    ])("rejects fractional VND from a %s input before snapshotting", (_label, input) => {
        expect(() => quoteTopUp(input)).toThrow("整数");
    });
});
