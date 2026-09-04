import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/auth/store";
import { generationDefaultsPanelState } from "./admin-generation-settings";

describe("generation defaults panel behavior", () => {
    it("offers a symmetric exact-size choice and resets stale counts to Auto", () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.logicalModels = [
            {
                id: "image",
                name: "图片",
                capability: "image",
                enabled: true,
                bindings: [
                    {
                        id: "image:one",
                        channelId: "one",
                        upstreamModel: "image",
                        enabled: true,
                        priority: 1,
                        generationParameters: {
                            referenceInputs: [],
                            aspectRatios: [],
                            pixelSizes: ["1920x1080"],
                            supportsCustomSize: false,
                            qualities: ["ultra"],
                            resolutions: [],
                            durationSeconds: [],
                            videoReferenceModes: [],
                            voices: [],
                            formats: [],
                            maxBatchSize: 2,
                        },
                    },
                ],
            },
            {
                id: "video",
                name: "视频",
                capability: "video",
                enabled: true,
                bindings: [
                    {
                        id: "video:one",
                        channelId: "one",
                        upstreamModel: "video",
                        enabled: true,
                        priority: 1,
                        generationParameters: {
                            referenceInputs: [],
                            aspectRatios: [],
                            pixelSizes: [],
                            supportsCustomSize: true,
                            qualities: [],
                            resolutions: ["1080"],
                            durationMode: "discrete",
                            durationSeconds: [5],
                            videoReferenceModes: [],
                            voices: [],
                            formats: [],
                            maxBatchSize: 1,
                        },
                    },
                ],
            },
        ];
        settings.defaultModels = { imageModel: "image", videoModel: "video", textModel: "", audioModel: "", voiceCloneModel: "" };
        settings.generationDefaults = { ...settings.generationDefaults, imageSize: "1920x1080", imageCount: 3, canvasImageCount: 3 };

        expect(generationDefaultsPanelState(settings)).toMatchObject({ imageSizeOptions: expect.arrayContaining([expect.objectContaining({ value: "1920x1080" })]), resets: { imageCount: "auto", canvasImageCount: "auto" } });
    });
});
