import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchSafeOutbound: vi.fn(), isSafeOutboundUrl: vi.fn() }));

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: mocks.fetchSafeOutbound }));
vi.mock("@/lib/server/security", () => ({ isSafeOutboundUrl: mocks.isSafeOutboundUrl }));

import { DEFAULT_SYSTEM_PRICING_POLICY, normalizeSystemPricingPolicy } from "@/lib/billing/pricing-policy";
import type { SystemModelChannel } from "@/lib/auth/store";
import { verifyDflopPricingPolicyDraft } from "./dflop-currency-policy-service";

const channel = {
    id: "dflop",
    name: "DFLOP",
    baseUrl: "https://api.dflop.top/v1",
    apiKey: "secret",
    apiFormat: "openai" as const,
    models: [],
    enabled: true,
    advancedConfig: { protocol: "dflop" as const } as SystemModelChannel["advancedConfig"],
};

describe("DFLOP currency policy draft verification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isSafeOutboundUrl.mockResolvedValue(true);
    });

    it("accepts a server-verified upstream ratio and preserves editable policy fields", async () => {
        mocks.fetchSafeOutbound.mockResolvedValue(new Response(JSON.stringify({ unit: "points", points_per_cny: 75 }), { status: 200 }));
        const requested = normalizeSystemPricingPolicy({
            ...DEFAULT_SYSTEM_PRICING_POLICY,
            dflopCreditsPerCny: "75",
            dflopCreditsPerCnySource: "upstream",
            dflopCurrencyConfigVersion: 'dflop-currency-v1:{"points_per_cny":75,"unit":"points"}',
            cnyToUsd: "0.16",
        });

        const result = await verifyDflopPricingPolicyDraft(DEFAULT_SYSTEM_PRICING_POLICY, requested, [channel]);

        expect(result).toEqual(requested);
        expect(mocks.fetchSafeOutbound).toHaveBeenCalledWith("https://api.dflop.top/api/v1/config/currency", expect.objectContaining({ cache: "no-store" }));
    });

    it("rejects a forged ratio and keeps editable-only updates independent from upstream access", async () => {
        mocks.fetchSafeOutbound.mockResolvedValue(new Response(JSON.stringify({ unit: "points", points_per_cny: 60 }), { status: 200 }));
        await expect(verifyDflopPricingPolicyDraft(DEFAULT_SYSTEM_PRICING_POLICY, { dflopCreditsPerCny: "1", dflopCreditsPerCnySource: "upstream" }, [channel])).rejects.toThrow("不允许由客户端修改");

        const editable = await verifyDflopPricingPolicyDraft(DEFAULT_SYSTEM_PRICING_POLICY, { cnyToUsd: "0.16" }, [channel]);
        expect(editable.cnyToUsd).toBe("0.16");
        expect(mocks.fetchSafeOutbound).toHaveBeenCalledTimes(1);
    });
});
