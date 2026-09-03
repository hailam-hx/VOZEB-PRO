import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getOrderById: vi.fn(),
    getPaymentRuntimeConfig: vi.fn(),
    queryZaloPayOrder: vi.fn(),
    processTopUpPaymentEvent: vi.fn(),
    expirePendingOrder: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(async () => undefined),
    isPostgresDatabaseEnabled: vi.fn(() => true),
    createPostgresRepositories: vi.fn(() => ({ topUps: { getOrderById: mocks.getOrderById, expirePendingOrder: mocks.expirePendingOrder } })),
}));
vi.mock("@/lib/server/payment-config-store", () => ({
    getPaymentRuntimeConfig: mocks.getPaymentRuntimeConfig,
    isPaymentRuntimeProviderCheckoutReady: vi.fn(() => true),
}));
vi.mock("./zalopay-payment-provider", () => ({ queryZaloPayOrder: mocks.queryZaloPayOrder }));
vi.mock("./top-up-payment", () => ({ processTopUpPaymentEvent: mocks.processTopUpPaymentEvent }));
vi.mock("./top-up-postgres-settlement", () => ({ PostgresTopUpPaymentStore: class {} }));

import { syncTopUpOrderForUser } from "./top-up-payment-sync-service";

const pendingOrder = {
    id: "order-one",
    orderNo: "VZ001",
    userId: "user-one",
    provider: "zalopay",
    providerOrderId: "260824_0123456789abcdef0123456789abcdef",
    status: "pending",
    currencyExponent: 0,
};

describe("top-up payment sync service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPaymentRuntimeConfig.mockResolvedValue({ saved: { providers: {} }, providers: {}, valuesByEnvName: {} });
        mocks.getOrderById.mockResolvedValue(pendingOrder);
        mocks.queryZaloPayOrder.mockResolvedValue({ status: "pending", providerOrderId: pendingOrder.providerOrderId, payload: { return_code: 3, is_processing: true } });
        mocks.processTopUpPaymentEvent.mockResolvedValue({ applied: true });
        mocks.expirePendingOrder.mockResolvedValue({ ...pendingOrder, status: "canceled" });
    });

    it("does not query a final order", async () => {
        mocks.getOrderById.mockResolvedValue({ ...pendingOrder, status: "paid" });

        const result = await syncTopUpOrderForUser("user-one", "order-one");

        expect(result.syncStatus).toBe("already_final");
        expect(mocks.queryZaloPayOrder).not.toHaveBeenCalled();
    });

    it("keeps an unpaid provider response pending without settlement", async () => {
        const result = await syncTopUpOrderForUser("user-one", "order-one");

        expect(result).toEqual({ order: pendingOrder, syncStatus: "pending" });
        expect(mocks.processTopUpPaymentEvent).not.toHaveBeenCalled();
    });

    it("closes and releases a provider-confirmed expired order without settlement", async () => {
        const expired = { ...pendingOrder, status: "canceled" };
        mocks.queryZaloPayOrder.mockResolvedValue({ status: "expired", providerOrderId: pendingOrder.providerOrderId, payload: { return_code: 2, sub_return_code: -54 } });
        mocks.expirePendingOrder.mockResolvedValue(expired);

        const result = await syncTopUpOrderForUser("user-one", "order-one");

        expect(mocks.expirePendingOrder).toHaveBeenCalledWith("order-one", expect.any(String));
        expect(mocks.processTopUpPaymentEvent).not.toHaveBeenCalled();
        expect(result).toEqual({ order: expired, syncStatus: "already_final" });
    });

    it("reloads the order when provider-confirmed expiry loses a settlement race", async () => {
        const paid = { ...pendingOrder, status: "paid", providerPaymentId: "240824000000001" };
        mocks.getOrderById.mockResolvedValueOnce(pendingOrder).mockResolvedValueOnce(paid);
        mocks.queryZaloPayOrder.mockResolvedValue({ status: "expired", providerOrderId: pendingOrder.providerOrderId, payload: { return_code: 2, sub_return_code: -54 } });
        mocks.expirePendingOrder.mockResolvedValue(null);

        await expect(syncTopUpOrderForUser("user-one", "order-one")).resolves.toEqual({ order: paid, syncStatus: "already_final" });
    });

    it("normalizes a paid query into the shared settlement event", async () => {
        const paidOrder = { ...pendingOrder, status: "paid", providerPaymentId: "240824000000001" };
        mocks.getOrderById.mockResolvedValueOnce(pendingOrder).mockResolvedValueOnce(paidOrder);
        mocks.queryZaloPayOrder.mockResolvedValue({ status: "paid", providerOrderId: pendingOrder.providerOrderId, providerPaymentId: "240824000000001", amountMinor: "250000", paidAt: "2026-08-24T10:00:00.000Z", payload: { return_code: 1 } });

        const result = await syncTopUpOrderForUser("user-one", "order-one");

        expect(mocks.processTopUpPaymentEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                signatureValid: true,
                provider: "zalopay",
                eventId: "240824000000001",
                eventType: "zalopay.payment.succeeded",
                orderId: "order-one",
                orderNo: "VZ001",
                providerOrderId: pendingOrder.providerOrderId,
                providerPaymentId: "240824000000001",
                amount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
            }),
            expect.anything(),
        );
        expect(result).toEqual({ order: paidOrder, syncStatus: "paid" });
    });

    it("rejects an order owned by another user before querying ZaloPay", async () => {
        mocks.getOrderById.mockResolvedValue({ ...pendingOrder, userId: "other-user" });

        await expect(syncTopUpOrderForUser("user-one", "order-one")).rejects.toMatchObject({ status: 404 });
        expect(mocks.queryZaloPayOrder).not.toHaveBeenCalled();
    });
});
