import { describe, expect, it } from "vitest";

import type { VideoValidationNormalizedContext } from "@/lib/video-validation";
import { estimateValidationCost, estimateVideoValidationProviderCost, selectLowestCostCanaries } from "./video-validation-cost";

const context: VideoValidationNormalizedContext = { count: "1", durationSeconds: "5", resolution: "720p", aspectRatio: "16:9", generateAudio: false, watermark: false, references: [] };

describe("video validation provider cost", () => {
    it("calculates exact Decimal provider cost", () => {
        expect(
            estimateVideoValidationProviderCost({
                rateCard: { version: 1, components: [{ id: "720", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.2268", when: { resolution: "720p" } }] },
                context,
            }),
        ).toEqual({ ok: true, costHotxCredits: "1.134" });
    });

    it("returns COST_NOT_ESTIMATABLE for an unmatched pricing dimension", () => {
        expect(
            estimateVideoValidationProviderCost({
                rateCard: { version: 1, components: [{ id: "1080", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.56133", when: { resolution: "1080p" } }] },
                context,
            }),
        ).toEqual({ ok: false, reasonCode: "COST_NOT_ESTIMATABLE" });
    });

    it("selects one stable lowest-cost canary per family and case", () => {
        const candidates = [
            { family: "seedance", caseId: "text", bindingId: "b", estimatedCost: "0.56133" },
            { family: "seedance", caseId: "text", bindingId: "a", estimatedCost: "0.2268" },
            { family: "seedance", caseId: "first-last", bindingId: "c", estimatedCost: "0.56133" },
            { family: "kling", caseId: "text", bindingId: "z", estimatedCost: "0.2268" },
        ];
        expect(selectLowestCostCanaries(candidates)).toEqual([candidates[1], candidates[2], candidates[3]]);
    });

    it("proves a fixed-duration second-based maximum and rounds the reserve upward", () => {
        expect(estimateValidationCost({ rateCard: { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.000000001" }] }, context })).toMatchObject({ ok: true, estimatedCredits: "0.00000001" });
    });

    it("rejects token billing without a proven maximum before any live submit", () => {
        expect(estimateValidationCost({ rateCard: { version: 1, components: [{ id: "tokens", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "6.9", per: "1000000", when: { billingBasis: "default" } }] }, context })).toEqual({
            ok: false,
            reasonCode: "BUDGET_BOUND_UNAVAILABLE",
        });
    });

    it("rejects a second-only card when the upstream profile also bills variable video tokens", () => {
        expect(
            estimateValidationCost({
                rateCard: { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.2" }] },
                context,
                providerPricingProfile: {
                    provider: "dflop",
                    modelId: "seedance",
                    status: "READY",
                    syncedAt: "2026-09-26T00:00:00Z",
                    raw: {},
                    dimensions: [{ id: "token", kind: "VIDEO_TOKEN", unit: "dflop_credit/1m_tokens", source: "upstream", effectiveValue: "5", syncedAt: "2026-09-26T00:00:00Z" }],
                    unknownFields: [],
                    missingFields: [],
                    warnings: [],
                },
            }),
        ).toEqual({ ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" });
    });

    it("does not require terminal actual-cost support to admit a proven bound", () => {
        expect(estimateValidationCost({ rateCard: { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.2" }] }, context, actualCostCapability: "UNAVAILABLE" })).toMatchObject({
            ok: true,
            estimatedCredits: "1",
            actualCostCapability: "UNAVAILABLE",
        });
    });

    it("keeps DFLOP raw credits separate from normalized HOTX credits", () => {
        const result = estimateValidationCost({
            rateCard: { version: 1, components: [{ id: "video-second", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.015" }] },
            context,
            providerPricingProfile: {
                provider: "dflop",
                modelId: "fixture",
                status: "READY",
                syncedAt: "2026-09-26T00:00:00Z",
                raw: {},
                dimensions: [{ id: "video-second", kind: "VIDEO_SECOND", unit: "dflop_credit/second", source: "upstream", upstreamValue: "6", effectiveValue: "6", syncedAt: "2026-09-26T00:00:00Z" }],
                unknownFields: [],
                missingFields: [],
                warnings: [],
            },
        });
        expect(result).toMatchObject({ ok: true, estimatedProviderCost: { amount: "30", currency: "DFLOP_CREDITS", unit: "task" }, estimatedCredits: "0.075" });
    });

    it("bounds an upstream per-task charge independently of video duration", () => {
        const result = estimateValidationCost({
            rateCard: { version: 1, components: [{ id: "per-call", dimension: "request", basis: "PER_CALL", unitPrice: "0.12" }] },
            context,
            providerPricingProfile: {
                provider: "dflop",
                modelId: "clip-compose",
                status: "READY",
                syncedAt: "2026-09-26T00:00:00Z",
                raw: { price_per_video_task: "48" },
                dimensions: [{ id: "per-call", kind: "PER_CALL", key: "price_per_video_task", unit: "dflop_credit/task", source: "upstream", upstreamValue: "48", effectiveValue: "48", syncedAt: "2026-09-26T00:00:00Z" }],
                unknownFields: [],
                missingFields: [],
                warnings: [],
            },
        });
        expect(result).toMatchObject({ ok: true, estimatedProviderCost: { amount: "48", currency: "DFLOP_CREDITS" }, estimatedCredits: "0.12" });
    });

    it("does not claim a hard maximum when provider raw cost cannot be reconciled to the card", () => {
        expect(
            estimateValidationCost({
                rateCard: { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.2" }] },
                context,
                providerPricingProfile: {
                    provider: "dflop",
                    modelId: "fixture",
                    status: "READY",
                    syncedAt: "2026-09-26T00:00:00Z",
                    raw: {},
                    dimensions: [{ id: "other", kind: "VIDEO_SECOND", unit: "dflop_credit/second", source: "upstream", upstreamValue: "80", effectiveValue: "80", syncedAt: "2026-09-26T00:00:00Z" }],
                    unknownFields: [],
                    missingFields: [],
                    warnings: [],
                },
            }),
        ).toEqual({ ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" });
    });

    it("rejects a card priced below the converted upstream dimension", () => {
        expect(
            estimateValidationCost({
                rateCard: { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.1" }] },
                context,
                providerPricingProfile: {
                    provider: "dflop",
                    modelId: "fixture",
                    status: "READY",
                    syncedAt: "2026-09-26T00:00:00Z",
                    raw: {},
                    dimensions: [{ id: "seconds", kind: "VIDEO_SECOND", unit: "dflop_credit/second", source: "upstream", upstreamValue: "80", effectiveValue: "80", providerCostHotxCredits: "0.2", syncedAt: "2026-09-26T00:00:00Z" }],
                    unknownFields: [],
                    missingFields: [],
                    warnings: [],
                },
            }),
        ).toEqual({ ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" });
    });

    it("reserves the maximum Seedance token bill using the largest declared frame", () => {
        const result = estimateValidationCost({
            rateCard: { version: 1, components: [{ id: "video-token:billingbasis=default,resolution=720p", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "10.5", per: "1000000", when: { billingBasis: "default", resolution: "720p" } }] },
            context,
            seedanceModelFamily: "seedance-2.0",
            aspectRatios: ["16:9", "21:9"],
            providerPricingProfile: {
                provider: "dflop",
                modelId: "doubao-seedance-2.0",
                status: "READY",
                syncedAt: "2026-09-26T00:00:00Z",
                raw: {},
                unknownFields: [],
                missingFields: [],
                warnings: [],
                conversion: { dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", hotxUsdPerCredit: "1", calculatedAt: "2026-09-26T00:00:00Z", pricingPolicyVersion: "test" },
                dimensions: [
                    {
                        id: "video-token:billingbasis=default,resolution=720p",
                        kind: "VIDEO_TOKEN",
                        unit: "dflop_credit/1m_tokens",
                        source: "upstream",
                        upstreamValue: "4200",
                        effectiveValue: "4200",
                        providerCostHotxCredits: "10.5",
                        syncedAt: "2026-09-26T00:00:00Z",
                    },
                ],
            },
        });
        expect(result).toMatchObject({ ok: true, estimatedProviderCost: { amount: "595.35", currency: "DFLOP_CREDITS" }, estimatedCredits: "1.488375", boundEvidence: { source: "SEEDANCE_TOKEN_CEILING" } });
    });

    it("uses the upstream generic rate as a ceiling when a resolution tier was edited manually", () => {
        const result = estimateValidationCost({
            rateCard: { version: 1, components: [{ id: "video-second:resolution=720p", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.13143", when: { resolution: "720p" } }] },
            context,
            providerPricingProfile: {
                provider: "dflop",
                modelId: "happyhorse-1.0-t2v",
                status: "READY",
                syncedAt: "2026-09-26T00:00:00Z",
                raw: { price_per_video_second: "88.968", video_price_tiers: { "720p": "52.572", "1080p": "88.968" } },
                unknownFields: [],
                missingFields: [],
                warnings: [],
                conversion: { dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", hotxUsdPerCredit: "1", calculatedAt: "2026-09-26T00:00:00Z", pricingPolicyVersion: "test" },
                dimensions: [
                    { id: "video-second:resolution=720p", kind: "VIDEO_SECOND", unit: "dflop_credit/second", source: "manual", upstreamValue: "52.572", effectiveValue: "52.572", providerCostHotxCredits: "0.13143", syncedAt: "2026-09-26T00:00:00Z" },
                    { id: "video-second", kind: "VIDEO_SECOND", unit: "dflop_credit/second", source: "upstream", upstreamValue: "88.968", effectiveValue: "88.968", providerCostHotxCredits: "0.22242", syncedAt: "2026-09-26T00:00:00Z" },
                ],
            },
        });
        expect(result).toMatchObject({ ok: true, estimatedProviderCost: { amount: "444.84", currency: "DFLOP_CREDITS" }, estimatedCredits: "1.1121", boundEvidence: { source: "UPSTREAM_GENERIC_CEILING" } });
    });
});
