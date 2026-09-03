import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    getPreset: vi.fn(),
    createOrder: vi.fn(),
    getPromotion: vi.fn(),
    getCoupon: vi.fn(),
    lockCoupon: vi.fn(),
    cancelOrder: vi.fn(),
    releaseCoupon: vi.fn(),
    getOrderById: vi.fn(),
    expirePendingOrder: vi.fn(),
    getPaymentConfig: vi.fn(),
}));

vi.mock("@/lib/server/database", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/server/database")>()),
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(() => true),
    withPostgresTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({ query: vi.fn() })),
    createPostgresRepositories: vi.fn(() => ({
        users: { getById: mocks.getUser },
        topUps: {
            getPresetById: mocks.getPreset,
            createOrder: mocks.createOrder,
            getPromotion: mocks.getPromotion,
            getAvailableCoupon: mocks.getCoupon,
            lockCoupon: mocks.lockCoupon,
            cancelPendingOrder: mocks.cancelOrder,
            releaseCouponForOrder: mocks.releaseCoupon,
            getOrderById: mocks.getOrderById,
            expirePendingOrder: mocks.expirePendingOrder,
        },
    })),
}));
vi.mock("@/lib/server/payment-config-store", () => ({
    getPaymentRuntimeConfig: mocks.getPaymentConfig,
    isPaymentRuntimeProviderCheckoutReady: vi.fn(() => true),
}));

import { cancelTopUpOrderForUser, createTopUpOrder, getTopUpOrderForUser, saveTopUpPreset } from "./top-up-commerce-service";

describe("top-up commerce service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUser.mockResolvedValue({ id: "user-one", status: "active" });
        mocks.getPaymentConfig.mockResolvedValue({
            saved: { providers: {}, topUp: { pricingVersion: "top-up-v1", customerFxVersion: "fx-v1", usdPerVnd: "0.00004" } },
            providers: {},
            valuesByEnvName: {},
            topUp: { pricingVersion: "top-up-v1", customerFxVersion: "fx-v1", usdPerVnd: "0.00004" },
        });
        mocks.createOrder.mockImplementation(async (value) => value);
        mocks.lockCoupon.mockResolvedValue(true);
        mocks.releaseCoupon.mockResolvedValue(true);
        mocks.getOrderById.mockResolvedValue({ id: "order-one", userId: "user-one", provider: "payply", status: "pending" });
        mocks.expirePendingOrder.mockResolvedValue({ id: "order-one", userId: "user-one", provider: "payply", status: "canceled" });
    });

    it("releases the coupon bound to a canceled pending order in the same transaction", async () => {
        mocks.cancelOrder.mockResolvedValue({ ...(await createTopUpOrder({ userId: "user-one", customAmountVnd: "250000", provider: "payply" })), userCouponId: "coupon-one" });

        await cancelTopUpOrderForUser("user-one", "order-one");

        expect(mocks.releaseCoupon).toHaveBeenCalledWith("coupon-one", expect.any(String));
    });

    it("blocks local cancellation after a ZaloPay checkout has been created", async () => {
        mocks.getOrderById.mockResolvedValue({ id: "order-one", userId: "user-one", provider: "zalopay", providerOrderId: "260824_transaction", status: "pending" });

        await expect(cancelTopUpOrderForUser("user-one", "order-one")).rejects.toMatchObject({ status: 409 });
        expect(mocks.cancelOrder).not.toHaveBeenCalled();
    });

    it("does not auto-expire a pending ZaloPay order that exists at the provider", async () => {
        const order = { id: "order-one", userId: "user-one", provider: "zalopay", providerOrderId: "260824_transaction", status: "pending", expiresAt: "2020-01-01T00:00:00.000Z" };
        mocks.getOrderById.mockResolvedValue(order);

        expect(await getTopUpOrderForUser("user-one", "order-one")).toBe(order);
        expect(mocks.expirePendingOrder).not.toHaveBeenCalled();
    });

    it("rejects a fractional VND admin preset", async () => {
        await expect(saveTopUpPreset({ name: "Fractional", nominalNativeAmount: "250000.1" })).rejects.toThrow("整数");
    });

    it("loads persisted promotion and coupon rules while granting nominal credits", async () => {
        mocks.getPromotion.mockResolvedValue({ id: "promo-one", label: "活动", type: "percentage", value: "1000" });
        mocks.getCoupon.mockResolvedValue({ userCouponId: "coupon-one", templateId: "template-one", type: "fixed", value: "25000", currency: "VND" });

        const result = await createTopUpOrder({ userId: "user-one", customAmountVnd: "250000", provider: "payply", promotionId: "promo-one", userCouponId: "coupon-one" });

        expect(result).toMatchObject({ nominalNativeAmount: "250000", payableNativeAmount: "200000", nominalUsdValue: "10", paidUsdValue: "8", creditAmount: "10", promotionCampaignId: "promo-one", userCouponId: "coupon-one" });
        expect(mocks.lockCoupon).toHaveBeenCalledWith("coupon-one", result.id);
    });

    it("creates a server-authoritative custom VND order and ignores forged financial fields", async () => {
        const result = await createTopUpOrder({
            userId: "user-one",
            customAmountVnd: "250000",
            provider: "payply",
            creditAmount: "999999",
            payableNativeAmount: "1",
            customerFxRate: "99",
        } as never);

        expect(result).toMatchObject({
            userId: "user-one",
            nominalNativeAmount: "250000",
            payableNativeAmount: "250000",
            creditAmount: "10",
            customerFxRate: "0.00004",
            paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
        });
        expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({ creditAmount: "10", customerFxRate: "0.00004" }));
    });
});
