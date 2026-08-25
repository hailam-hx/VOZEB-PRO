import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getOrderById: vi.fn(),
    cancelPendingOrder: vi.fn(),
    releaseCouponForOrder: vi.fn(),
    processPayment: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    isPostgresDatabaseEnabled: vi.fn(() => true),
    ensurePostgresSchema: vi.fn(),
    withPostgresTransaction: vi.fn(async (handler) => handler({ query: vi.fn() })),
    createPostgresRepositories: vi.fn(() => ({
        topUps: {
            getOrderById: mocks.getOrderById,
            cancelPendingOrder: mocks.cancelPendingOrder,
            releaseCouponForOrder: mocks.releaseCouponForOrder,
        },
    })),
}));
vi.mock("./top-up-payment", () => ({ processTopUpPaymentEvent: mocks.processPayment }));
vi.mock("./top-up-postgres-settlement", () => ({ PostgresTopUpPaymentStore: class {} }));

import type { TopUpOrder } from "./top-up-payment";
import { closeManualTopUpOrder, receiveManualTopUpOrder } from "./top-up-admin-order-service";

describe("admin manual top-up order actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getOrderById.mockResolvedValue(pendingOrder());
        mocks.processPayment.mockResolvedValueOnce({ applied: true, duplicate: false, orderId: "order-one", orderNo: "VZ001", creditAmount: "10", businessId: "top-up:order-one:grant" }).mockResolvedValueOnce({
            applied: false,
            duplicate: true,
            orderId: "order-one",
            orderNo: "VZ001",
            creditAmount: "10",
            businessId: "top-up:order-one:grant",
        });
        mocks.cancelPendingOrder.mockResolvedValue({ ...pendingOrder(), status: "canceled" });
        mocks.releaseCouponForOrder.mockResolvedValue(true);
    });

    it("uses one stable manual payment identity so replay cannot grant credits twice", async () => {
        const first = await receiveManualTopUpOrder("order-one", "admin-one");
        const replay = await receiveManualTopUpOrder("order-one", "admin-one");

        expect(first).toMatchObject({ applied: true, creditAmount: "10" });
        expect(replay).toMatchObject({ duplicate: true, creditAmount: "10" });
        expect(mocks.processPayment).toHaveBeenCalledTimes(2);
        const firstEvent = mocks.processPayment.mock.calls[0]?.[0];
        const replayEvent = mocks.processPayment.mock.calls[1]?.[0];
        expect(firstEvent).toMatchObject({
            provider: "manual",
            eventId: "admin-receive:order-one",
            eventType: "admin.payment.received",
            orderId: "order-one",
            orderNo: "VZ001",
            status: "paid",
            amount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
            providerPaymentId: "admin-receive:order-one",
        });
        expect(replayEvent).toEqual(firstEvent);
    });

    it("rejects receive for a non-manual order before settlement", async () => {
        mocks.getOrderById.mockResolvedValue({ ...pendingOrder(), provider: "stripe" });

        await expect(receiveManualTopUpOrder("order-one", "admin-one")).rejects.toThrow("仅支持人工确认渠道");
        expect(mocks.processPayment).not.toHaveBeenCalled();
    });

    it("closes an unpaid manual order and releases its locked coupon without granting credits", async () => {
        const result = await closeManualTopUpOrder("order-one");

        expect(result).toMatchObject({ orderId: "order-one", applied: true, duplicate: false });
        expect(mocks.cancelPendingOrder).toHaveBeenCalledWith("order-one", "user-one");
        expect(mocks.releaseCouponForOrder).toHaveBeenCalledWith("coupon-one", "order-one");
        expect(mocks.processPayment).not.toHaveBeenCalled();
    });

    it("treats replayed close as a duplicate and never mutates a paid order", async () => {
        mocks.getOrderById.mockResolvedValueOnce({ ...pendingOrder(), status: "canceled", closedAt: "2026-08-25T00:00:00.000Z" });
        await expect(closeManualTopUpOrder("order-one")).resolves.toMatchObject({ applied: false, duplicate: true });
        expect(mocks.cancelPendingOrder).not.toHaveBeenCalled();

        mocks.getOrderById.mockResolvedValueOnce({ ...pendingOrder(), status: "paid", paymentState: "paid", creditGrantState: "granted" });
        await expect(closeManualTopUpOrder("order-one")).rejects.toThrow("状态不可关闭");
        expect(mocks.cancelPendingOrder).not.toHaveBeenCalled();
    });
});

function pendingOrder(): TopUpOrder {
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
        promotionDiscountNativeAmount: "0",
        couponDiscountNativeAmount: "0",
        payableNativeAmount: "250000",
        nominalUsdValue: "10",
        paidUsdValue: "10",
        creditAmount: "10",
        pricingVersion: "v1",
        customerFxVersion: "fx1",
        customerFxRate: "0.00004",
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
        provider: "manual",
        userCouponId: "coupon-one",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
    };
}
