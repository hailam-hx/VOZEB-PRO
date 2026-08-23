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

    it("redeems and releases only the coupon bound to the same order", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ id: "coupon-one" }], rowCount: 1 });
        const repository = new TopUpRepository({ query } as never);

        await expect(repository.redeemCouponForOrder("coupon-one", "order-one")).resolves.toBe(true);
        await expect(repository.releaseCouponForOrder("coupon-one", "order-one")).resolves.toBe(true);

        expect(String(query.mock.calls[0]?.[0])).toContain("status = 'locked' AND locked_order_id = $2");
        expect(String(query.mock.calls[0]?.[0])).toContain("status = 'redeemed'");
        expect(String(query.mock.calls[1]?.[0])).toContain("status = 'locked' AND locked_order_id = $2");
        expect(String(query.mock.calls[1]?.[0])).toContain("status = 'available'");
    });

    it("expires one confirmed pending order and releases only its bound coupon", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 });
        const repository = new TopUpRepository({ query } as never);

        await repository.expirePendingOrder("order-one", "2026-08-24T00:00:00.000Z");

        expect(String(query.mock.calls[0]?.[0])).toContain("expires_at <= $2::timestamptz");
        expect(String(query.mock.calls[0]?.[0])).toContain("locked_order_id = expired.id");
        expect(String(query.mock.calls[0]?.[0])).toContain("status = 'available'");
    });

    it("round-trips separate unsigned local paid and refunded reconciliation totals", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{
            id: "run-one", provider: "stripe", source: "csv", status: "completed", total_rows: 1, matched_rows: 1, ok_rows: 1, issue_rows: 0,
            statement_paid_amount: { kind: "fiat", currency: "VND", amountMinor: "0", minorUnitExponent: 0 },
            statement_refunded_amount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
            local_paid_amount: { kind: "fiat", currency: "VND", amountMinor: "0", minorUnitExponent: 0 },
            local_refunded_amount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
            difference_amount: { kind: "fiat", currency: "VND", amountMinor: "0", minorUnitExponent: 0 }, difference_direction: "balanced",
            local_nominal_usd_value: "10", local_paid_usd_value: "10", created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z",
        }], rowCount: 1 });

        const run = await new TopUpRepository({ query } as never).getReconciliationRun("run-one");

        expect(run).toMatchObject({ localPaidAmount: { amountMinor: "0" }, localRefundedAmount: { amountMinor: "250000" } });
        expect(run).not.toHaveProperty("localMatchedAmount");
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
