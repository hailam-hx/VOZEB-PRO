import { describe, expect, it } from "vitest";

import { parseDflopPricing } from "./dflop-pricing";

const syncedAt = "2026-09-24T00:00:00.000Z";

describe("DFLOP structured pricing", () => {
    it("maps documented clip-compose task pricing without treating it as seconds", () => {
        const parsed = parseDflopPricing({ price_per_video_task: "48" }, { modelId: "clip-compose", category: "video", endpointType: "videos_generations", syncedAt });
        expect(parsed).toMatchObject({ status: "READY", unknownFields: [] });
        expect(parsed.dimensions).toEqual([expect.objectContaining({ kind: "PER_CALL", key: "price_per_video_task", unit: "dflop_credit/task", operationScope: "video_generation", effectiveValue: "48" })]);
    });
    it("parses text, long-context, cache, and tool prices without numeric coercion", () => {
        const parsed = parseDflopPricing(
            {
                input_per_1m: "2022.000",
                cached_input_per_1m: "202.2",
                output_per_1m: "12132",
                cache_creation_per_1m: "303.3",
                long_context_threshold_tokens: 200000,
                input_per_1m_long: "4044",
                cached_input_per_1m_long: "404.4",
                output_per_1m_long: "24264",
                price_per_server_tool_call: "2.022",
            },
            { modelId: "grok-4.6", category: "text", syncedAt },
        );

        expect(parsed.status).toBe("READY");
        expect(parsed.dimensions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "TOKEN_INPUT", upstreamValue: "2022", effectiveValue: "2022", source: "upstream" }),
                expect.objectContaining({ kind: "TOKEN_CACHED_INPUT", upstreamValue: "202.2" }),
                expect.objectContaining({ kind: "TOKEN_OUTPUT", upstreamValue: "12132" }),
                expect.objectContaining({ kind: "CACHE_CREATION", upstreamValue: "303.3" }),
                expect.objectContaining({ kind: "SERVER_TOOL_CALL", upstreamValue: "2.022" }),
                expect.objectContaining({ kind: "TOKEN_INPUT", upstreamValue: "4044", conditions: { context: "long" } }),
            ]),
        );
        expect(parsed.raw.long_context_threshold_tokens).toBe(200000);
    });

    it("keeps every dynamic video tier and future structured tier", () => {
        const parsed = parseDflopPricing(
            {
                price_per_video_second: "224.532",
                video_price_tiers: { "480p": "40.3515", "720p": "90.72", "future-tier": "333.125" },
                video_token_price_per_1m: { default: "4200", with_video_input: "2520", "default@1080p": "4620" },
                video_second_stage_per_second: { "720p": "2.5", "1080p": "5" },
            },
            { modelId: "doubao-seedance-2.5", category: "video", syncedAt },
        );

        expect(parsed.dimensions.find((item) => item.id === "video-second:resolution=future-tier")?.effectiveValue).toBe("333.125");
        expect(parsed.dimensions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "VIDEO_SECOND", effectiveValue: "224.532" }),
                expect.objectContaining({ kind: "VIDEO_TOKEN", effectiveValue: "4200", conditions: { billingBasis: "default" } }),
                expect.objectContaining({ kind: "VIDEO_TOKEN", effectiveValue: "2520", conditions: { billingBasis: "with_video_input" } }),
                expect.objectContaining({ kind: "VIDEO_TOKEN", effectiveValue: "4620", conditions: { billingBasis: "default", resolution: "1080p" } }),
                expect.objectContaining({ kind: "VIDEO_SECOND_STAGE", effectiveValue: "2.5", conditions: { resolution: "720p" } }),
            ]),
        );
    });

    it("parses image prices and keeps images_per_request as metadata", () => {
        const parsed = parseDflopPricing({ price_per_image: 0.08, price_per_input_image: "0.02", price_per_image_large: "0.16", images_per_request: 4 }, { modelId: "image-model", category: "image", syncedAt });

        expect(parsed.dimensions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "IMAGE_OUTPUT", effectiveValue: "0.08" }),
                expect.objectContaining({ kind: "IMAGE_INPUT", effectiveValue: "0.02" }),
                expect.objectContaining({ kind: "IMAGE_LARGE", effectiveValue: "0.16" }),
            ]),
        );
        expect(parsed.dimensions.some((item) => item.key === "images_per_request")).toBe(false);
        expect(parsed.metadata).toMatchObject({ imagesPerRequest: 4 });
    });

    it("adds the audited Seedream endpoint contract without pretending it came from the registry", () => {
        const parsed = parseDflopPricing(
            { price_per_image: "18", price_per_input_image: "1.2", price_per_image_large: "36", description: "≤ 2.61 MP" },
            { modelId: "doubao-seedream-5-0-pro-260628", category: "image", endpointType: "images_generations", syncedAt },
        );

        expect(parsed.dimensions.find((dimension) => dimension.kind === "IMAGE_INPUT")?.metadata).toMatchObject({ freeQuantity: "1", source: "official_endpoint_contract", contractUrl: expect.stringContaining("media-apis") });
        expect(parsed.metadata).toMatchObject({
            imageLargeThresholdMegapixels: "2.61",
            holdTierWhenSizeMissing: "large",
            settlementTierSource: "actual_output_size",
            operationScope: "standalone_image_generation",
        });
        expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: "DOC_CONTRACT_DIVERGENCE" }));
    });

    it("records the Grok 4.7 docs and structured-registry divergence without blocking READY", () => {
        const parsed = parseDflopPricing(
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
            { modelId: "grok-4.7", category: "text", syncedAt },
        );

        expect(parsed.status).toBe("READY");
        expect(parsed.warnings).toContainEqual(expect.objectContaining({ code: "DOC_REGISTRY_CONTRACT_DIVERGENCE" }));
    });

    it.each([
        ["price_per_tts_char", "audio", "audio_speech", "TTS_CHARACTER"],
        ["price_per_voice_clone", "audio", "audio_voices", "VOICE_CLONE_CALL"],
        ["price_per_music_generation", "music", "music_generations", "MUSIC_GENERATION"],
        ["price_per_avatar", "avatar", "avatar_generations", "AVATAR_CREATE"],
    ] as const)("maps %s using model semantics", (field, category, endpointType, kind) => {
        const parsed = parseDflopPricing({ [field]: "12.5" }, { modelId: `${category}-model`, category, endpointType, syncedAt });
        expect(parsed.dimensions).toEqual([expect.objectContaining({ kind, effectiveValue: "12.5" })]);
    });

    it("preserves explicit zero, discount metadata, and unknown pricing fields", () => {
        const parsed = parseDflopPricing({ price_per_image: 0, discount: "0.8", price_per_future_unit: "9.5", arbitrary_metadata: true }, { modelId: "future-image", category: "image", syncedAt });

        expect(parsed.dimensions[0]).toMatchObject({ upstreamValue: "0", effectiveValue: "0" });
        expect(parsed.discount).toBe("0.8");
        expect(parsed.unknownFields).toEqual(["price_per_future_unit"]);
        expect(parsed.raw).toMatchObject({ price_per_future_unit: "9.5" });
        expect(parsed.raw.arbitrary_metadata).toBeUndefined();
        expect(parsed.status).toBe("PARTIAL");
    });

    it("rejects negative or malformed prices and marks callable models without a known basis for review", () => {
        const parsed = parseDflopPricing({ price_per_image: "-0.1", price_per_video_second: "not-a-number", price_per_future_unit: "2" }, { modelId: "broken", category: "video", syncedAt });

        expect(parsed.dimensions).toEqual([]);
        expect(parsed.status).toBe("NEEDS_REVIEW");
        expect(parsed.unknownFields).toEqual(["price_per_future_unit"]);
        expect(parsed.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(["INVALID_VALUE", "UNKNOWN_FIELD", "MISSING_BASIS"]));
    });
});
