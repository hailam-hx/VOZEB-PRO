import { describe, expect, it } from "vitest";

import type { CreativeGenerationPreferences } from "./creative-runtime-contract";
import {
    configuredCreativeGenerationOptions,
    creativeGenerationValueSupported,
    creativeReferenceAdditionAvailability,
    creativeReferenceCapabilityViolation,
    creativeReferenceInputFromMimeType,
    resolveCreativeGenerationCapability,
    sanitizeCreativeGenerationPreferences,
    type CreativeGenerationCapabilityModel,
} from "./creative-generation-capabilities";

describe("creative generation capabilities", () => {
    it("uses a logical model profile for one manual model and intersects multiple manual models", () => {
        const first = model("first", "video", {
            aspectRatios: ["16:9", "9:16"],
            resolutions: ["720", "1080"],
            durationMode: "discrete",
            durationSeconds: [5, 10],
        });
        const second = model("second", "video", {
            aspectRatios: ["16:9", "1:1"],
            resolutions: ["1080"],
            durationMode: "range",
            durationRange: { min: 7.5, max: 12.5 },
        });

        expect(resolveCreativeGenerationCapability({ models: [first, second], selectedModels: [first], capability: "video", smartPlanning: false })).toMatchObject({
            reason: "unsupported",
            parameters: { aspectRatios: ["16:9", "9:16"], resolutions: ["720", "1080"], durationMode: "discrete", durationSeconds: [5, 10] },
        });
        expect(resolveCreativeGenerationCapability({ models: [first, second], selectedModels: [first, second], capability: "video", smartPlanning: false })).toMatchObject({
            reason: "intersection",
            parameters: { aspectRatios: ["16:9"], resolutions: ["1080"], durationMode: "discrete", durationSeconds: [10] },
        });
    });

    it("unions every available model for Smart planning", () => {
        const first = model("first", "image", { aspectRatios: ["1:1"], qualities: ["studio"] });
        const second = model("second", "image", { aspectRatios: ["16:9"], qualities: ["draft"] });
        const audio = model("audio", "audio", { voices: ["nova"] });

        expect(resolveCreativeGenerationCapability({ models: [first, second, audio], selectedModels: [], capability: "image", smartPlanning: true })).toMatchObject({
            reason: "unsupported",
            parameters: { aspectRatios: ["1:1", "16:9"], qualities: ["studio", "draft"] },
        });
    });

    it("unions reference inputs across media models when Smart Agent has no fixed capability", () => {
        const image = model("image", "image", { referenceInputs: ["image"], maxReferenceImages: 4 });
        const video = model("video", "video", { referenceInputs: ["image", "video"] });
        const audio = model("audio", "audio", { referenceInputs: ["audio"] });

        expect(resolveCreativeGenerationCapability({ models: [image, video, audio], selectedModels: [], smartPlanning: true })).toMatchObject({
            reason: "unsupported",
            parameters: { referenceInputs: ["image", "video", "audio"], maxReferenceImages: 4 },
        });
    });

    it("distinguishes unconfigured, configured unsupported, and selected-model intersection misses", () => {
        const unconfigured = model("unconfigured", "image");
        const empty = model("empty", "image", {});
        const square = model("square", "image", { aspectRatios: ["1:1"] });
        const landscape = model("landscape", "image", { aspectRatios: ["16:9"] });

        expect(resolveCreativeGenerationCapability({ models: [unconfigured], selectedModels: [unconfigured], capability: "image", smartPlanning: false }).reason).toBe("unconfigured");
        expect(resolveCreativeGenerationCapability({ models: [empty], selectedModels: [empty], capability: "image", smartPlanning: false }).reason).toBe("unsupported");
        expect(resolveCreativeGenerationCapability({ models: [square, landscape], selectedModels: [square, landscape], capability: "image", smartPlanning: false }).reason).toBe("intersection");
    });

    it("preserves valid preferences and removes invalid concrete values without inventing Auto defaults", () => {
        const preferences: CreativeGenerationPreferences = {
            mode: "video",
            image: { size: "1:1", quality: "studio", count: 2 },
            video: {
                size: "16:9",
                quality: "720",
                seconds: 7.5,
                count: 3,
                referenceMode: "first_last",
                firstFrameAssetId: "first-image",
                lastFrameAssetId: "last-image",
                generateAudio: true,
                watermark: false,
            },
            audio: { voice: "nova", format: "wav", speed: 1.25 },
        };
        const parameters = profile({
            aspectRatios: ["16:9"],
            resolutions: ["720"],
            durationMode: "range",
            durationRange: { min: 7, max: 8 },
            maxBatchSize: 2,
            videoReferenceModes: ["first_last"],
        });

        expect(sanitizeCreativeGenerationPreferences(preferences, "video", parameters)).toEqual({
            ...preferences,
            video: {
                size: "16:9",
                quality: "720",
                seconds: 7.5,
                referenceMode: "first_last",
                firstFrameAssetId: "first-image",
                lastFrameAssetId: "last-image",
                generateAudio: true,
                watermark: false,
            },
        });
        expect(sanitizeCreativeGenerationPreferences({ mode: "image", image: { size: "auto", quality: "auto" } }, "image", parameters)).toEqual({ mode: "image" });
    });

    it("drops video frame roles only when their reference mode becomes invalid", () => {
        const preferences: CreativeGenerationPreferences = {
            mode: "video",
            video: { referenceMode: "first_last", firstFrameAssetId: "first-image", lastFrameAssetId: "last-image" },
        };

        expect(sanitizeCreativeGenerationPreferences(preferences, "video", profile({ videoReferenceModes: ["first_frame"] }))).toEqual({ mode: "video" });
        expect(sanitizeCreativeGenerationPreferences(preferences, "video", profile({ videoReferenceModes: ["first_last"] }))).toEqual(preferences);
    });

    it("sanitizes image and audio values against their exact configured fields", () => {
        const preferences: CreativeGenerationPreferences = {
            mode: "image",
            image: { size: "1024x1024", quality: "studio", count: 3 },
            audio: { voice: "nova", format: "wav", speed: 1.5 },
        };

        const imageSanitized = sanitizeCreativeGenerationPreferences(preferences, "image", profile({ pixelSizes: ["1024x1024"], qualities: ["studio"], maxBatchSize: 2 }));
        expect(imageSanitized).toEqual({ ...preferences, image: { size: "1024x1024", quality: "studio" } });
        expect(sanitizeCreativeGenerationPreferences(imageSanitized, "audio", profile({ voices: ["nova"], formats: ["mp3"], speedRange: { min: 0.5, max: 1 } }))).toEqual({
            mode: "image",
            image: { size: "1024x1024", quality: "studio" },
            audio: { voice: "nova" },
        });
    });

    it("checks discrete and range durations exactly without clamping or rounding", () => {
        const discrete = profile({ durationMode: "discrete", durationSeconds: [5, 7.5] });
        const range = profile({ durationMode: "range", durationRange: { min: 4.5, max: 7.5 } });

        expect(creativeGenerationValueSupported(discrete, "videoDuration", 7.5)).toBe(true);
        expect(creativeGenerationValueSupported(discrete, "videoDuration", 7.5001)).toBe(false);
        expect(creativeGenerationValueSupported(range, "videoDuration", 4.5)).toBe(true);
        expect(creativeGenerationValueSupported(range, "videoDuration", 7.5)).toBe(true);
        expect(creativeGenerationValueSupported(range, "videoDuration", 7.5001)).toBe(false);
    });

    it("preserves custom count and duration preferences only inside their configured ranges", () => {
        const parameters = profile({
            durationMode: "discrete",
            durationSeconds: [4, 15],
            supportsCustomDuration: true,
            customDurationRange: { min: 3, max: 20 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 5, max: 10 },
        });

        expect(creativeGenerationValueSupported(parameters, "videoCount", 7)).toBe(true);
        expect(creativeGenerationValueSupported(parameters, "videoDuration", 7)).toBe(true);
        expect(sanitizeCreativeGenerationPreferences({ mode: "video", video: { count: 7, seconds: 7 } }, "video", parameters)).toEqual({ mode: "video", video: { count: 7, seconds: 7 } });
        expect(sanitizeCreativeGenerationPreferences({ mode: "video", video: { count: 11, seconds: 21 } }, "video", parameters)).toEqual({ mode: "video" });
    });

    it("keeps known options visible and appends configured extra values once", () => {
        expect(configuredCreativeGenerationOptions(["auto", "high", "medium"], ["studio", "high", "ultra"])).toEqual(["auto", "high", "medium", "studio", "ultra"]);
    });

    it("uses the effective capability reason for unsupported reference input types", () => {
        const unconfigured = { reason: "unconfigured" as const };
        const single = { reason: "unsupported" as const, parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 2 }) };
        const intersection = { reason: "intersection" as const, parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 1 }) };

        expect(creativeReferenceAdditionAvailability(unconfigured, [], "image")).toEqual({ supported: false, reason: "unconfigured", field: "input" });
        expect(creativeReferenceAdditionAvailability(single, [], "video")).toEqual({ supported: false, reason: "unsupported", field: "input" });
        expect(creativeReferenceAdditionAvailability(intersection, [], "video")).toEqual({ supported: false, reason: "intersection", field: "input" });
    });

    it("enforces the effective image-reference count without treating video or audio references as images", () => {
        const state = { reason: "intersection" as const, parameters: profile({ referenceInputs: ["image", "video", "audio"], maxReferenceImages: 1 }) };
        const selected = [
            { id: "image-one", type: "image" as const },
            { id: "video-one", type: "video" as const },
        ];

        expect(creativeReferenceAdditionAvailability(state, selected, "image")).toEqual({ supported: false, reason: "intersection", field: "count", maxReferenceImages: 1 });
        expect(creativeReferenceAdditionAvailability(state, selected, "video")).toEqual({ supported: true });
        expect(creativeReferenceAdditionAvailability(state, selected, "audio")).toEqual({ supported: true });
    });

    it("reports stale selected references before submit without deleting them", () => {
        const unsupportedVideo = { reason: "unsupported" as const, parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 1 }) };
        const tooManyImages = { reason: "intersection" as const, parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 1 }) };
        const selected = [
            { id: "stable-video", type: "video" as const },
            { id: "stable-image", type: "image" as const },
        ];

        expect(creativeReferenceCapabilityViolation(unsupportedVideo, selected)).toEqual({ reason: "unsupported", field: "input", type: "video" });
        expect(
            creativeReferenceCapabilityViolation(tooManyImages, [
                { id: "stable-image-one", type: "image" },
                { id: "stable-image-two", type: "image" },
            ]),
        ).toEqual({ reason: "intersection", field: "count", type: "image", maxReferenceImages: 1 });
        expect(selected.map((asset) => asset.id)).toEqual(["stable-video", "stable-image"]);
    });

    it("maps upload and paste MIME types to canonical reference inputs", () => {
        expect(creativeReferenceInputFromMimeType("image/png")).toBe("image");
        expect(creativeReferenceInputFromMimeType("VIDEO/MP4")).toBe("video");
        expect(creativeReferenceInputFromMimeType("audio/wav")).toBe("audio");
        expect(creativeReferenceInputFromMimeType("application/pdf")).toBeUndefined();
    });
});

function model(id: string, capability: CreativeGenerationCapabilityModel["capability"], generationParameters?: Record<string, unknown>): CreativeGenerationCapabilityModel {
    return { id, capability, generationParameters: generationParameters === undefined ? undefined : profile(generationParameters) };
}

function profile(overrides: Record<string, unknown>) {
    return {
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
        ...overrides,
    } as NonNullable<CreativeGenerationCapabilityModel["generationParameters"]>;
}
