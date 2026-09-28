import { describe, expect, it } from "vitest";

import type { AiConfig } from "@/stores/use-config-store";

import { estimateCreativeCredits } from "./creative-credit-estimate";

const config = {
    apiSource: "system",
    size: "1:1",
    quality: "auto",
    videoSeconds: "5",
    vquality: "720",
    audioFormat: "mp3",
    logicalModels: [
        {
            id: "image-pro",
            name: "Image Pro",
            capability: "image",
            enabled: true,
            saleRateCard: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "2" }] },
            bindings: [],
        },
        {
            id: "video-pro",
            name: "Video Pro",
            capability: "video",
            enabled: true,
            saleRateCard: { version: 1, components: [{ id: "duration", dimension: "durationSeconds", unitPrice: "0.5", when: { quality: "1080", resolution: "1080" } }] },
            bindings: [],
        },
    ],
} satisfies Pick<AiConfig, "apiSource" | "size" | "quality" | "videoSeconds" | "vquality" | "audioFormat" | "logicalModels">;

describe("estimateCreativeCredits", () => {
    it("uses the public normalized quality profile for Midjourney fixed four-output pricing", () => {
        const imageQualityProfile = {
            supported: true,
            controlType: "prompt_flag" as const,
            selectionMode: "explicit" as const,
            profileRevision: "profile-mj",
            billableOutputCount: 4,
            defaultValue: "high",
            options: [
                { value: "standard", label: "标准", optionRevision: "standard-v1", effect: { type: "prompt_flag" as const, promptSuffix: "--sd" as const } },
                { value: "high", label: "高清", optionRevision: "high-v1", effect: { type: "prompt_flag" as const, promptSuffix: "--hd" as const } },
            ],
        };
        const imageModel = { ...config.logicalModels[0], imageQualityProfile };
        expect(
            estimateCreativeCredits({
                config: { ...config, logicalModels: [imageModel] },
                prompt: "cat",
                smartPlanning: false,
                selectedModels: [{ id: "image-pro", name: "Image Pro", capability: "image", imageQualityProfile }],
                preferences: { image: { quality: "high", qualityProfileRevision: "profile-mj", qualityOptionRevision: "high-v1" } },
            }),
        ).toMatchObject({ status: "ESTIMATED", credits: "8" });
    });

    it("sums every manually selected model and multiplies each task copy", () => {
        expect(
            estimateCreativeCredits({
                config,
                prompt: "生成一套发布素材",
                smartPlanning: false,
                selectedModels: [
                    { id: "image-pro", name: "Image Pro", capability: "image" },
                    { id: "video-pro", name: "Video Pro", capability: "video" },
                ],
                preferences: {
                    image: { count: 3 },
                    video: { count: 2, quality: "1080", seconds: 10 },
                },
            }),
        ).toMatchObject({ status: "ESTIMATED", credits: "16" });
    });

    it("defers the amount while smart planning still controls the model and task count", () => {
        expect(estimateCreativeCredits({ config, prompt: "生成一张海报", smartPlanning: true, selectedModels: [], preferences: {} })).toEqual({ status: "PLANNING" });
    });

    it("does not present a missing or incomplete sale price as a free request", () => {
        const missingPriceConfig = { ...config, logicalModels: [{ ...config.logicalModels[0], saleRateCard: undefined }] };
        const incompletePriceConfig = {
            ...config,
            logicalModels: [{ ...config.logicalModels[0], saleRateCard: { version: 1 as const, components: [{ id: "format", dimension: "format" as const, match: "png", unitPrice: "2" }] } }],
        };
        const input = { prompt: "生成图片", smartPlanning: false, selectedModels: [{ id: "image-pro", name: "Image Pro", capability: "image" as const }], preferences: {} };

        expect(estimateCreativeCredits({ ...input, config: missingPriceConfig })).toMatchObject({ status: "OFFICIAL_SALE_PRICE_MISSING" });
        expect(estimateCreativeCredits({ ...input, config: incompletePriceConfig })).toMatchObject({ status: "PRICING_DIMENSION_MISSING" });
    });

    it("matches DFLOP video resolution pricing when the create UI stores 480P as 480", () => {
        const dflopConfig = {
            ...config,
            logicalModels: [
                {
                    ...config.logicalModels[1],
                    id: "video-pro",
                    saleRateCard: {
                        version: 1 as const,
                        components: [{ id: "480p-second", dimension: "durationSeconds" as const, unitPrice: "0.0693036", when: { resolution: "480p" } }],
                    },
                },
            ],
        };

        expect(
            estimateCreativeCredits({
                config: dflopConfig,
                prompt: "生成视频",
                smartPlanning: false,
                selectedModels: [{ id: "video-pro", name: "Video Pro", capability: "video" }],
                preferences: { video: { count: 1, quality: "480", seconds: 5 } },
            }),
        ).toMatchObject({ status: "ESTIMATED", credits: "0.346518" });
    });

    it("keeps an explicitly free sale price visible as zero credits", () => {
        const freeConfig = {
            ...config,
            logicalModels: [{ ...config.logicalModels[0], saleRateCard: { version: 1 as const, components: [{ id: "request", dimension: "request" as const, unitPrice: "0" }] } }],
        };

        expect(
            estimateCreativeCredits({
                config: freeConfig,
                prompt: "生成图片",
                smartPlanning: false,
                selectedModels: [{ id: "image-pro", name: "Image Pro", capability: "image" }],
                preferences: {},
            }),
        ).toMatchObject({ status: "ESTIMATED", credits: "0" });
    });

    it("uses the approved Seedance 2.0 token tier for a 720p five-second estimate", () => {
        const tokenConfig = {
            ...config,
            logicalModels: [
                {
                    ...config.logicalModels[1],
                    id: "doubao-seedance-2.0",
                    saleRateCard: {
                        version: 1 as const,
                        components: [
                            { id: "input", dimension: "inputTokens" as const, unitPrice: "0", per: "1000000" },
                            { id: "cached-input", dimension: "cachedInputTokens" as const, unitPrice: "0", per: "1000000" },
                            { id: "default-720", dimension: "outputTokens" as const, unitPrice: "6.9", per: "1000000", when: { billingBasis: "default", resolution: "720p" } },
                            { id: "video-720", dimension: "outputTokens" as const, unitPrice: "4.2", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } },
                        ],
                        revision: "approved-seedance-2.0",
                    },
                },
            ],
        };
        const input = {
            config: tokenConfig,
            prompt: "生成视频",
            smartPlanning: false,
            selectedModels: [
                {
                    id: "doubao-seedance-2.0",
                    name: "Seedance 2.0",
                    capability: "video" as const,
                    generationParameters: {
                        referenceInputs: ["video" as const],
                        aspectRatios: ["16:9", "21:9"],
                        pixelSizes: [],
                        supportsCustomSize: false,
                        qualities: [],
                        resolutions: ["720"],
                        durationSeconds: [5],
                        videoReferenceModes: ["reference" as const],
                        voices: [],
                        formats: [],
                    },
                },
            ],
            preferences: { video: { size: "16:9", quality: "720", seconds: 5 } },
        };

        expect(estimateCreativeCredits(input)).toMatchObject({ status: "ESTIMATED", credits: "0.7452", details: { billingBasis: "default", resolution: "720p", estimatedTokens: "108000", saleRateCardRevision: expect.stringContaining("rate-card-v1:") } });
        expect(
            estimateCreativeCredits({
                ...input,
                referenceVideos: [
                    {
                        id: "video-one",
                        userId: "user-one",
                        conversationId: "conversation-one",
                        ordinal: 0,
                        type: "video",
                        status: "ready",
                        title: "reference",
                        durationMs: 10_000,
                        metadata: { mediaProbe: { status: "verified", source: "ffprobe" } },
                        createdAt: 1,
                        updatedAt: 1,
                    },
                ],
            }),
        ).toMatchObject({ status: "ESTIMATED", credits: "1.3608", details: { billingBasis: "with_video_input", inputVideoDurationSeconds: "10", estimatedTokens: "324000" } });
        expect(
            estimateCreativeCredits({ ...input, referenceVideos: [{ id: "video-one", userId: "user-one", conversationId: "conversation-one", ordinal: 0, type: "video", status: "ready", title: "reference", metadata: {}, createdAt: 1, updatedAt: 1 }] }),
        ).toMatchObject({ status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: "1.8144", details: { billingBasis: "with_video_input", inputVideoDurationSeconds: "15", estimatedTokens: "432000" } });
    });

    it("uses the 30-second Seedance 2.5 ceiling when reference duration is unknown", () => {
        const model = {
            ...config.logicalModels[1],
            id: "doubao-seedance-2.5",
            saleRateCard: { version: 1 as const, revision: "approved-2.5", components: [{ id: "video-720", dimension: "outputTokens" as const, unitPrice: "2.52", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } }] },
        };
        const result = estimateCreativeCredits({
            config: { ...config, logicalModels: [model] },
            prompt: "生成视频",
            smartPlanning: false,
            selectedModels: [
                {
                    id: model.id,
                    name: "Seedance 2.5",
                    capability: "video",
                    generationParameters: {
                        referenceInputs: ["video"],
                        aspectRatios: ["16:9"],
                        pixelSizes: [],
                        supportsCustomSize: false,
                        qualities: [],
                        resolutions: ["720"],
                        durationSeconds: [5],
                        videoReferenceModes: ["reference"],
                        voices: [],
                        formats: [],
                    },
                },
            ],
            preferences: { video: { size: "16:9", quality: "720", seconds: 5 } },
            referenceVideos: [{ id: "draft", userId: "user", conversationId: "draft", ordinal: 0, type: "video", status: "ready", title: "local", metadata: {}, createdAt: 1, updatedAt: 1 }],
        });

        expect(result).toMatchObject({ status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: "1.90512", details: { inputVideoDurationSeconds: "30", estimatedTokens: "756000" } });
    });

    it("adds the Seedance Lite second-stage sale component using output duration only", () => {
        const model = {
            ...config.logicalModels[1],
            id: "doubao-seedance-2.0-lite",
            saleRateCard: {
                version: 1 as const,
                revision: "approved-lite",
                components: [
                    { id: "token", dimension: "outputTokens" as const, unitPrice: "4", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } },
                    { id: "stage", dimension: "durationSeconds" as const, unitPrice: "0.25", per: "1", when: { resolution: "720p" } },
                ],
            },
        };
        const result = estimateCreativeCredits({
            config: { ...config, logicalModels: [model] },
            prompt: "生成视频",
            smartPlanning: false,
            selectedModels: [
                {
                    id: model.id,
                    name: "Seedance Lite",
                    capability: "video",
                    generationParameters: {
                        referenceInputs: ["video"],
                        aspectRatios: ["16:9"],
                        pixelSizes: [],
                        supportsCustomSize: false,
                        qualities: [],
                        resolutions: ["720"],
                        durationSeconds: [5],
                        videoReferenceModes: ["reference"],
                        voices: [],
                        formats: [],
                    },
                },
            ],
            preferences: { video: { size: "16:9", quality: "720", seconds: 5 } },
            referenceVideos: [
                { id: "verified", userId: "user", conversationId: "one", ordinal: 0, type: "video", status: "ready", title: "ref", durationMs: 10_000, metadata: { mediaProbe: { status: "verified", source: "ffprobe" } }, createdAt: 1, updatedAt: 1 },
            ],
        });

        expect(result).toMatchObject({ status: "ESTIMATED", credits: "2.546", details: { estimatedTokens: "324000", outputDurationSeconds: "5" } });
    });

    it("reports a missing formal tier instead of presenting zero", () => {
        const model = {
            ...config.logicalModels[1],
            id: "doubao-seedance-2.0",
            saleRateCard: { version: 1 as const, components: [{ id: "default-1080", dimension: "outputTokens" as const, unitPrice: "7.65", per: "1000000", when: { billingBasis: "default", resolution: "1080p" } }] },
        };
        expect(
            estimateCreativeCredits({
                config: { ...config, logicalModels: [model] },
                prompt: "生成视频",
                smartPlanning: false,
                selectedModels: [{ id: model.id, name: "Seedance 2.0", capability: "video" }],
                preferences: { video: { size: "16:9", quality: "720", seconds: 5 } },
            }),
        ).toMatchObject({ status: "PRICING_DIMENSION_MISSING" });
    });
});
