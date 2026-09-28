import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PRICING_POLICY, normalizeSystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { buildDflopPricingAuditSummary, buildDflopPricingSync } from "./dflop-pricing-sync-service";

const syncedAt = "2026-09-24T02:00:00.000Z";

describe("DFLOP pricing sync", () => {
    it("enriches only the key-visible canonical subset and applies the official currency ratio", () => {
        const result = buildDflopPricingSync({
            visibleModelIds: ["Model-A", "model-a", "video-b", "registry-missing"],
            publicPayload: {
                models: [
                    { id: "model-a", category: "text", input_per_1m: "60" },
                    { id: "video-b", category: "video", price_per_video_second: "90.72", video_price_tiers: { "720p": "90.72" } },
                    { id: "public-only", category: "image", price_per_image: "12" },
                    { id: "model-a", category: "text", input_per_1m: "999" },
                ],
            },
            currencyPayload: { unit: "points", points_per_cny: 60, usd_to_cny_peg: 6.74, points_per_usd: 404.4 },
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: {},
            syncedAt,
        });

        expect(Object.keys(result.profiles).sort()).toEqual(["model-a", "video-b"]);
        expect(result.profiles["model-a"]?.dimensions[0]).toMatchObject({ effectiveValue: "60", upstreamValue: "60" });
        expect(result.pricingPolicyPatch).toMatchObject({ dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", dflopCurrencyConfigVersion: expect.stringMatching(/^dflop-currency-v1:/) });
        expect(result.stats).toMatchObject({ models: 3, pricingProfiles: 2, created: 2, updated: 0, unchanged: 0, missingPricing: 1, unknownPricingFields: 0 });
    });

    it("preserves a manual currency policy and reports unknown pricing fields", () => {
        const currentPolicy = normalizeSystemPricingPolicy({ dflopCreditsPerCny: "75", dflopCreditsPerCnySource: "manual" });
        const result = buildDflopPricingSync({
            visibleModelIds: ["future"],
            publicPayload: { models: [{ id: "future", price_per_image: "1", price_per_future_unit: "2" }] },
            currencyPayload: { unit: "points", points_per_cny: 60 },
            currentPolicy,
            currentProfiles: {},
            syncedAt,
        });

        expect(result.pricingPolicyPatch).toBeUndefined();
        expect(result.stats.unknownPricingFields).toBe(1);
        expect(result.profiles.future?.status).toBe("PARTIAL");
    });

    it("keeps discovery usable when public or currency metadata is unavailable", () => {
        const noPublic = buildDflopPricingSync({ visibleModelIds: ["visible"], publicPayload: undefined, currencyPayload: { unit: "points", points_per_cny: 60 }, currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY, currentProfiles: {}, syncedAt });
        expect(noPublic.profiles).toEqual({});
        expect(noPublic.stats).toMatchObject({ models: 1, pricingProfiles: 0, missingPricing: 1 });
        expect(noPublic.warnings.map((warning) => warning.code)).toContain("PUBLIC_REGISTRY_UNAVAILABLE");

        const noCurrency = buildDflopPricingSync({
            visibleModelIds: ["visible"],
            publicPayload: { models: [{ id: "visible", price_per_image: "1" }] },
            currencyPayload: undefined,
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: {},
            syncedAt,
        });
        expect(noCurrency.profiles.visible).toBeTruthy();
        expect(noCurrency.pricingPolicyPatch).toBeUndefined();
        expect(noCurrency.warnings.map((warning) => warning.code)).toContain("CURRENCY_UNAVAILABLE");
    });

    it("derives changed and manual-override statistics from current profiles", () => {
        const previous = buildDflopPricingSync({
            visibleModelIds: ["image"],
            publicPayload: { models: [{ id: "image", price_per_image: "2" }] },
            currencyPayload: undefined,
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: {},
            syncedAt: "2026-09-23T00:00:00.000Z",
        }).profiles.image!;
        previous.dimensions[0] = { ...previous.dimensions[0], source: "manual", effectiveValue: "3" };
        const next = buildDflopPricingSync({
            visibleModelIds: ["image"],
            publicPayload: { models: [{ id: "image", price_per_image: "2.5" }] },
            currencyPayload: undefined,
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: { image: previous },
            syncedAt,
        });

        expect(next.stats).toMatchObject({ created: 0, updated: 1, unchanged: 0, priceIncreases: 1, priceDecreases: 0, manualOverridesPreserved: 1 });
    });

    it("counts increases, decreases, unchanged, missing, unknown, manual, and below-cost diagnostics from actual values", () => {
        const previous = buildDflopPricingSync({
            visibleModelIds: ["video"],
            publicPayload: { models: [{ id: "video", category: "video", video_price_tiers: { "480p": "40", "720p": "90", "1080p": "120" } }] },
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: {},
            syncedAt: "2026-09-23T00:00:00.000Z",
        }).profiles.video!;
        previous.dimensions[0] = { ...previous.dimensions[0], source: "manual", effectiveValue: "41" };
        const next = buildDflopPricingSync({
            visibleModelIds: ["video", "missing"],
            publicPayload: { models: [{ id: "video", category: "video", video_price_tiers: { "480p": "40", "720p": "100", "1080p": "110" }, price_per_future: "1" }] },
            currentPolicy: { ...DEFAULT_SYSTEM_PRICING_POLICY, markupMultiplier: "0.9" },
            currentProfiles: { video: previous },
            syncedAt,
            belowCostWarnings: 2,
        });

        expect(next.stats).toMatchObject({ priceIncreases: 1, priceDecreases: 1, unchangedDimensions: 1, missingPricing: 1, unknownPricingFields: 1, manualOverridesPreserved: 1, belowCostWarnings: 2 });
    });

    it("builds bounded, secret-free audit metadata from saved profile changes", () => {
        const beforeProfile = buildDflopPricingSync({
            visibleModelIds: ["image"],
            publicPayload: { models: [{ id: "image", price_per_image: "80" }] },
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: {},
            syncedAt: "2026-09-23T00:00:00.000Z",
        }).profiles.image!;
        const afterProfile = buildDflopPricingSync({
            visibleModelIds: ["image"],
            publicPayload: { models: [{ id: "image", price_per_image: "100", price_per_future: "1", api_key: "secret" }] },
            currentPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            currentProfiles: { image: beforeProfile },
            syncedAt,
        }).profiles.image!;
        const model = (profile: typeof beforeProfile) => ({
            id: "image",
            name: "Image",
            capability: "image" as const,
            enabled: true,
            bindings: [{ id: "binding", channelId: "dflop", upstreamModel: "image", enabled: true, priority: 1, providerPricingProfile: profile }],
        });
        const metadata = buildDflopPricingAuditSummary([model(beforeProfile)], [model(afterProfile)], [], DEFAULT_SYSTEM_PRICING_POLICY);

        expect(metadata).toMatchObject({ priceIncreases: 1, priceDecreases: 0, unknownPricingFields: 1, changes: [{ modelId: "image", bindingId: "binding", dimensionId: "image-output", oldValue: "80", newValue: "100" }] });
        expect(JSON.stringify(metadata)).not.toContain("secret");
        expect(JSON.stringify(metadata)).not.toContain("api_key");
    });
});
