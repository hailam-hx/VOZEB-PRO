import { describe, expect, it } from "vitest";

import {
    adminTopUpOrderActions,
    adminTopUpProviderLabel,
    buildSuggestedSalePriceDiff,
    formatPricingRateCardForAdmin,
    formatProviderCostUnitForAdmin,
    matchesPricingModelSearch,
    providerCapabilityProbeSummary,
    providerPricingExecutionSummary,
    providerPricingStatusReasons,
    resolveFormValidation,
} from "./billing-operations";

describe("admin pricing model search", () => {
    const model = { id: "gpt-5.6-sol", name: "GPT Sol", bindings: [{ upstreamModel: "models/GPT-5.6-SOL" }] };

    it("matches name, logical ID and upstream model without case sensitivity", () => {
        expect(matchesPricingModelSearch(model, " gPt sOl ")).toBe(true);
        expect(matchesPricingModelSearch(model, "GPT-5.6-SOL")).toBe(true);
        expect(matchesPricingModelSearch(model, "models/gpt-5.6-sol")).toBe(true);
    });

    it("keeps all models visible for a blank search and excludes unrelated models", () => {
        expect(matchesPricingModelSearch(model, "  ")).toBe(true);
        expect(matchesPricingModelSearch(model, "Claude")).toBe(false);
    });
});

describe("admin billing form validation", () => {
    it("turns Ant Design validation rejection into an inline-validation result", async () => {
        const validationFailure = { values: { name: "" }, errorFields: [{ name: ["name"], errors: ["请输入名称"], warnings: [] }], outOfDate: false };

        await expect(resolveFormValidation(Promise.reject(validationFailure))).resolves.toBeNull();
    });
});

describe("admin top-up order presentation", () => {
    it("labels manual payment and exposes only valid finance actions", () => {
        expect(adminTopUpProviderLabel("manual")).toBe("人工确认");
        expect(adminTopUpProviderLabel("zalopay")).toBe("ZaloPay");
        expect(adminTopUpProviderLabel("stripe")).toBe("stripe");
        expect(adminTopUpOrderActions({ provider: "manual", status: "pending" })).toEqual(["receive", "close"]);
        expect(adminTopUpOrderActions({ provider: "manual", status: "paid" })).toEqual(["refund"]);
        expect(adminTopUpOrderActions({ provider: "stripe", status: "pending" })).toEqual([]);
        expect(adminTopUpOrderActions({ provider: "stripe", status: "paid" })).toEqual(["refund"]);
        expect(adminTopUpOrderActions({ provider: "manual", status: "canceled" })).toEqual([]);
    });
});

