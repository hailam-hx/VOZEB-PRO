import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ processTopUpWebhook: vi.fn() }));

vi.mock("@/lib/server/top-up-webhook-service", () => ({ processTopUpWebhook: mocks.processTopUpWebhook }));

import { BillingInputError, PaymentWebhookProcessingError } from "@/lib/server/billing-errors";
import { POST } from "./route";

describe("payment webhook response contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.processTopUpWebhook.mockResolvedValue({ received: true, duplicate: false });
    });

    it("returns the provider-specific success acknowledgement for ZaloPay", async () => {
        const response = await invoke("zalopay");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ return_code: 1, return_message: "success" });
    });

    it.each([
        [new BillingInputError("bad mac", 401), { return_code: 2, return_message: "invalid" }],
        [new PaymentWebhookProcessingError(), { return_code: 0, return_message: "retry" }],
        [new BillingInputError("database unavailable", 503), { return_code: 0, return_message: "retry" }],
        [new Error("unexpected"), { return_code: 0, return_message: "retry" }],
    ])("maps ZaloPay failures without exposing internal details", async (error, expected) => {
        mocks.processTopUpWebhook.mockRejectedValue(error);

        const response = await invoke("zalopay");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(expected);
    });

    it.each(["zalo-pay", "zalo_pay"])("uses the ZaloPay acknowledgement for the %s alias", async (provider) => {
        const response = await invoke(provider);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ return_code: 1, return_message: "success" });
    });

    it("preserves the common response envelope for existing providers", async () => {
        mocks.processTopUpWebhook.mockRejectedValue(new BillingInputError("invalid signature", 401));

        const response = await invoke("stripe");

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ code: 401, data: null, msg: "invalid signature" });
    });
});

function invoke(provider: string) {
    return POST(new Request(`http://localhost/api/billing/webhooks/${provider}`, { method: "POST", body: "{}" }), { params: Promise.resolve({ provider }) });
}
