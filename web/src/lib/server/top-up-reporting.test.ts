import { describe, expect, it } from "vitest";

import { qualifiesReferralFromVerifiedTopUp, summarizeTopUpFinancials } from "./top-up-reporting";
import type { TopUpOrder } from "./top-up-payment";

describe("top-up financial reporting", () => {
    it("groups native payments by currency and sums only snapshotted USD values", () => {
        const summary = summarizeTopUpFinancials([
            order({ id: "paid-vnd", currency: "VND", payableNativeAmount: "250000", paidUsdValue: "10", nominalUsdValue: "12", status: "paid", paymentState: "paid" }),
            order({ id: "refunded-vnd", currency: "VND", payableNativeAmount: "125000", paidUsdValue: "5", nominalUsdValue: "5", status: "refunded", paymentState: "refunded" }),
        ]);

        expect(summary).toEqual({
            currencies: [{ currency: "VND", paidNativeAmount: "250000", refundedNativeAmount: "125000", paidOrders: 1, refundedOrders: 1 }],
            paidUsdValue: "10",
            refundedUsdValue: "5",
            nominalUsdValue: "17",
        });
    });

    it("qualifies referrals from the verified nominal USD snapshot instead of client/native fields", () => {
        expect(qualifiesReferralFromVerifiedTopUp(order({ nominalUsdValue: "10", creditAmount: "10", payableNativeAmount: "1", status: "paid", paymentState: "paid", creditGrantState: "granted" }), "10")).toBe(true);
        expect(qualifiesReferralFromVerifiedTopUp(order({ nominalUsdValue: "9.999999999999", creditAmount: "999", status: "paid", paymentState: "paid", creditGrantState: "granted" }), "10")).toBe(false);
        expect(qualifiesReferralFromVerifiedTopUp(order({ nominalUsdValue: "100", status: "pending", paymentState: "pending", creditGrantState: "pending" }), "10")).toBe(false);
    });
});

function order(patch: Partial<TopUpOrder>): TopUpOrder {
    return {
        id: "order-one",
        orderNo: "VZ001",
        userId: "user-one",
        status: "paid",
        paymentState: "paid",
        creditGrantState: "granted",
        providerRefundState: "none",
        creditRecoveryState: "none",
        subject: "充值",
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: "250000",
        promotionDiscountNativeAmount: "0",
        couponDiscountNativeAmount: "0",
        payableNativeAmount: "250000",
        nominalUsdValue: "10",
        paidUsdValue: "10",
        creditAmount: "10",
        pricingVersion: "top-up-v1",
        customerFxVersion: "fx-v1",
        customerFxRate: "0.00004",
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
        provider: "payply",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
        ...patch,
    };
}
