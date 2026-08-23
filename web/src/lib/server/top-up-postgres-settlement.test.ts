import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    order: {} as Record<string, unknown>,
    existingPayment: {} as Record<string, unknown>,
    userUpdate: vi.fn(),
    redeemCoupon: vi.fn(),
    query: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    withPostgresTransaction: vi.fn(async (handler) => handler({
        query: mocks.query,
    })),
    createPostgresRepositories: vi.fn(() => ({
        topUps: { getOrderById: vi.fn(async () => mocks.order), redeemCouponForOrder: mocks.redeemCoupon },
        users: { getById: vi.fn(async () => ({ id: "user-one", status: "active", settledBalance: "0" })), update: mocks.userUpdate },
        points: { getRecordByIdempotencyKey: vi.fn(async () => null), addRecord: vi.fn(async () => ({ id: "grant" })) },
    })),
}));
vi.mock("@/lib/server/auth-mutation-lock", () => ({ lockAuthMutation: vi.fn() }));
vi.mock("@/lib/server/referral-service", () => ({ prepareReferralRewardsForPaidOrder: vi.fn() }));

import { PostgresTopUpPaymentStore } from "./top-up-postgres-settlement";

const order = {
    id: "order-one", orderNo: "VZ001", userId: "user-one", status: "pending", paymentState: "pending", creditGrantState: "pending", providerRefundState: "none", creditRecoveryState: "none",
    subject: "充值", currency: "VND", currencyExponent: 0, nominalNativeAmount: "250000", promotionDiscountNativeAmount: "0", couponDiscountNativeAmount: "0", payableNativeAmount: "250000",
    nominalUsdValue: "10", paidUsdValue: "10", creditAmount: "10", pricingVersion: "v1", customerFxVersion: "fx1", customerFxRate: "0.00004",
    paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 }, provider: "stripe", userCouponId: "coupon-one",
    createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
} as const;

const settlement = {
    order,
    event: { signatureValid: true, provider: "stripe", eventId: "evt-one", eventType: "payment.succeeded", orderId: "order-one", orderNo: "VZ001", status: "succeeded", amount: order.paymentAmount, providerPaymentId: "payment-one", paidAt: "2026-08-23T00:00:00.000Z" },
    eventFingerprint: "event-fingerprint", businessId: "top-up:order-one:grant", requestFingerprint: "request-fingerprint", creditAmount: "10",
} as const;

describe("PostgreSQL top-up payment identity ownership", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes("INSERT INTO top_up_payment_events")) return { rows: [{ id: "event-row" }], rowCount: 1 };
            if (sql.includes("INSERT INTO top_up_payments")) return { rows: [], rowCount: 0 };
            if (sql.includes("FROM top_up_payments")) return { rows: [mocks.existingPayment], rowCount: 1 };
            return { rows: [{ id: "order-one" }], rowCount: 1 };
        });
        mocks.order = { ...order };
        mocks.existingPayment = {
            id: "top-up-payment:stripe:payment-one", order_id: "order-two", user_id: "user-two", provider: "stripe", provider_event_id: "evt-two", status: "succeeded", payment_kind: "fiat",
            order_snapshot_fingerprint: orderFingerprint(), fiat_currency: "VND", amount_minor: "250000", minor_unit_exponent: 0, provider_trade_id: null, provider_payment_id: "payment-one",
        };
    });

    it("supplies both required webhook identity fields when inserting a settled payment", async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes("INSERT INTO top_up_payment_events")) return { rows: [{ id: "event-row" }], rowCount: 1 };
            if (sql.includes("INSERT INTO top_up_payments")) return { rows: [{ id: "top-up-payment:stripe:payment-one" }], rowCount: 1 };
            return { rows: [{ id: "order-one" }], rowCount: 1 };
        });
        mocks.userUpdate.mockResolvedValue({ id: "user-one" });
        mocks.redeemCoupon.mockResolvedValue(true);

        await expect(new PostgresTopUpPaymentStore().settle(settlement)).resolves.toBe("applied");

        const paymentCall = mocks.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO top_up_payments"));
        expect(String(paymentCall?.[0])).toContain("provider_event_id, order_snapshot_fingerprint");
        expect(paymentCall?.[1]).toEqual(expect.arrayContaining(["evt-one", orderFingerprint()]));
    });

    it("rejects one provider payment identity claimed by a different order before wallet grant", async () => {
        await expect(new PostgresTopUpPaymentStore().settle(settlement)).rejects.toThrow("支付身份");
        expect(mocks.userUpdate).not.toHaveBeenCalled();
        expect(mocks.redeemCoupon).not.toHaveBeenCalled();
    });

    it("treats an exact existing payment identity as an idempotent duplicate", async () => {
        mocks.existingPayment = { ...mocks.existingPayment, order_id: "order-one", user_id: "user-one", provider_event_id: "evt-one" };

        await expect(new PostgresTopUpPaymentStore().settle(settlement)).resolves.toBe("duplicate");
        expect(mocks.userUpdate).not.toHaveBeenCalled();
    });
});

function orderFingerprint() {
    return createHash("sha256")
        .update(JSON.stringify({ id: order.id, userId: order.userId, paymentAmount: order.paymentAmount, creditAmount: order.creditAmount, nominalNativeAmount: order.nominalNativeAmount, payableNativeAmount: order.payableNativeAmount, nominalUsdValue: order.nominalUsdValue, paidUsdValue: order.paidUsdValue, pricingVersion: order.pricingVersion, customerFxVersion: order.customerFxVersion, customerFxRate: order.customerFxRate }))
        .digest("hex");
}
