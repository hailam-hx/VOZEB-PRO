import { describe, expect, it } from "vitest";

import type { LogicalModel } from "@/lib/auth/store-types";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";

import { calculateModelEstimatorCoverage, estimateCreativeSaleCredits, pricingDimensionEstimatorRegistry } from "./creative-sale-estimator";

function model(capability: LogicalModel["capability"], components?: NonNullable<LogicalModel["saleRateCard"]>["components"]): LogicalModel {
    return { id: `${capability}-model`, name: `${capability} model`, capability, enabled: true, bindings: [], ...(components ? { saleRateCard: { version: 1, components }, salePriceSource: "approved" as const } : {}) };
}

function asset(type: "image" | "video" | "audio", durationMs?: number, verified = true): CreativeAsset {
    return {
        id: `${type}-${durationMs || 0}`,
        userId: "user",
        conversationId: "conversation",
        ordinal: 0,
        type,
        status: "ready",
        title: type,
        ...(durationMs ? { durationMs } : {}),
        metadata: verified ? { mediaProbe: { status: "verified", source: "ffprobe" } } : {},
        createdAt: 1,
        updatedAt: 1,
    };
}

describe("estimateCreativeSaleCredits", () => {
    it("registers every supported internal pricing basis", () => {
        expect(Object.keys(pricingDimensionEstimatorRegistry).sort()).toEqual(
            [
                "TOKEN_INPUT",
                "TOKEN_CACHED_INPUT",
                "TOKEN_OUTPUT",
                "CACHE_CREATION",
                "SERVER_TOOL_CALL",
                "IMAGE_OUTPUT",
                "IMAGE_INPUT",
                "IMAGE_LARGE",
                "VIDEO_SECOND",
                "VIDEO_INPUT_SECOND",
                "VIDEO_TOKEN",
                "VIDEO_SECOND_STAGE",
                "TTS_CHARACTER",
                "VOICE_CLONE_CALL",
                "MUSIC_GENERATION",
                "AVATAR_CREATE",
                "AVATAR_SECOND",
                "TRANSCRIPT_CALL",
                "PER_GENERATION",
                "PER_CALL",
                "PER_CHARACTER",
                "PER_SECOND",
            ].sort(),
        );
    });

    it("estimates text input plus configured output cap without assuming a cache hit", () => {
        const logicalModel = model("text", [
            { id: "input", dimension: "inputTokens", basis: "TOKEN_INPUT", unitPrice: "1", per: "1000" },
            { id: "cached", dimension: "cachedInputTokens", basis: "TOKEN_CACHED_INPUT", unitPrice: "0.1", per: "1000" },
            { id: "output", dimension: "outputTokens", basis: "TOKEN_OUTPUT", unitPrice: "2", per: "1000" },
        ]);
        const first = estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "text", prompt: "hello", maxOutputTokens: 100 } });
        const larger = estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "text", prompt: "hello", maxOutputTokens: 200 } });

        expect(first).toMatchObject({
            status: "CONSERVATIVE_ESTIMATE",
            upperBoundCredits: "0.205",
            details: { reasons: expect.arrayContaining(["MAX_OUTPUT_TOKEN_BOUND"]) },
            components: [
                { dimension: "TOKEN_INPUT", quantity: "5" },
                { dimension: "TOKEN_CACHED_INPUT", quantity: "0", credits: "0" },
                { dimension: "TOKEN_OUTPUT", quantity: "100" },
            ],
        });
        expect(larger).toMatchObject({ status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: "0.405" });
    });

    it("requires a configured text output cap", () => {
        expect(estimateCreativeSaleCredits({ logicalModel: model("text", [{ id: "output", dimension: "outputTokens", basis: "TOKEN_OUTPUT", unitPrice: "2", per: "1000" }]), requestContext: { capability: "text", prompt: "hello" } }).status).toBe(
            "USAGE_INPUT_MISSING",
        );
    });

    it("prices one or many output images", () => {
        const logicalModel = model("image", [{ id: "output", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1.25" }]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 1 } })).toMatchObject({ status: "ESTIMATED", credits: "1.25" });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 4 } })).toMatchObject({ status: "ESTIMATED", credits: "5" });
    });

    it("uses normalized image quality dimensions and billable output count", () => {
        const qwen = model("image", [
            { id: "1k", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1", when: { resolution: "1k" } },
            { id: "2k", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "2", when: { resolution: "2k" } },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel: qwen, requestContext: { capability: "image", count: 1, resolution: "2048x2048", resolutionTier: "2k" } })).toMatchObject({ status: "ESTIMATED", credits: "2" });
        const qwenExact = model("image", [{ id: "exact", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1.5", when: { resolution: "1024x1024" } }]);
        expect(estimateCreativeSaleCredits({ logicalModel: qwenExact, requestContext: { capability: "image", count: 1, resolution: "1024x1024", resolutionTier: "1k" } })).toMatchObject({ status: "ESTIMATED", credits: "1.5" });
        const seedream = model("image", [
            { id: "normal", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1", when: { megapixelTier: "normal" }, megapixelThreshold: "2.61" },
            { id: "large", dimension: "count", basis: "IMAGE_LARGE", unitPrice: "3", when: { megapixelTier: "large" }, megapixelThreshold: "2.61" },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel: seedream, requestContext: { capability: "image", count: 4, resolution: "2048x2048", megapixelTier: "large" } })).toMatchObject({ status: "ESTIMATED", credits: "12" });
    });

    it("ignores zero-price token metadata when classifying a fixed image estimate", () => {
        const logicalModel = model("image", [
            { id: "input-token", dimension: "inputTokens", basis: "TOKEN_INPUT", unitPrice: "0", per: "1000000" },
            { id: "output-token", dimension: "outputTokens", basis: "TOKEN_OUTPUT", unitPrice: "0", per: "1000000" },
            { id: "output", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "2.5" },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 3 } })).toMatchObject({
            status: "ESTIMATED",
            credits: "7.5",
            details: { reasons: ["FIXED_IMAGE_COUNT"] },
        });
    });

    it("matches exact image size tiers and adds reference image components", () => {
        const logicalModel = model("image", [
            { id: "output-large", dimension: "count", basis: "IMAGE_LARGE", unitPrice: "3", when: { resolution: "2048x2048" } },
            { id: "input", dimension: "count", basis: "IMAGE_INPUT", unitPrice: "0.5" },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 2, resolution: "2048x2048", verifiedAssets: [asset("image")] } })).toMatchObject({ status: "ESTIMATED", credits: "6.5" });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 1, resolution: "1024x1024" } }).status).toBe("PRICING_DIMENSION_MISSING");
    });

    it("uses the shared free-reference formula for the Seedream estimate", () => {
        const logicalModel = model("image", [{ id: "input", dimension: "inputImageCount", basis: "IMAGE_INPUT", unitPrice: "0.5", freeQuantity: "1" }]);
        const estimate = estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", verifiedAssets: [asset("image"), { ...asset("image"), id: "image-2" }] } });

        expect(estimate).toMatchObject({ status: "ESTIMATED", credits: "0.5", components: [{ dimension: "IMAGE_INPUT", quantity: "1", credits: "0.5" }] });
    });

    it("selects a matching large-image tier instead of adding it to the normal output tier", () => {
        const logicalModel = model("image", [
            { id: "output", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1" },
            { id: "large", dimension: "count", basis: "IMAGE_LARGE", unitPrice: "3", when: { resolution: "2048x2048" } },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 2, resolution: "1024x1024" } })).toMatchObject({ status: "ESTIMATED", credits: "2" });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 2, resolution: "2048x2048" } })).toMatchObject({ status: "ESTIMATED", credits: "6" });
    });

    it("prices ordinary output video seconds with exact resolution matching", () => {
        const logicalModel = model("video", [{ id: "video", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.4", when: { resolution: "720p" } }]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", durationSeconds: 5, resolution: "720" } })).toMatchObject({ status: "ESTIMATED", credits: "2" });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", durationSeconds: 5, resolution: "1080p" } }).status).toBe("PRICING_DIMENSION_MISSING");
    });

    it("adds verified input and requested output video-second components", () => {
        const logicalModel = model("video", [
            { id: "video-input-second", dimension: "durationSeconds", basis: "VIDEO_INPUT_SECOND", unitPrice: "0.1" },
            { id: "video-output-second", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.4" },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", durationSeconds: 5, verifiedAssets: [asset("video", 10_000)] } })).toMatchObject({
            status: "ESTIMATED",
            credits: "3",
            components: [{ quantity: "10" }, { quantity: "5" }],
        });
    });

    it("uses a configured input-video ceiling when trusted duration is unavailable", () => {
        const logicalModel = model("video", [{ id: "video-input-second", dimension: "durationSeconds", basis: "VIDEO_INPUT_SECOND", unitPrice: "0.1" }]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", verifiedAssets: [asset("video", undefined, false)], inputDurationCeilingSeconds: 30 } })).toMatchObject({
            status: "CONSERVATIVE_ESTIMATE",
            upperBoundCredits: "3",
        });
    });

    it("prices Seedance default and verified reference-video token usage without adding VIDEO_SECOND", () => {
        const logicalModel = model("video", [
            { id: "default", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "6.9", per: "1000000", when: { billingBasis: "default", resolution: "720p" } },
            { id: "reference", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "4.2", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } },
            { id: "legacy-second", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "99", when: { resolution: "720p" } },
        ]);
        const common = { capability: "video" as const, durationSeconds: 5, resolution: "720p", seedanceModelFamily: "seedance-2.0" as const, seedanceFrame: { width: "1280", height: "720" } };
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: common })).toMatchObject({ status: "ESTIMATED", credits: "0.7452", details: { estimatedTokens: "108000", billingBasis: "default" } });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { ...common, verifiedAssets: [asset("video", 10_000)] } })).toMatchObject({
            status: "ESTIMATED",
            credits: "1.3608",
            details: { estimatedTokens: "324000", billingBasis: "with_video_input" },
        });
    });

    it("uses the Seedance family ceiling when reference duration is unknown", () => {
        const logicalModel = model("video", [{ id: "reference", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "4.2", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } }]);
        expect(
            estimateCreativeSaleCredits({
                logicalModel,
                requestContext: { capability: "video", durationSeconds: 5, resolution: "720p", seedanceModelFamily: "seedance-2.0", seedanceFrame: { width: "1280", height: "720" }, verifiedAssets: [asset("video", undefined, false)] },
            }),
        ).toMatchObject({ status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: "1.8144", details: { inputVideoDurationSeconds: "15", reasons: expect.arrayContaining(["REFERENCE_VIDEO_DURATION_CEILING"]) } });
    });

    it("adds Seedance Lite token and output-only second-stage components", () => {
        const logicalModel = model("video", [
            { id: "token", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "4.2", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } },
            { id: "stage", dimension: "durationSeconds", basis: "VIDEO_SECOND_STAGE", unitPrice: "0.25", when: { resolution: "720p" } },
        ]);
        expect(
            estimateCreativeSaleCredits({
                logicalModel,
                requestContext: { capability: "video", durationSeconds: 5, resolution: "720p", seedanceModelFamily: "seedance-2.0", seedanceFrame: { width: "1280", height: "720" }, verifiedAssets: [asset("video", 10_000)] },
            }),
        ).toMatchObject({
            status: "ESTIMATED",
            credits: "2.6108",
            components: [
                { dimension: "VIDEO_TOKEN", credits: "1.3608" },
                { dimension: "VIDEO_SECOND_STAGE", quantity: "5", credits: "1.25" },
            ],
        });
    });

    it("prices TTS characters with Unicode code-point counting", () => {
        const logicalModel = model("audio", [{ id: "tts", dimension: "characters", basis: "TTS_CHARACTER", unitPrice: "0.02" }]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "audio", prompt: "你a🙂" } })).toMatchObject({ status: "ESTIMATED", credits: "0.06", components: [{ quantity: "3" }] });
    });

    it("prices voice clone, avatar creation and transcript as one call", () => {
        for (const basis of ["VOICE_CLONE_CALL", "AVATAR_CREATE", "TRANSCRIPT_CALL", "PER_CALL"] as const) {
            expect(estimateCreativeSaleCredits({ logicalModel: model("audio", [{ id: basis, dimension: "request", basis, unitPrice: "2.5" }]), requestContext: { capability: "audio" } })).toMatchObject({ status: "ESTIMATED", credits: "2.5" });
        }
    });

    it("prices music by generation count rather than returned track count", () => {
        const logicalModel = model("audio", [{ id: "music", dimension: "count", basis: "MUSIC_GENERATION", unitPrice: "3" }]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "audio", count: 2 } })).toMatchObject({ status: "ESTIMATED", credits: "6", components: [{ quantity: "2" }] });
    });

    it("prices avatar video from explicit or trusted audio duration", () => {
        const logicalModel = model("video", [{ id: "avatar", dimension: "durationSeconds", basis: "AVATAR_SECOND", unitPrice: "0.5" }]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", durationSeconds: 8 } })).toMatchObject({ status: "ESTIMATED", credits: "4" });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", verifiedAssets: [asset("audio", 6_000)] } })).toMatchObject({ status: "ESTIMATED", credits: "3" });
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "video", inputDurationCeilingSeconds: 12 } })).toMatchObject({
            status: "CONSERVATIVE_ESTIMATE",
            upperBoundCredits: "6",
            details: { reasons: ["AVATAR_DURATION_CEILING"] },
        });
    });

    it("returns explicit reasons for missing price, missing tiers and unknowable usage", () => {
        expect(estimateCreativeSaleCredits({ logicalModel: model("image"), requestContext: { capability: "image" } }).status).toBe("OFFICIAL_SALE_PRICE_MISSING");
        expect(
            estimateCreativeSaleCredits({ logicalModel: model("video", [{ id: "720", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "1", when: { resolution: "720p" } }]), requestContext: { capability: "video", durationSeconds: 5 } })
                .status,
        ).toBe("PRICING_DIMENSION_MISSING");
        expect(
            estimateCreativeSaleCredits({
                logicalModel: model("video", [{ id: "input", dimension: "durationSeconds", basis: "VIDEO_INPUT_SECOND", unitPrice: "1" }]),
                requestContext: { capability: "video", hasReferenceVideo: true },
            }).status,
        ).toBe("USAGE_INPUT_MISSING");
    });

    it("keeps Decimal precision across multiple components", () => {
        const logicalModel = model("image", [
            { id: "one", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "0.00000003" },
            { id: "two", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "0.00000004" },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel, requestContext: { capability: "image", count: 3 } })).toMatchObject({ status: "ESTIMATED", credits: "0.00000021" });
    });

    it("covers cached input, cache creation, and generic call/second/generation billing bases", () => {
        const cached = model("text", [
            { id: "input", dimension: "inputTokens", basis: "TOKEN_INPUT", unitPrice: "1", per: "1000" },
            { id: "cached", dimension: "cachedInputTokens", basis: "TOKEN_CACHED_INPUT", unitPrice: "0.1", per: "1000" },
            { id: "cache-write", dimension: "inputTokens", basis: "CACHE_CREATION", unitPrice: "2", per: "1000" },
        ]);
        expect(estimateCreativeSaleCredits({ logicalModel: cached, requestContext: { capability: "text", prompt: "hello", cacheCreationTokens: 100 } })).toMatchObject({
            status: "CONSERVATIVE_ESTIMATE",
            upperBoundCredits: "0.205",
            details: { reasons: expect.arrayContaining(["CACHE_CREATION_BOUND"]) },
        });
        expect(estimateCreativeSaleCredits({ logicalModel: model("audio", [{ id: "call", dimension: "request", basis: "PER_CALL", unitPrice: "2" }]), requestContext: { capability: "audio" } })).toMatchObject({ status: "ESTIMATED", credits: "2" });
        expect(estimateCreativeSaleCredits({ logicalModel: model("video", [{ id: "second", dimension: "durationSeconds", basis: "PER_SECOND", unitPrice: "0.5" }]), requestContext: { capability: "video", durationSeconds: 6 } })).toMatchObject({
            status: "ESTIMATED",
            credits: "3",
        });
        expect(estimateCreativeSaleCredits({ logicalModel: model("audio", [{ id: "generation", dimension: "count", basis: "PER_GENERATION", unitPrice: "1.5" }]), requestContext: { capability: "audio", count: 2 } })).toMatchObject({
            status: "ESTIMATED",
            credits: "3",
        });
    });

    it("partitions every routable model into an observable coverage status and ignores zero-price metadata", () => {
        const binding = { id: "binding", channelId: "channel", upstreamModel: "upstream", enabled: true, priority: 1 };
        const image = {
            ...model("image", [
                { id: "zero-output", dimension: "outputTokens", basis: "TOKEN_OUTPUT", unitPrice: "0", per: "1000" },
                { id: "output", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1" },
            ]),
            bindings: [binding],
        };
        const text = { ...model("text", [{ id: "output", dimension: "outputTokens", basis: "TOKEN_OUTPUT", unitPrice: "1", per: "1000" }]), bindings: [binding] };
        const missing = { ...model("audio"), bindings: [binding] };
        const usageMissing = { ...model("text", [{ id: "tool", dimension: "request", basis: "SERVER_TOOL_CALL", unitPrice: "1" }]), id: "tool-model", bindings: [binding] };

        const coverage = calculateModelEstimatorCoverage([image, text, missing, usageMissing]);
        expect(coverage).toMatchObject({
            totalRoutableModels: 4,
            officialPriceConfigured: 3,
            exactEstimate: 1,
            conservativeEstimate: 1,
            missingOfficialSalePrice: 1,
            unsupportedPricingBasis: 0,
            usageInputMissing: 1,
            reasonBreakdown: {
                FIXED_IMAGE_COUNT: 1,
                MAX_OUTPUT_TOKEN_BOUND: 1,
                MISSING_OFFICIAL_SALE_PRICE: 1,
                SERVER_TOOL_CALL_COUNT_UNKNOWN: 1,
            },
            byCategory: {
                text: { total: 2, exact: 0, conservative: 1, missingOfficialPrice: 0, unsupportedPricingBasis: 0, usageInputMissing: 1 },
                image: { total: 1, exact: 1, conservative: 0, missingOfficialPrice: 0, unsupportedPricingBasis: 0, usageInputMissing: 0 },
                audio: { total: 1, exact: 0, conservative: 0, missingOfficialPrice: 1, unsupportedPricingBasis: 0, usageInputMissing: 0 },
            },
            models: expect.arrayContaining([
                expect.objectContaining({ modelId: "image-model", status: "EXACT", reasons: ["FIXED_IMAGE_COUNT"] }),
                expect.objectContaining({ modelId: "text-model", status: "CONSERVATIVE", reasons: ["MAX_OUTPUT_TOKEN_BOUND"] }),
                expect.objectContaining({ modelId: "audio-model", status: "MISSING_OFFICIAL_PRICE", reasons: ["MISSING_OFFICIAL_SALE_PRICE"] }),
                expect.objectContaining({ modelId: "tool-model", status: "USAGE_INPUT_MISSING", reasons: ["SERVER_TOOL_CALL_COUNT_UNKNOWN"] }),
            ]),
        });
        expect(coverage.exactEstimate + coverage.conservativeEstimate + coverage.missingOfficialSalePrice + coverage.unsupportedPricingBasis + coverage.usageInputMissing).toBe(coverage.totalRoutableModels);
    });
});
