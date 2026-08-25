import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    parse: vi.fn(() => ({
        eventId: "event-forged",
        eventType: "payment.succeeded",
        orderId: "order-one",
        status: "succeeded" as const,
        amountMinor: "250000",
        currency: "VND",
        payload: {},
        signatureValid: false,
    })),
}));

vi.mock("@/lib/server/database", () => ({
    isPostgresDatabaseEnabled: vi.fn(() => true),
    ensurePostgresSchema: vi.fn(async () => undefined),
    createPostgresRepositories: vi.fn(() => ({
        topUps: {
            getOrderById: vi.fn(async () => {
                throw new Error("order lookup must not run before webhook authentication");
            }),
            getOrderByOrderNo: vi.fn(async () => {
                throw new Error("order lookup must not run before webhook authentication");
            }),
        },
    })),
}));
vi.mock("@/lib/server/payment-config-store", () => ({ getPaymentRuntimeConfig: vi.fn(async () => ({})) }));
vi.mock("./payment-webhook-adapters", () => ({
    normalizeProvider: vi.fn((provider: string) => provider),
    resolveWebhookAdapter: vi.fn(() => ({ parse: mocks.parse })),
}));
vi.mock("./top-up-payment", () => ({ processTopUpPaymentEvent: vi.fn() }));
vi.mock("./top-up-postgres-settlement", () => ({ PostgresTopUpPaymentStore: class {} }));

import { processTopUpWebhook } from "./top-up-webhook-service";

describe("top-up webhook authentication boundary", () => {
    it("rejects an invalid signature before looking up an order", async () => {
        await expect(processTopUpWebhook({ provider: "payply", rawBody: "{}", headers: new Headers() })).rejects.toThrow("支付回调签名无效");
    });
});
