import { describe, expect, it } from "vitest";

import type { LogicalModel, LogicalModelBinding, SystemModelChannel } from "@/lib/auth/store-types";
import { normalizeSystemPricingPolicy } from "./pricing-policy";
import { applySuggestedPricingToLogicalModels, calculateSuggestedSaleRateCard } from "./suggested-model-pricing";

const rateCard = (price720: string, price1080?: string) => ({
    version: 1 as const,
    revision: `cost-${price720}-${price1080 || ""}`,
    components: [
        { id: "video-720", dimension: "durationSeconds" as const, unitPrice: price720, per: "1", when: { resolution: "720p" } },
        ...(price1080 ? [{ id: "video-1080", dimension: "durationSeconds" as const, unitPrice: price1080, per: "1", when: { resolution: "1080p" } }] : []),
    ],
});

const binding = (id: string, channelId: string, price720: string, enabled = true, price1080?: string): LogicalModelBinding => ({
    id,
    channelId,
    upstreamModel: "video-model",
    enabled,
    priority: Number(id.replace(/\D/g, "")) || 1,
    costRateCard: rateCard(price720, price1080),
    providerCostUnit: { kind: "fiat", currency: "USD" },
    providerPricingProfile: {
        provider: "dflop",
        modelId: "video-model",
        status: "READY",
        syncedAt: "2026-09-24T00:00:00.000Z",
        raw: {},
        dimensions: [],
        unknownFields: [],
        missingFields: [],
        warnings: [],
        conversion: { pricingPolicyVersion: "policy", dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", hotxUsdPerCredit: "1", calculatedAt: "2026-09-24T00:00:00.000Z" },
    },
});

const channel = (id: string, enabled = true): SystemModelChannel => ({ id, name: id, baseUrl: `https://${id}.example.com/v1`, apiKey: "secret", apiFormat: "openai", models: ["video-model"], enabled });
const model = (bindings: LogicalModelBinding[]): LogicalModel => ({ id: "video", name: "Video", capability: "video", enabled: true, bindings });
const calculatedAt = "2026-09-24T01:00:00.000Z";

describe("suggested model pricing", () => {
    it("uses the maximum comparable active binding cost and ignores disabled bindings", () => {
        const policy = normalizeSystemPricingPolicy({ costBasis: "max_active_binding_cost", markupMultiplier: "1" });
        const result = calculateSuggestedSaleRateCard({
            model: model([binding("b1", "one", "0.2268"), binding("b2", "two", "0.25"), binding("b3", "three", "0.8", false)]),
            channels: [channel("one"), channel("two"), channel("three")],
            policy,
            calculatedAt,
        });

        expect(result.complete).toBe(true);
        expect(result.suggestion?.rateCard.components).toEqual([expect.objectContaining({ unitPrice: "0.25", when: { resolution: "720p" } })]);
        expect(result.suggestion?.bindingInputs.map((item) => item.bindingId)).toEqual(["b1", "b2"]);
        expect(result.suggestion).toMatchObject({ costBasis: "max_active_binding_cost", markupMultiplier: "1", pricingPolicyVersion: policy.version, calculatedAt });
    });

    it("selects the maximum independently per canonical dimension", () => {
        const result = calculateSuggestedSaleRateCard({
            model: model([binding("b1", "one", "0.3", true, "0.4"), binding("b2", "two", "0.2", true, "0.5")]),
            channels: [channel("one"), channel("two")],
            policy: normalizeSystemPricingPolicy({ markupMultiplier: "1.2" }),
            calculatedAt,
        });
        expect(result.suggestion?.rateCard.components).toEqual(expect.arrayContaining([expect.objectContaining({ unitPrice: "0.36", when: { resolution: "720p" } }), expect.objectContaining({ unitPrice: "0.6", when: { resolution: "1080p" } })]));
    });

    it("marks missing or condition-mismatched binding dimensions incomplete instead of treating them as zero", () => {
        const first = binding("b1", "one", "0.2");
        const second = binding("b2", "two", "0.3");
        second.costRateCard = { version: 1, components: [{ id: "square", dimension: "durationSeconds", unitPrice: "0.3", per: "1", when: { resolution: "1080p" } }] };
        const result = calculateSuggestedSaleRateCard({ model: model([first, second]), channels: [channel("one"), channel("two")], policy: normalizeSystemPricingPolicy({}), calculatedAt });

        expect(result.complete).toBe(false);
        expect(result.warnings.map((warning) => warning.code)).toContain("INCOMPLETE_DIMENSION");
    });

    it("supports the primary binding strategy", () => {
        const policy = normalizeSystemPricingPolicy({ costBasis: "primary_binding_cost" });
        const result = calculateSuggestedSaleRateCard({ model: model([binding("b1", "one", "0.2"), binding("b2", "two", "0.5")]), channels: [channel("one"), channel("two")], policy, calculatedAt });
        expect(result.suggestion?.rateCard.components[0].unitPrice).toBe("0.2");
    });

    it("reports below-cost and margin warnings without auto-applying formal sale prices", () => {
        const priced = { ...model([binding("b1", "one", "0.25")]), saleRateCard: rateCard("0.2") };
        const policy = normalizeSystemPricingPolicy({ autoApplySalePrice: true, markupMultiplier: "1", minimumMarginRate: null });
        const result = calculateSuggestedSaleRateCard({ model: priced, channels: [channel("one")], policy, calculatedAt });
        expect(result.warnings.map((warning) => warning.code)).toContain("BELOW_COST");
        expect(applySuggestedPricingToLogicalModels([priced], [channel("one")], policy, calculatedAt)[0].saleRateCard?.components[0].unitPrice).toBe("0.2");

        const commercial = normalizeSystemPricingPolicy({ autoApplySalePrice: true, markupMultiplier: "1.5", minimumMarginRate: "0.2" });
        const applied = applySuggestedPricingToLogicalModels([model([binding("b1", "one", "0.25")])], [channel("one")], commercial, calculatedAt)[0];
        expect(applied.suggestedSaleRateCard?.rateCard.components[0].unitPrice).toBe("0.375");
        expect(applied.saleRateCard).toBeUndefined();

        const belowCost = normalizeSystemPricingPolicy({ autoApplySalePrice: true, markupMultiplier: "0.9", minimumMarginRate: "0.1" });
        const blocked = applySuggestedPricingToLogicalModels([model([binding("b1", "one", "0.25")])], [channel("one")], belowCost, calculatedAt)[0];
        expect(blocked.suggestedSaleRateCard?.rateCard.components[0].unitPrice).toBe("0.225");
        expect(blocked.saleRateCard).toBeUndefined();
    });

    it("never overwrites an administrator-approved formal sale price", () => {
        const approved = {
            ...model([binding("b1", "one", "0.25")]),
            saleRateCard: rateCard("0.4"),
            salePriceSource: "approved" as const,
            salePriceApproval: {
                suggestedRevision: "approved-revision",
                pricingPolicyVersion: "approved-policy",
                calculatedAt,
                costBasis: "max_active_binding_cost" as const,
                markupMultiplier: "1.5",
                approvedAt: calculatedAt,
                approvedBy: "admin-1",
            },
        };
        const policy = normalizeSystemPricingPolicy({ autoApplySalePrice: true, markupMultiplier: "2", minimumMarginRate: "0.2" });

        const updated = applySuggestedPricingToLogicalModels([approved], [channel("one")], policy, "2026-09-24T02:00:00.000Z")[0];

        expect(updated.saleRateCard?.components[0].unitPrice).toBe("0.4");
        expect(updated.salePriceSource).toBe("approved");
        expect(updated.suggestedSaleRateCard?.rateCard.components[0].unitPrice).toBe("0.5");
    });
});
