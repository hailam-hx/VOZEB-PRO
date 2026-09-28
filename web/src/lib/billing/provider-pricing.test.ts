import { describe, expect, it } from "vitest";

import { parseDflopPricing } from "../dflop-pricing";
import { DEFAULT_SYSTEM_PRICING_POLICY } from "./pricing-policy";
import {
    applyProviderPricingConversion,
    canonicalProviderPricingDimensionId,
    normalizeProviderPricingProfile,
    providerPricingCostUnit,
    providerPricingProfileToCostRateCard,
    reconcileProviderPricingProfile,
    restoreProviderPricingDimension,
} from "./provider-pricing";

describe("provider pricing dimensions", () => {
    it("builds the same id for equivalent condition maps", () => {
        const first = canonicalProviderPricingDimensionId({ kind: "VIDEO_SECOND", conditions: { resolution: "720p", mode: "fast" } });
        const second = canonicalProviderPricingDimensionId({ kind: "VIDEO_SECOND", conditions: { mode: "fast", resolution: "720p" } });

        expect(first).toBe("video-second:mode=fast,resolution=720p");
        expect(second).toBe(first);
    });

    it("normalizes condition keys and values without collapsing distinct dimensions", () => {
        expect(canonicalProviderPricingDimensionId({ kind: "VIDEO_TOKEN", conditions: { billingBasis: " Default ", resolution: "1080P" } })).toBe("video-token:billingbasis=default,resolution=1080p");
        expect(canonicalProviderPricingDimensionId({ kind: "VIDEO_TOKEN", conditions: { billingBasis: "with_video_input" } })).toBe("video-token:billingbasis=with_video_input");
        expect(canonicalProviderPricingDimensionId({ kind: "TOKEN_INPUT" })).toBe("token-input");
    });

    it("repairs persisted legacy tier duplicates and stale migration warnings", () => {
        const current = parseDflopPricing({ video_token_price_per_1m: { "default@480p": "2760" }, video_second_stage_per_second: { "720p": "20" } }, { modelId: "doubao-seedance-2.0-lite", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });
        const legacyToken = { ...current.dimensions[0], id: "video-token:tier=default@480p", conditions: { tier: "default@480p" }, syncedAt: "2026-09-23T00:00:00.000Z" };
        const legacyStage = { ...current.dimensions[1], id: "video-second-stage:tier=720p", conditions: { tier: "720p" }, syncedAt: "2026-09-23T00:00:00.000Z" };
        const normalized = normalizeProviderPricingProfile({
            ...current,
            status: "STALE",
            dimensions: [...current.dimensions, legacyToken, legacyStage],
            missingFields: [legacyToken.id, legacyStage.id],
            warnings: [
                { code: "MISSING_UPSTREAM_VALUE", field: legacyToken.id, message: "legacy" },
                { code: "MISSING_UPSTREAM_VALUE", field: legacyStage.id, message: "legacy" },
                { code: "NON_EXECUTABLE_DIMENSION", field: "video_token_price_per_1m", message: "legacy" },
                { code: "NON_EXECUTABLE_DIMENSION", field: "video_second_stage_per_second", message: "legacy" },
            ],
        })!;

        expect(normalized.status).toBe("READY");
        expect(normalized.dimensions.map((dimension) => dimension.id)).toEqual(["video-token:billingbasis=default,resolution=480p", "video-second-stage:resolution=720p"]);
        expect(normalized.missingFields).toEqual([]);
        expect(normalized.warnings).toEqual([]);
    });

    it("repairs legacy Seedance token tiers without a resolution", () => {
        const current = parseDflopPricing({ video_token_price_per_1m: { default: "4200", with_video_input: "2520" } }, { modelId: "video-fixture", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });
        const normalized = normalizeProviderPricingProfile({
            ...current,
            status: "STALE",
            dimensions: [
                ...current.dimensions,
                { ...current.dimensions[0], id: "video-token:tier=default", conditions: { tier: "default" } },
                { ...current.dimensions[1], id: "video-token:tier=with_video_input", conditions: { tier: "with_video_input" } },
            ],
            missingFields: ["video-token:tier=default", "video-token:tier=with_video_input"],
            warnings: [
                { code: "MISSING_UPSTREAM_VALUE", field: "video-token:tier=default", message: "legacy" },
                { code: "MISSING_UPSTREAM_VALUE", field: "video-token:tier=with_video_input", message: "legacy" },
            ],
        })!;

        expect(normalized.status).toBe("READY");
        expect(normalized.dimensions.map((dimension) => dimension.id)).toEqual(["video-token:billingbasis=default", "video-token:billingbasis=with_video_input"]);
        expect(normalized.missingFields).toEqual([]);
    });
});

