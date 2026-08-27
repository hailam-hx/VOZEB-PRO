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
        ).toEqual({ status: "ready", credits: "16" });
    });

    it("defers the amount while smart planning still controls the model and task count", () => {
        expect(estimateCreativeCredits({ config, prompt: "生成一张海报", smartPlanning: true, selectedModels: [], preferences: {} })).toEqual({ status: "planning" });
    });

    it("does not present a missing or incomplete sale price as a free request", () => {
        const missingPriceConfig = { ...config, logicalModels: [{ ...config.logicalModels[0], saleRateCard: undefined }] };
        const incompletePriceConfig = {
            ...config,
            logicalModels: [{ ...config.logicalModels[0], saleRateCard: { version: 1 as const, components: [{ id: "format", dimension: "format" as const, match: "png", unitPrice: "2" }] } }],
        };
        const input = { prompt: "生成图片", smartPlanning: false, selectedModels: [{ id: "image-pro", name: "Image Pro", capability: "image" as const }], preferences: {} };

        expect(estimateCreativeCredits({ ...input, config: missingPriceConfig })).toEqual({ status: "unavailable" });
        expect(estimateCreativeCredits({ ...input, config: incompletePriceConfig })).toEqual({ status: "unavailable" });
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
        ).toEqual({ status: "ready", credits: "0" });
    });
});
