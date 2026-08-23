import { describe, expect, it, vi } from "vitest";

import { TopUpRepository, mapTopUpOrderRow, mapTopUpPresetRow } from "./top-up-repository";
import type { TopUpOrder } from "../top-up-payment";

describe("top-up repository", () => {
    it("maps numeric snapshots as exact strings", () => {
        expect(mapTopUpPresetRow({ id: "starter", name: "Starter", description: "", nominal_native_amount: "250000.000000000000", enabled: true, sort_order: 1, created_at: "2026-08-23", updated_at: "2026-08-23" })).toMatchObject({
            id: "starter",
            nominalNativeAmount: "250000.000000000000",
        });
        expect(mapTopUpOrderRow(row())).toMatchObject({
            nominalUsdValue: "10.000000000000",
            paidUsdValue: "8.000000000000",
            creditAmount: "10.00000000",
            paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "200000", minorUnitExponent: 0 },
        });
    });

    it("persists only server-computed snapshot fields with explicit numeric casts", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 });
        const repository = new TopUpRepository({ query } as never);

        await repository.createOrder(order());

        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("INSERT INTO top_up_orders");
        expect(String(sql)).toContain("$10::numeric");
        expect(String(sql)).toContain("$17::numeric");
        expect(params).toContain("10");
        expect(params).toContain("0.00004");
        expect(params).not.toContain("999999");
    });

    it("writes top-up preset CRUD with exact numeric casts", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ id: "starter", name: "入门", description: "", nominal_native_amount: "250000", enabled: true, sort_order: 1 }], rowCount: 1 });
        const repository = new TopUpRepository({ query } as never);

        await repository.savePreset({ id: "starter", name: "入门", description: "", nominalNativeAmount: "250000", enabled: true, sortOrder: 1 });
        await repository.deletePreset("starter");

        expect(String(query.mock.calls[0]?.[0])).toContain("nominal_native_amount = EXCLUDED.nominal_native_amount");
        expect(String(query.mock.calls[0]?.[0])).toContain("$4::numeric");
        expect(String(query.mock.calls[1]?.[0])).toContain("DELETE FROM top_up_presets");
    });
});

function order(): TopUpOrder {
    return {
        id: "order-one",
        orderNo: "VZ001",
        userId: "user-one",
        status: "pending",
        paymentState: "pending",
        creditGrantState: "pending",
        providerRefundState: "none",
        creditRecoveryState: "none",
        subject: "充值",
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: "250000",
        promotionDiscountNativeAmount: "50000",
        couponDiscountNativeAmount: "0",
        payableNativeAmount: "200000",
        nominalUsdValue: "10",
        paidUsdValue: "8",
        creditAmount: "10",
        pricingVersion: "top-up-v1",
        customerFxVersion: "fx-v1",
        customerFxRate: "0.00004",
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "200000", minorUnitExponent: 0 },
        provider: "payply",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
    };
}

function row() {
    return {
        id: "order-one",
        order_no: "VZ001",
        user_id: "user-one",
        status: "pending",
        payment_state: "pending",
        credit_grant_state: "pending",
        provider_refund_state: "none",
        credit_recovery_state: "none",
        subject: "充值",
        currency: "VND",
        currency_exponent: 0,
        nominal_native_amount: "250000.000000000000",
        promotion_discount_native_amount: "50000.000000000000",
        coupon_discount_native_amount: "0.000000000000",
        payable_native_amount: "200000.000000000000",
        nominal_usd_value: "10.000000000000",
        paid_usd_value: "8.000000000000",
        credit_amount: "10.00000000",
        pricing_version: "top-up-v1",
        customer_fx_version: "fx-v1",
        customer_fx_rate: "0.000040000000",
        payment_kind: "fiat",
        payment_amount: { kind: "fiat", currency: "VND", amountMinor: "200000", minorUnitExponent: 0 },
        provider: "payply",
        snapshot: {},
        metadata: {},
        created_at: "2026-08-23T00:00:00.000Z",
        updated_at: "2026-08-23T00:00:00.000Z",
    };
}
