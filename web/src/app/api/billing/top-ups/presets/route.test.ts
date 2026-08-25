import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listTopUpPresets: vi.fn(), getPaymentConfigSummary: vi.fn() }));

vi.mock("@/lib/server/top-up-commerce-service", () => ({ listTopUpPresets: mocks.listTopUpPresets }));
vi.mock("@/lib/server/payment-config-status", () => ({ getPaymentConfigSummary: mocks.getPaymentConfigSummary }));

import { GET } from "./route";

describe("GET /api/billing/top-ups/presets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listTopUpPresets.mockResolvedValue([{ id: "starter" }]);
        mocks.getPaymentConfigSummary.mockResolvedValue({
            providers: [
                { id: "stripe", enabled: true, checkoutReady: false },
                { id: "alipay", enabled: true, checkoutReady: true },
                { id: "wechat", enabled: false, checkoutReady: true },
                { id: "manual", enabled: true, checkoutReady: true },
            ],
        });
    });

    it("only exposes payment providers that can create checkout", async () => {
        const response = await GET();

        expect(await response.json()).toEqual({ code: 0, data: { presets: [{ id: "starter" }], paymentProviders: ["alipay", "manual"] }, msg: "" });
    });
});