describe("provider pricing reconciliation", () => {
    const previous = () => {
        const profile = parseDflopPricing({ video_price_tiers: { "480p": "40", "720p": "90", "1080p": "220" } }, { modelId: "video", category: "video", syncedAt: "2026-09-23T00:00:00.000Z" });
        profile.dimensions.find((item) => item.conditions?.resolution === "720p")!.source = "manual";
        profile.dimensions.find((item) => item.conditions?.resolution === "720p")!.effectiveValue = "95";
        return profile;
    };

    it("preserves a manual dimension, refreshes upstream values, and retains missing prices as stale", () => {
        const incoming = parseDflopPricing({ video_price_tiers: { "720p": "100", "1080p": "230" } }, { modelId: "video", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });
        const result = reconcileProviderPricingProfile(previous(), incoming);

        expect(result.dimensions.find((item) => item.id === "video-second:resolution=720p")).toMatchObject({ source: "manual", upstreamValue: "100", effectiveValue: "95" });
        expect(result.dimensions.find((item) => item.id === "video-second:resolution=1080p")).toMatchObject({ source: "upstream", upstreamValue: "230", effectiveValue: "230" });
        expect(result.dimensions.find((item) => item.id === "video-second:resolution=480p")).toMatchObject({ effectiveValue: "40" });
        expect(result.status).toBe("STALE");
        expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PRICING_DRIFT" }), expect.objectContaining({ code: "MISSING_UPSTREAM_VALUE" })]));
    });

    it("treats explicit zero as a value and can restore one manual dimension to upstream", () => {
        const incoming = parseDflopPricing({ video_price_tiers: { "480p": "40", "720p": 0, "1080p": "200" } }, { modelId: "video", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });
        const reconciled = reconcileProviderPricingProfile(previous(), incoming);
        const restored = restoreProviderPricingDimension(reconciled, "video-second:resolution=720p");

        expect(restored.dimensions.find((item) => item.id === "video-second:resolution=720p")).toMatchObject({ source: "upstream", upstreamValue: "0", effectiveValue: "0" });
    });

    it("migrates legacy Seedance token tier dimensions to canonical billing basis dimensions", () => {
        const previousProfile = parseDflopPricing({ video_token_price_per_1m: { "default@480p": "2700", "with_video_input@480p": "1600" } }, { modelId: "doubao-seedance-2.0", category: "video", syncedAt: "2026-09-23T00:00:00.000Z" });
        previousProfile.dimensions = previousProfile.dimensions.map((dimension) => ({
            ...dimension,
            id: `video-token:tier=${dimension.conditions?.billingBasis}@${dimension.conditions?.resolution}`,
            conditions: { tier: `${dimension.conditions?.billingBasis}@${dimension.conditions?.resolution}` },
        }));
        previousProfile.dimensions[0] = { ...previousProfile.dimensions[0], source: "manual", effectiveValue: "2750" };
        const incoming = parseDflopPricing({ video_token_price_per_1m: { "default@480p": "2760", "with_video_input@480p": "1680" } }, { modelId: "doubao-seedance-2.0", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });

        const result = reconcileProviderPricingProfile(previousProfile, incoming);

        expect(result.status).toBe("PARTIAL");
        expect(result.missingFields).toEqual([]);
        expect(result.dimensions).toHaveLength(2);
        expect(result.dimensions.find((item) => item.conditions?.billingBasis === "default")).toMatchObject({ source: "manual", upstreamValue: "2760", effectiveValue: "2750" });
        expect(result.warnings).toEqual([expect.objectContaining({ code: "PRICING_DRIFT", field: "video-token:billingbasis=default,resolution=480p" })]);
    });

    it("marks Grok 4.7 stale when the next structured registry sync actually removes long-context fields", () => {
        const previousProfile = parseDflopPricing(
            {
                input_per_1m: "808.8",
                cached_input_per_1m: "202.2",
                output_per_1m: "2426.4",
                long_context_threshold_tokens: 200000,
                input_per_1m_long: "1617.6",
                cached_input_per_1m_long: "404.4",
                output_per_1m_long: "4852.8",
                price_per_server_tool_call: "2.022",
            },
            { modelId: "grok-4.7", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const incoming = parseDflopPricing({ input_per_1m: "808.8", cached_input_per_1m: "202.2", output_per_1m: "2426.4", price_per_server_tool_call: "2.022" }, { modelId: "grok-4.7", category: "text", syncedAt: "2026-09-25T00:00:00.000Z" });

        const reconciled = reconcileProviderPricingProfile(previousProfile, incoming);

        expect(reconciled.status).toBe("STALE");
        expect(reconciled.missingFields).toEqual(expect.arrayContaining(["token-input:context=long", "token-cached-input:context=long", "token-output:context=long"]));
    });

    it("retires upstream-only Seedance Lite second-stage and unscoped token dimensions when current tiered token billing is complete", () => {
        const previous = parseDflopPricing(
            { video_token_price_per_1m: { default: "4200", with_video_input: "2520", "default@720p": "4200", "with_video_input@720p": "2520" }, video_second_stage_per_second: { "720p": "10" } },
            { modelId: "doubao-seedance-2.5-lite", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const incoming = parseDflopPricing(
            { video_price_tiers: { "720p": "90", "1080p": "224" }, video_token_price_per_1m: { "default@720p": "4200", "with_video_input@720p": "2520", "default@1080p": "4620", "with_video_input@1080p": "2760" } },
            { modelId: "doubao-seedance-2.5-lite", category: "video", syncedAt: "2026-09-26T00:00:00.000Z" },
        );
        const result = reconcileProviderPricingProfile(previous, incoming);
        expect(result.status).toBe("READY");
        expect(result.missingFields).toEqual([]);
        expect(result.dimensions.filter((dimension) => dimension.kind === "VIDEO_TOKEN").every((dimension) => dimension.conditions?.resolution)).toBe(true);
    });

    it("keeps a manually overridden Seedance Lite stage as stale for administrator review", () => {
        const previous = parseDflopPricing(
            { video_token_price_per_1m: { "default@720p": "4200", "with_video_input@720p": "2520" }, video_second_stage_per_second: { "720p": "10" } },
            { modelId: "doubao-seedance-2.5-lite", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        previous.dimensions.find((dimension) => dimension.kind === "VIDEO_SECOND_STAGE")!.source = "manual";
        const incoming = parseDflopPricing(
            { video_price_tiers: { "720p": "90" }, video_token_price_per_1m: { "default@720p": "4200", "with_video_input@720p": "2520" } },
            { modelId: "doubao-seedance-2.5-lite", category: "video", syncedAt: "2026-09-26T00:00:00.000Z" },
        );
        const result = reconcileProviderPricingProfile(previous, incoming);
        expect(result.status).toBe("STALE");
        expect(result.missingFields).toContain("video-second-stage:resolution=720p");
    });

    it("drops a legacy GPT-5 per-image dimension when the audited contract reclassifies it as unscoped metadata", () => {
        const previousProfile = parseDflopPricing({ input_per_1m: "2022", cached_input_per_1m: "202.2", output_per_1m: "12132", price_per_image: "80.88" }, { modelId: "legacy-gpt-5.5", category: "text", syncedAt: "2026-09-23T00:00:00.000Z" });
        const incoming = parseDflopPricing({ input_per_1m: "2022", cached_input_per_1m: "202.2", output_per_1m: "12132", price_per_image: "80.88" }, { modelId: "gpt-5.5", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });

        const reconciled = reconcileProviderPricingProfile(previousProfile, incoming);

        expect(reconciled.status).toBe("READY");
        expect(reconciled.missingFields).toEqual([]);
        expect(reconciled.dimensions.some((dimension) => dimension.kind === "IMAGE_OUTPUT")).toBe(false);
        expect(reconciled.metadata).toMatchObject({ unscopedProviderPrices: { price_per_image: "80.88" } });
    });
});

describe("provider pricing cost projection", () => {
    it("projects cache creation, server tool calls, and authoritative long-context alternatives", () => {
        const profile = parseDflopPricing(
            {
                input_per_1m: "100",
                cached_input_per_1m: "10",
                output_per_1m: "200",
                cache_creation_per_1m: "125",
                input_per_1m_long: "200",
                cached_input_per_1m_long: "20",
                output_per_1m_long: "400",
                long_context_threshold_tokens: 200000,
                price_per_server_tool_call: "2",
            },
            { modelId: "structured-text-fixture", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("READY");
        expect(card.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ basis: "CACHE_CREATION", dimension: "cacheCreationTokens" }),
                expect.objectContaining({ basis: "SERVER_TOOL_CALL", dimension: "serverToolCalls" }),
                expect.objectContaining({ basis: "TOKEN_INPUT", when: { contextTier: "normal" }, contextThresholdTokens: "200000" }),
                expect.objectContaining({ basis: "TOKEN_INPUT", when: { contextTier: "long" }, contextThresholdTokens: "200000" }),
            ]),
        );
    });

    it("keeps nonzero image output pricing on a text endpoint partial without an authoritative image count", () => {
        const profile = parseDflopPricing({ input_per_1m: "100", output_per_1m: "200", price_per_image: "30" }, { modelId: "multimodal-text-fixture", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");

        expect(converted.status).toBe("PARTIAL");
        expect(converted.warnings).toContainEqual(expect.objectContaining({ code: "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT", field: "price_per_image" }));
    });

    it("executes Seedance token prices that vary only by billing basis", () => {
        const profile = parseDflopPricing(
            { price_per_video_second: "100", video_token_price_per_1m: { default: "4200", with_video_input: "2520" }, video_second_stage_per_second: { "720p": "2" } },
            { modelId: "video-fixture", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("READY");
        expect(card.components.filter((component) => component.basis === "VIDEO_TOKEN")).toEqual([expect.objectContaining({ when: { billingBasis: "default" } }), expect.objectContaining({ when: { billingBasis: "with_video_input" } })]);
        expect(card.components.some((component) => component.basis === "VIDEO_SECOND")).toBe(false);
    });

    it("executes Seedream tiers from the audited endpoint contract while keeping registry prices", () => {
        const profile = parseDflopPricing({ price_per_image: "18", price_per_image_large: "36", price_per_input_image: "1.2" }, { modelId: "doubao-seedream-5-0-pro-260628", category: "image", syncedAt: "2026-09-24T00:00:00.000Z" });
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");

        expect(converted.status).toBe("READY");
        expect(converted.warnings).toContainEqual(expect.objectContaining({ code: "DOC_CONTRACT_DIVERGENCE" }));
        expect(providerPricingProfileToCostRateCard(converted)?.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ basis: "IMAGE_OUTPUT", operationScope: "standalone_image_generation", megapixelThreshold: "2.61", missingMegapixelTier: "large" }),
                expect.objectContaining({ basis: "IMAGE_LARGE", operationScope: "standalone_image_generation", megapixelThreshold: "2.61", missingMegapixelTier: "large" }),
                expect.objectContaining({ basis: "IMAGE_INPUT", operationScope: "standalone_image_generation", freeQuantity: "1" }),
            ]),
        );
    });

    it("distinguishes a missing Qwen named-size mapping from a missing megapixel threshold", () => {
        const profile = parseDflopPricing({ price_per_image: "15", price_per_image_large: "30", price_per_input_image: "1.2" }, { modelId: "qwen-image-3.0-pro", category: "image", syncedAt: "2026-09-24T00:00:00.000Z" });
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");

        expect(converted.status).toBe("PARTIAL");
        expect(converted.warnings).toContainEqual(expect.objectContaining({ code: "MISSING_MACHINE_READABLE_SIZE_TIER_MAPPING", field: "price_per_image_large" }));
        expect(providerPricingProfileToCostRateCard(converted)?.components).toContainEqual(expect.objectContaining({ basis: "IMAGE_INPUT" }));
        expect(providerPricingProfileToCostRateCard(converted)?.components.find((component) => component.basis === "IMAGE_INPUT")).toHaveProperty("freeQuantity", "0");
    });

    it("keeps GPT text pricing executable while marking an ambiguous cross-modal image price partial", () => {
        const profile = parseDflopPricing(
            {
                input_per_1m: "4044",
                cached_input_per_1m: "404.4",
                output_per_1m: "20220",
                long_context_threshold_tokens: 272000,
                input_per_1m_long: "8088",
                cached_input_per_1m_long: "808.8",
                output_per_1m_long: "30330",
                price_per_image: "80.88",
                supports_image_gen: true,
            },
            { modelId: "gpt-6", category: "text", endpointType: null, syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("PARTIAL");
        expect(converted.warnings).toContainEqual(expect.objectContaining({ code: "AMBIGUOUS_CROSS_MODAL_PRICING_CONTRACT", field: "price_per_image" }));
        expect(card.components.filter((component) => component.basis?.startsWith("TOKEN_"))).toHaveLength(6);
        expect(card.components.some((component) => component.basis === "IMAGE_OUTPUT")).toBe(false);
    });

    it("does not add a per-image charge to an explicitly token-only built-in image operation", () => {
        const profile = parseDflopPricing({ input_per_1m: "100", output_per_1m: "200", price_per_image: "0", supports_image_gen: true }, { modelId: "token-image-tool", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("READY");
        expect(card.components.some((component) => component.basis === "IMAGE_OUTPUT")).toBe(false);
    });

    it("keeps GPT-5.x registry image price as unscoped metadata while its documented built-in image operation remains token billed", () => {
        const profile = parseDflopPricing({ input_per_1m: "100", output_per_1m: "200", price_per_image: "80.88", supports_image_gen: true }, { modelId: "gpt-5.6-sol", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("READY");
        expect(converted.raw.price_per_image).toBe("80.88");
        expect(converted.metadata).toMatchObject({ unscopedProviderPrices: { price_per_image: "80.88" }, builtinImageGenerationContract: { billingBasis: "token", source: "official_endpoint_contract" } });
        expect(converted.operationPricingStatus).toMatchObject({ text_generation: { status: "READY" }, builtin_image_generation: { status: "READY" } });
        expect(card.components.filter((component) => component.operationScope === "text_generation")).toHaveLength(2);
        expect(card.components.filter((component) => component.operationScope === "builtin_image_generation")).toHaveLength(2);
        expect(card.components.some((component) => component.basis === "IMAGE_OUTPUT")).toBe(false);
    });

    it("projects mutually exclusive image tiers when upstream supplies a machine-readable MP threshold", () => {
        const profile = parseDflopPricing({ price_per_image: "18", price_per_image_large: "36", image_large_threshold_megapixels: "2.36" }, { modelId: "image-fixture", category: "image", syncedAt: "2026-09-24T00:00:00.000Z" });
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const components = providerPricingProfileToCostRateCard(converted)!.components;

        expect(converted.status).toBe("READY");
        expect(components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ basis: "IMAGE_OUTPUT", when: { megapixelTier: "normal" }, megapixelThreshold: "2.36" }),
                expect.objectContaining({ basis: "IMAGE_LARGE", when: { megapixelTier: "large" }, megapixelThreshold: "2.36" }),
            ]),
        );
    });

    it("uses authoritative Seedance tokens and optional Lite second-stage duration without per-second double charging", () => {
        const profile = parseDflopPricing(
            {
                price_per_video_second: "148.716",
                video_price_tiers: { "720p": "59.616" },
                video_token_price_per_1m: { "default@720p": "2760", "with_video_input@720p": "1680" },
                video_second_stage_per_second: { "720p": "2.5" },
            },
            { modelId: "doubao-seedance-2.0-lite", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("READY");
        expect(card.components.some((component) => component.id.startsWith("video-second:"))).toBe(false);
        expect(card.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ dimension: "outputTokens", per: "1000000", when: { billingBasis: "default", resolution: "720p" } }),
                expect.objectContaining({ dimension: "durationSeconds", per: "1", when: { resolution: "720p" } }),
            ]),
        );
    });

    it("converts executable DFLOP dimensions to HOTX credits and projects only safe usage dimensions", () => {
        const profile = parseDflopPricing(
            {
                input_per_1m: "400",
                cached_input_per_1m: "40",
                output_per_1m: "800",
                cache_creation_per_1m: "20",
                price_per_image: "80",
                video_price_tiers: { "720p": "90.72" },
                video_token_price_per_1m: { default: "4200" },
                price_per_tts_char: "0.04",
                price_per_voice_clone: "400",
            },
            { modelId: "mixed-fixture", syncedAt: "2026-09-24T00:00:00.000Z" },
        );
        const converted = applyProviderPricingConversion(profile, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T00:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.dimensions.find((item) => item.kind === "VIDEO_SECOND")?.providerCostHotxCredits).toBe("0.2268");
        expect(converted.conversion).toMatchObject({ cnyToUsd: "0.15", hotxUsdPerCredit: "1" });
        expect(card.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ dimension: "inputTokens", unitPrice: "1", per: "1000000" }),
                expect.objectContaining({ dimension: "cachedInputTokens", unitPrice: "0.1", per: "1000000" }),
                expect.objectContaining({ dimension: "outputTokens", unitPrice: "2", per: "1000000" }),
                expect.objectContaining({ dimension: "count", unitPrice: "0.2", per: "1" }),
                expect.objectContaining({ dimension: "outputTokens", unitPrice: "10.5", per: "1000000", when: { billingBasis: "default" } }),
                expect.objectContaining({ dimension: "characters", unitPrice: "0.0001", per: "1" }),
                expect.objectContaining({ dimension: "request", unitPrice: "1", per: "1" }),
            ]),
        );
        expect(card.components.some((component) => component.id.includes("cache-creation"))).toBe(true);
        expect(card.components.some((component) => component.id.includes("video-token"))).toBe(true);
        expect(converted.status).toBe("READY");
        expect(converted.warnings).toEqual([]);
    });

    it("labels converted rate cards as HOTX credits with the policy USD conversion", () => {
        const policy = { ...DEFAULT_SYSTEM_PRICING_POLICY, hotxUsdPerCredit: "2" };
        expect(providerPricingCostUnit(policy)).toEqual({
            kind: "provider-native",
            provider: "hotx",
            unit: "credit",
            usdConversion: { version: policy.version, usdPerUnit: "2" },
        });
    });
});