describe("admin pricing summaries", () => {
    it("does not report a complete Seedance token dimension as non-executable", () => {
        expect(
            providerPricingStatusReasons({
                provider: "dflop",
                modelId: "doubao-seedance-2.0",
                status: "PARTIAL",
                syncedAt: "2026-09-24T00:00:00.000Z",
                raw: {},
                dimensions: [
                    {
                        id: "video-token:billingbasis=default,resolution=720p",
                        kind: "VIDEO_TOKEN",
                        key: "video_token_price_per_1m",
                        unit: "dflop_credit/1m_tokens",
                        source: "upstream",
                        upstreamValue: "2760",
                        effectiveValue: "2760",
                        syncedAt: "2026-09-24T00:00:00.000Z",
                        conditions: { billingBasis: "default", resolution: "720p" },
                    },
                ],
                unknownFields: [],
                missingFields: [],
                warnings: [],
            }),
        ).toEqual([]);
    });

    it("separates executable GPT text billing from ambiguous cross-modal pricing", () => {
        const profile = {
            provider: "dflop" as const,
            modelId: "gpt-6",
            status: "PARTIAL" as const,
            syncedAt: "2026-09-24T00:00:00.000Z",
            raw: {},
            dimensions: [
                { id: "token-input", kind: "TOKEN_INPUT" as const, key: "input_per_1m", unit: "dflop_credit/1m_tokens", source: "upstream" as const, upstreamValue: "4044", effectiveValue: "4044", syncedAt: "2026-09-24T00:00:00.000Z" },
                { id: "image-output", kind: "IMAGE_OUTPUT" as const, key: "price_per_image", unit: "dflop_credit/image", source: "upstream" as const, upstreamValue: "80.88", effectiveValue: "80.88", syncedAt: "2026-09-24T00:00:00.000Z" },
            ],
            unknownFields: [],
            missingFields: [],
            warnings: [{ code: "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT" as const, field: "price_per_image", message: "跨模态 contract 不明确" }],
            metadata: { category: "text" },
        };

        expect(providerPricingExecutionSummary(profile)).toEqual(["Text pricing: Executable", "Cross-modal pricing: Partial"]);
        expect(providerPricingStatusReasons(profile)).toContain("AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT: 跨模态 contract 不明确");
    });

    it("shows operation-level unsupported probe evidence and verification time", () => {
        expect(
            providerCapabilityProbeSummary({
                provider: "dflop",
                modelId: "gpt-6",
                status: "READY",
                syncedAt: "2026-09-24T00:00:00.000Z",
                raw: { price_per_image: "80.88" },
                dimensions: [],
                unknownFields: [],
                missingFields: [],
                warnings: [],
                metadata: {
                    unscopedProviderPrices: { price_per_image: "80.88" },
                    capabilityProbes: {
                        builtin_image_generation: { outcome: "unsupported", probedAt: "2026-09-24T01:00:00.000Z", billingEvidence: { source: "none" } },
                    },
                },
            }),
        ).toEqual([
            "builtin_image_generation · Probe verified: yes · Last verified at: 2026-09-24T01:00:00.000Z · Tier/Billing source: none · Billing basis: unresolved · Result: unsupported · Usage: no · Image output: no",
            "price_per_image: 80.88（仅保留为 Raw provider metadata）",
        ]);
    });

    it("builds a dimension-level preview before applying a suggested sale price", () => {
        expect(
            buildSuggestedSalePriceDiff(
                { version: 1, components: [{ id: "old-720", dimension: "durationSeconds", unitPrice: "0.2", when: { resolution: "720p" } }] },
                {
                    version: 1,
                    components: [
                        { id: "new-720", dimension: "durationSeconds", unitPrice: "0.25", when: { resolution: "720p" } },
                        { id: "new-1080", dimension: "durationSeconds", unitPrice: "0.5", when: { resolution: "1080p" } },
                    ],
                },
            ),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ status: "changed", oldValue: "0.2", newValue: "0.25", label: expect.stringContaining("720p") }),
                expect.objectContaining({ status: "added", newValue: "0.5", label: expect.stringContaining("1080p") }),
            ]),
        );
    });

    it("shows a conditional video sale rate without exposing the revision fingerprint", () => {
        const summary = formatPricingRateCardForAdmin(
            {
                version: 1,
                revision: 'rate-card-v1:[{"id":"video-duration","dimension":"durationSeconds","unitPrice":"0.04","per":"1","when":{"quality":"standard","resolution":"1280x720","format":"mp4"}}]',
                components: [
                    {
                        id: "video-duration",
                        dimension: "durationSeconds",
                        unitPrice: "0.04",
                        per: "1",
                        when: { quality: "standard", resolution: "1280x720", format: "mp4" },
                    },
                ],
            },
            "积分",
        );

        expect(summary).toEqual({
            versionLabel: "价格卡 v1",
            componentLabels: ["时长：0.04 积分 / 1 秒（质量 standard · 分辨率 1280x720 · 格式 mp4）"],
        });
        expect(JSON.stringify(summary)).not.toContain("rate-card-v1:");
    });

    it("distinguishes provider-native cost from its USD conversion", () => {
        expect(
            formatProviderCostUnitForAdmin({
                kind: "provider-native",
                provider: "Dflop",
                unit: "Dflop-point",
                usdConversion: { version: "dflop-points-v1", usdPerUnit: "0.01666667" },
            }),
        ).toEqual({
            priceUnit: "Dflop-point",
            conversionLabel: "Dflop · 1 Dflop-point = 0.01666667 USD · dflop-points-v1",
        });
    });
});
