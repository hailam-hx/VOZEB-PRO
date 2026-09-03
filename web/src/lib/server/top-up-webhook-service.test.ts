import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    parse: vi.fn(),
    assertOrder: vi.fn(),
    getOrderById: vi.fn(),
    getOrderByOrderNo: vi.fn(),
    processTopUpPaymentEvent: vi.fn(),
    validateTopUpPaymentEventForOrder: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    isPostgresDatabaseEnabled: vi.fn(() => true),
    ensurePostgresSchema: vi.fn(async () => undefined),
    createPostgresRepositories: vi.fn(() => ({
        topUps: {
            getOrderById: mocks.getOrderById,
            getOrderByOrderNo: mocks.getOrderByOrderNo,
        },
    })),
}));
vi.mock("@/lib/server/payment-config-store", () => ({ getPaymentRuntimeConfig: vi.fn(async () => ({})) }));
vi.mock("./payment-webhook-adapters", () => ({
    normalizeProvider: vi.fn((provider: string) => provider),
    resolveWebhookAdapter: vi.fn(() => ({ parse: mocks.parse, assertOrder: mocks.assertOrder })),
}));
vi.mock("./top-up-payment", () => ({ processTopUpPaymentEvent: mocks.processTopUpPaymentEvent, validateTopUpPaymentEventForOrder: mocks.validateTopUpPaymentEventForOrder }));
vi.mock("./top-up-postgres-settlement", () => ({ PostgresTopUpPaymentStore: class {} }));

import { BillingInputError, PaymentWebhookProcessingError } from "./billing-errors";
import { processTopUpWebhook } from "./top-up-webhook-service";

describe("top-up webhook authentication boundary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.parse.mockReturnValue({
            eventId: "event-one",
            eventType: "payment.succeeded",
            orderId: "order-one",
            status: "succeeded",
            providerTradeId: "trade-one",
            providerPaymentId: "payment-one",
            amountMinor: "250000",
            currency: "VND",
            payload: {},
            signatureValid: true,
        });
        mocks.getOrderById.mockResolvedValue({ id: "order-one", orderNo: "VZ001", provider: "zalopay", currencyExponent: 0, status: "pending" });
        mocks.processTopUpPaymentEvent.mockResolvedValue({ applied: true, duplicate: false, creditAmount: "10" });
    });

    it("rejects an invalid signature before looking up an order", async () => {
        mocks.parse.mockReturnValue({ ...mocks.parse(), signatureValid: false });
        mocks.getOrderById.mockImplementation(async () => {
            throw new Error("order lookup must not run before webhook authentication");
        });

        await expect(processTopUpWebhook({ provider: "payply", rawBody: "{}", headers: new Headers() })).rejects.toThrow("支付回调签名无效");
    });

    it("runs provider-specific order validation before settlement", async () => {
        await processTopUpWebhook({ provider: "zalopay", rawBody: "{}", headers: new Headers() });

        expect(mocks.assertOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-one" }), expect.objectContaining({ id: "order-one" }));
        expect(mocks.assertOrder.mock.invocationCallOrder[0]).toBeLessThan(mocks.processTopUpPaymentEvent.mock.invocationCallOrder[0]);
    });

    it("marks a failure after authenticated order validation as retryable processing", async () => {
        mocks.processTopUpPaymentEvent.mockRejectedValue(new Error("database unavailable"));

        await expect(processTopUpWebhook({ provider: "zalopay", rawBody: "{}", headers: new Headers() })).rejects.toBeInstanceOf(PaymentWebhookProcessingError);
    });

    it("keeps authenticated payload validation failures non-retryable", async () => {
        mocks.validateTopUpPaymentEventForOrder.mockImplementationOnce(() => {
            throw new BillingInputError("amount mismatch", 409);
        });

        await expect(processTopUpWebhook({ provider: "zalopay", rawBody: "{}", headers: new Headers() })).rejects.toMatchObject({ message: "amount mismatch", status: 409 });
        expect(mocks.processTopUpPaymentEvent).not.toHaveBeenCalled();
    });
});
