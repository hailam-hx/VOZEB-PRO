import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string | URL, init?: RequestInit) => fetch(url, init) }));

import type { PaymentRuntimeConfig } from "./payment-config-store";
import { createProviderCheckout } from "./payment-checkout-providers";
import type { TopUpOrder } from "./top-up-payment";

const order: TopUpOrder = {
    id: "top-up-one", orderNo: "VZ-TOP-UP-1", userId: "user", status: "pending", paymentState: "pending", creditGrantState: "pending", providerRefundState: "none", creditRecoveryState: "none", subject: "充值", currency: "VND", currencyExponent: 0, nominalNativeAmount: "250000", promotionDiscountNativeAmount: "0", couponDiscountNativeAmount: "0", payableNativeAmount: "250000", nominalUsdValue: "10", paidUsdValue: "10", creditAmount: "10", pricingVersion: "top-up-v1", customerFxVersion: "fx-v1", customerFxRate: "0.00004", paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 }, provider: "stripe", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
};
const config: PaymentRuntimeConfig = { saved: { providers: {} }, providers: {}, valuesByEnvName: { VOZEB_PRO_STRIPE_SECRET_KEY: "sk_test_secret", VOZEB_PRO_STRIPE_API_BASE: "https://stripe.test" } };

describe("fiat top-up checkout provider", () => {
    it("sends the authoritative VND minor amount", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: "cs_1", url: "https://stripe.test/session" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await createProviderCheckout("stripe", order, { origin: "https://app.test" }, config);
        const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
        expect(body.get("line_items[0][price_data][unit_amount]")).toBe("250000");
        expect(body.get("line_items[0][price_data][currency]")).toBe("vnd");
    });
});
