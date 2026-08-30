import { describe, expect, it } from "vitest";

import { fullGenerationParametersPreset, generationParametersCompatible, intersectGenerationParameters, normalizeGenerationParameters, unionAvailableGenerationParameters, unionGenerationParameters } from "./generation-parameters";

describe("generation parameters", () => {
    it("builds complete editable presets from every option exposed by VOZEB", () => {
        expect(fullGenerationParametersPreset("image")).toEqual({
            referenceInputs: ["image"],
            maxReferenceImages: 14,
            aspectRatios: ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"],
            pixelSizes: [],
            supportsCustomSize: true,
            qualities: ["high", "medium", "low"],
            resolutions: [],
            durationSeconds: [],
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 1, max: 30 },
            videoReferenceModes: [],
            voices: [],
            formats: [],
        });
        expect(fullGenerationParametersPreset("video")).toEqual({
            referenceInputs: ["image"],
            maxReferenceImages: 9,
            aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
            pixelSizes: [],
            supportsCustomSize: true,
            qualities: [],
            resolutions: ["480", "720", "1080", "2k", "4k"],
            durationMode: "discrete",
            durationSeconds: [5, 15],
            supportsCustomDuration: true,
            customDurationRange: { min: 4, max: 15 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 1, max: 30 },
            videoReferenceModes: ["reference", "first_frame", "first_last"],
            voices: [],
            formats: [],
        });
        expect(fullGenerationParametersPreset("audio")).toEqual({
            referenceInputs: ["audio"],
            aspectRatios: [],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: [],
            durationSeconds: [],
            maxBatchSize: 1,
            videoReferenceModes: [],
            voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"],
            formats: ["mp3", "wav", "opus", "aac", "flac", "pcm"],
            speedRange: { min: 0.25, max: 4 },
        });
        expect(fullGenerationParametersPreset("text")).toBeUndefined();
    });

    it("keeps undefined unconfigured but normalizes any object into the canonical configured profile", () => {
        expect(normalizeGenerationParameters(undefined)).toBeUndefined();
        expect(normalizeGenerationParameters({})).toEqual({
            referenceInputs: [],
            aspectRatios: [],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: [],
            durationSeconds: [],
            videoReferenceModes: [],
            voices: [],
            formats: [],
        });
        expect(
            normalizeGenerationParameters({
                referenceInputs: [" image ", "image", "video", "unknown"],
                maxReferenceImages: 2.9,
                aspectRatios: [" 16:9 ", "16:9", "9:16"],
                pixelSizes: ["1024X768", "1024x768", "bad", "0x12"],
                supportsCustomSize: true,
                qualities: [" high ", "high", "low"],
                resolutions: [" 720P ", "720P", "1080P"],
                durationMode: "discrete",
                durationSeconds: [true, "5", 5, "10"],
                durationRange: { min: 12, max: 6 },
                maxBatchSize: 3.8,
                videoReferenceModes: [" reference ", "first_frame", "reference", "unknown"],
                supportsGenerateAudio: false,
                supportsWatermark: true,
                voices: [" alloy ", "alloy", "nova"],
                formats: [" mp3 ", "mp3", "wav"],
                speedRange: { min: 2, max: 0.5 },
            }),
        ).toEqual({
            referenceInputs: ["image", "video"],
            maxReferenceImages: 2,
            aspectRatios: ["16:9", "9:16"],
            pixelSizes: ["1024x768"],
            supportsCustomSize: true,
            qualities: ["high", "low"],
            resolutions: ["720P", "1080P"],
            durationMode: "discrete",
            durationSeconds: [5, 10],
            maxBatchSize: 3,
            videoReferenceModes: ["reference", "first_frame"],
            voices: ["alloy", "nova"],
            formats: ["mp3", "wav"],
        });
        expect(normalizeGenerationParameters({ durationMode: "list", durationSeconds: [5] })).toMatchObject({ durationSeconds: [] });
        expect(normalizeGenerationParameters({ durationMode: "list", durationSeconds: [5] })).not.toHaveProperty("durationMode");
        expect(normalizeGenerationParameters({ supportsGenerateAudio: true, supportsWatermark: true })).not.toHaveProperty("supportsGenerateAudio");
        expect(normalizeGenerationParameters({ supportsGenerateAudio: true, supportsWatermark: true })).not.toHaveProperty("supportsWatermark");
    });

    it("unions enabled bindings, intersects manual models, and preserves Smart fail-closed semantics", () => {
        const image = {
            enabled: true,
            bindings: [
                { enabled: true, generationParameters: { aspectRatios: ["1:1", "16:9"], qualities: ["low"], durationMode: "discrete", durationSeconds: [5] } },
                { enabled: true, generationParameters: { aspectRatios: ["16:9", "9:16"], qualities: ["high"], durationMode: "discrete", durationSeconds: [10] } },
                { enabled: false, generationParameters: { aspectRatios: ["3:2"] } },
            ],
        };
        const video = {
            enabled: true,
            bindings: [{ enabled: true, generationParameters: { aspectRatios: ["16:9", "9:16"], qualities: ["high"], durationMode: "range", durationRange: { min: 5, max: 10 } } }],
        };

        expect(unionGenerationParameters(image)).toMatchObject({ aspectRatios: ["1:1", "16:9", "9:16"], qualities: ["low", "high"], durationMode: "discrete", durationSeconds: [5, 10] });
        expect(intersectGenerationParameters([image, video])).toMatchObject({ aspectRatios: ["16:9", "9:16"], qualities: ["high"] });
        expect(unionAvailableGenerationParameters([image, video])).toMatchObject({ aspectRatios: ["1:1", "16:9", "9:16"], qualities: ["low", "high"], durationMode: "range", durationRange: { min: 5, max: 10 } });
        expect(unionGenerationParameters({ enabled: true, bindings: [{ enabled: true }] })).toBeUndefined();
        expect(generationParametersCompatible(undefined, {})).toEqual({ compatible: true });
        expect(generationParametersCompatible(undefined, { quality: "high" })).toEqual({ compatible: false, field: "generationParameters" });
    });

    it("matches only exact concrete values, while custom positive integer sizes require explicit support", () => {
        const parameters = normalizeGenerationParameters({
            referenceInputs: ["image"],
            maxReferenceImages: 2,
            aspectRatios: ["16:9"],
            pixelSizes: ["1920x1080"],
            supportsCustomSize: true,
            qualities: ["high"],
            resolutions: ["1080P"],
            durationMode: "discrete",
            durationSeconds: [5, 10],
            maxBatchSize: 2,
            videoReferenceModes: ["first_frame"],
            voices: ["alloy"],
            formats: ["mp3"],
            speedRange: { min: 0.5, max: 2 },
        });

        expect(
            generationParametersCompatible(parameters, {
                referenceInputs: ["image"],
                referenceCount: 2,
                aspectRatio: "16:9",
                pixelSize: "1920x1080",
                quality: "high",
                resolution: "1080P",
                durationSeconds: 5,
                batchSize: 2,
                videoReferenceMode: "first_frame",
                voice: "alloy",
                format: "mp3",
                speed: 1.5,
            }),
        ).toEqual({ compatible: true });
        expect(generationParametersCompatible(parameters, { pixelSize: "1921x1080" })).toEqual({ compatible: true });
        expect(generationParametersCompatible(parameters, { pixelSize: "1921x0" })).toMatchObject({ compatible: false, field: "pixelSize" });
        expect(generationParametersCompatible(parameters, { durationSeconds: 6 })).toMatchObject({ compatible: false, field: "durationSeconds" });
    });

    it("uses inclusive range durations without rounding or clamping", () => {
        const parameters = normalizeGenerationParameters({ durationMode: "range", durationRange: { min: "4.5", max: "7.5" } });

        expect(generationParametersCompatible(parameters, { durationSeconds: 4.5 })).toEqual({ compatible: true });
        expect(generationParametersCompatible(parameters, { durationSeconds: 7.5 })).toEqual({ compatible: true });
        expect(generationParametersCompatible(parameters, { durationSeconds: 4.49 })).toMatchObject({ compatible: false, field: "durationSeconds" });
        expect(generationParametersCompatible(parameters, { durationSeconds: 7.51 })).toMatchObject({ compatible: false, field: "durationSeconds" });
    });

    it("keeps fixed options while allowing explicitly configured custom count and duration ranges", () => {
        const parameters = normalizeGenerationParameters({
            durationMode: "discrete",
            durationSeconds: [4, 15],
            supportsCustomDuration: true,
            customDurationRange: { min: 3, max: 20 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 5, max: 10 },
        });

        expect(parameters).toMatchObject({
            durationMode: "discrete",
            durationSeconds: [4, 15],
            supportsCustomDuration: true,
            customDurationRange: { min: 3, max: 20 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 5, max: 10 },
        });
        expect(generationParametersCompatible(parameters, { durationSeconds: 4, batchSize: 4 })).toEqual({ compatible: true });
        expect(generationParametersCompatible(parameters, { durationSeconds: 7, batchSize: 7 })).toEqual({ compatible: true });
        expect(generationParametersCompatible(parameters, { durationSeconds: 20.1 })).toEqual({ compatible: false, field: "durationSeconds" });
        expect(generationParametersCompatible(parameters, { batchSize: 11 })).toEqual({ compatible: false, field: "batchSize" });
        expect(generationParametersCompatible(normalizeGenerationParameters({ maxBatchSize: 10 }), { batchSize: 4 })).toEqual({ compatible: true });
        expect(generationParametersCompatible(normalizeGenerationParameters({ maxBatchSize: 10 }), { batchSize: 6 })).toEqual({ compatible: false, field: "batchSize" });
    });

    it("unions custom ranges across bindings and intersects them across manually selected models", () => {
        const first = {
            enabled: true,
            bindings: [{ enabled: true, generationParameters: { supportsCustomDuration: true, customDurationRange: { min: 3, max: 12 }, supportsCustomBatchSize: true, customBatchSizeRange: { min: 5, max: 10 } } }],
        };
        const second = {
            enabled: true,
            bindings: [{ enabled: true, generationParameters: { supportsCustomDuration: true, customDurationRange: { min: 8, max: 20 }, supportsCustomBatchSize: true, customBatchSizeRange: { min: 8, max: 12 } } }],
        };

        expect(unionGenerationParameters({ enabled: true, bindings: [...first.bindings, ...second.bindings] })).toMatchObject({
            supportsCustomDuration: true,
            customDurationRange: { min: 3, max: 20 },
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 5, max: 12 },
        });
        expect(intersectGenerationParameters([first, second])).toMatchObject({
            supportsCustomDuration: true,
            customDurationRange: { min: 8, max: 12 },
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 8, max: 10 },
        });
        expect(
            unionGenerationParameters({
                enabled: true,
                bindings: [
                    { enabled: true, generationParameters: { supportsCustomBatchSize: true, customBatchSizeRange: { min: 1, max: 4 } } },
                    { enabled: true, generationParameters: { supportsCustomBatchSize: true, customBatchSizeRange: { min: 5, max: 8 } } },
                ],
            }),
        ).toMatchObject({ supportsCustomBatchSize: true, customBatchSizeRange: { min: 1, max: 8 } });
    });

    it("omits non-continuous unions and never broadens selected-model intersections", () => {
        const discreteAndRange = unionAvailableGenerationParameters([
            { enabled: true, bindings: [{ enabled: true, generationParameters: { durationMode: "discrete", durationSeconds: [5] } }] },
            { enabled: true, bindings: [{ enabled: true, generationParameters: { durationMode: "range", durationRange: { min: 10, max: 15 } } }] },
        ]);
        const disjointDurationRanges = unionAvailableGenerationParameters([
            { enabled: true, bindings: [{ enabled: true, generationParameters: { durationMode: "range", durationRange: { min: 5, max: 10 } } }] },
            { enabled: true, bindings: [{ enabled: true, generationParameters: { durationMode: "range", durationRange: { min: 12, max: 15 } } }] },
        ]);
        const disjointSpeedRanges = unionAvailableGenerationParameters([
            { enabled: true, bindings: [{ enabled: true, generationParameters: { speedRange: { min: 0.5, max: 1 } } }] },
            { enabled: true, bindings: [{ enabled: true, generationParameters: { speedRange: { min: 1.5, max: 2 } } }] },
        ]);
        const selected = intersectGenerationParameters([
            { enabled: true, bindings: [{ enabled: true, generationParameters: { durationMode: "range", durationRange: { min: 5, max: 10 } } }] },
            { enabled: true, bindings: [{ enabled: true, generationParameters: { durationMode: "discrete", durationSeconds: [5, 10] } }] },
        ]);

        expect(discreteAndRange).not.toHaveProperty("durationMode");
        expect(disjointDurationRanges).not.toHaveProperty("durationMode");
        expect(disjointSpeedRanges).not.toHaveProperty("speedRange");
        expect(generationParametersCompatible(discreteAndRange, { durationSeconds: 11 })).toMatchObject({ compatible: false, field: "durationSeconds" });
        expect(generationParametersCompatible(disjointDurationRanges, { durationSeconds: 11 })).toMatchObject({ compatible: false, field: "durationSeconds" });
        expect(generationParametersCompatible(disjointSpeedRanges, { speed: 1.25 })).toMatchObject({ compatible: false, field: "speed" });
        expect(generationParametersCompatible(selected, { durationSeconds: 5 })).toEqual({ compatible: true });
        expect(generationParametersCompatible(selected, { durationSeconds: 7 })).toMatchObject({ compatible: false, field: "durationSeconds" });
    });
});
