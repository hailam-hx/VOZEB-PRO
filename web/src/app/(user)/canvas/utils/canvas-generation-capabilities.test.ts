import { describe, expect, it } from "vitest";

import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import type { CreativeGenerationCapabilityModel } from "@/lib/creative-generation-capabilities";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

import { canvasGenerationPreflight, resolveCanvasAgentGenerationCapability, resolveCanvasGenerationCapability } from "./canvas-generation-capabilities";

describe("Canvas generation capabilities", () => {
    it("uses the selected logical model binding union and distinguishes an unconfigured model", () => {
        const config = canvasConfig([logicalModel("image-union", "image", [profile({ aspectRatios: ["1:1"], qualities: ["draft"] }), profile({ aspectRatios: ["16:9"], qualities: ["studio"] })]), logicalModel("image-unconfigured", "image", [undefined])]);

        expect(resolveCanvasGenerationCapability(config, "image", "image-union")).toMatchObject({
            reason: "unsupported",
            parameters: { aspectRatios: ["1:1", "16:9"], qualities: ["draft", "studio"] },
        });
        expect(resolveCanvasGenerationCapability(config, "image", "image-unconfigured")).toEqual({ reason: "unconfigured" });
    });

    it("uses a Smart union and a manual multi-model intersection for Canvas Agent", () => {
        const first = agentModel("first", "image", profile({ aspectRatios: ["1:1", "16:9"], qualities: ["draft", "studio"] }));
        const second = agentModel("second", "image", profile({ aspectRatios: ["16:9", "9:16"], qualities: ["studio"] }));

        expect(resolveCanvasAgentGenerationCapability([first, second], [first, second], "image", true)).toMatchObject({
            reason: "unsupported",
            parameters: { aspectRatios: ["1:1", "16:9", "9:16"], qualities: ["draft", "studio"] },
        });
        expect(resolveCanvasAgentGenerationCapability([first, second], [first, second], "image", false)).toMatchObject({
            reason: "intersection",
            parameters: { aspectRatios: ["16:9"], qualities: ["studio"] },
        });
    });
});

describe("canvasGenerationPreflight", () => {
    it("maps image ratio, quality, count and actual image references without inventing other inputs", () => {
        const result = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unsupported", parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 2, aspectRatios: ["16:9"], qualities: ["studio"], maxBatchSize: 3 }) },
            config: { ...defaultConfig, size: "16:9", quality: "studio", count: "3" },
            references: [{ type: "image" }, { type: "image" }],
        });

        expect(result).toEqual({
            compatible: true,
            request: { referenceInputs: ["image"], referenceCount: 2, aspectRatio: "16:9", quality: "studio", batchSize: 3 },
        });
    });

    it("preserves an arbitrary positive custom image size and never applies a platform maximum", () => {
        const supported = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unsupported", parameters: profile({ supportsCustomSize: true }) },
            config: { ...defaultConfig, size: "4097x17", quality: "auto", count: "auto" },
        });
        const unsupported = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unsupported", parameters: profile({ supportsCustomSize: false }) },
            config: { ...defaultConfig, size: "4097x17", quality: "auto", count: "auto" },
        });

        expect(supported).toEqual({ compatible: true, request: { pixelSize: "4097x17" } });
        expect(unsupported).toMatchObject({ compatible: false, request: { pixelSize: "4097x17" }, issue: { reason: "unsupported", field: "pixelSize", value: "4097x17" } });
    });

    it("validates video discrete values exactly and maps reference mode and inputs", () => {
        const capability = {
            reason: "unsupported" as const,
            parameters: profile({
                referenceInputs: ["image", "video", "audio"],
                maxReferenceImages: 2,
                pixelSizes: ["1920x1080"],
                resolutions: ["1080"],
                durationMode: "discrete",
                durationSeconds: [5, 7.5],
                videoReferenceModes: ["first_last"],
            }),
        };
        const result = canvasGenerationPreflight({
            mode: "video",
            capability,
            config: { ...defaultConfig, size: "1920x1080", vquality: "1080", videoSeconds: "7.5", videoGenerateAudio: "false", videoWatermark: "true" },
            references: [{ type: "image" }, { type: "image" }, { type: "video" }, { type: "audio" }],
            videoReferenceMode: "first_last",
        });

        expect(result).toEqual({
            compatible: true,
            request: {
                referenceInputs: ["image", "video", "audio"],
                referenceCount: 2,
                pixelSize: "1920x1080",
                resolution: "1080",
                durationSeconds: 7.5,
                videoReferenceMode: "first_last",
            },
        });
        expect(
            canvasGenerationPreflight({
                mode: "video",
                capability,
                config: { ...defaultConfig, size: "1920x1080", vquality: "1080", videoSeconds: "7.49", videoGenerateAudio: "false", videoWatermark: "true" },
                videoReferenceMode: "first_last",
            }),
        ).toMatchObject({ compatible: false, issue: { field: "durationSeconds", value: 7.49 } });
    });

    it("accepts original fractional duration and speed values only inside configured ranges", () => {
        const video = canvasGenerationPreflight({
            mode: "video",
            capability: { reason: "unsupported", parameters: profile({ durationMode: "range", durationRange: { min: 4.5, max: 7.5 } }) },
            config: { ...defaultConfig, size: "auto", vquality: "auto", videoSeconds: "4.75", videoGenerateAudio: "auto", videoWatermark: "auto" },
        });
        const audio = canvasGenerationPreflight({
            mode: "audio",
            capability: { reason: "unsupported", parameters: profile({ voices: ["narrator"], formats: ["flac"], speedRange: { min: 0.75, max: 1.25 } }) },
            config: { ...defaultConfig, audioVoice: "narrator", audioFormat: "flac", audioSpeed: "1.125" },
        });

        expect(video).toEqual({ compatible: true, request: { durationSeconds: 4.75 } });
        expect(audio).toEqual({ compatible: true, request: { voice: "narrator", format: "flac", speed: 1.125 } });
    });

    it("accepts configured custom count and duration values without replacing the fixed options", () => {
        const image = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unsupported", parameters: profile({ maxBatchSize: 4, supportsCustomBatchSize: true, customBatchSizeRange: { min: 5, max: 10 } }) },
            config: { ...defaultConfig, size: "auto", quality: "auto", count: "7" },
        });
        const video = canvasGenerationPreflight({
            mode: "video",
            capability: {
                reason: "unsupported",
                parameters: profile({ durationMode: "discrete", durationSeconds: [4, 15], supportsCustomDuration: true, customDurationRange: { min: 3, max: 20 } }),
            },
            config: { ...defaultConfig, size: "auto", vquality: "auto", videoSeconds: "7" },
        });

        expect(image).toEqual({ compatible: true, request: { batchSize: 7 } });
        expect(video).toEqual({ compatible: true, request: { durationSeconds: 7 } });
    });

    it("reports missing administrator configuration separately from configured-but-unsupported values", () => {
        const unconfigured = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unconfigured" },
            config: { ...defaultConfig, size: "1:1", quality: "auto", count: "auto" },
        });
        const unsupported = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unsupported", parameters: profile() },
            config: { ...defaultConfig, size: "1:1", quality: "auto", count: "auto" },
        });
        const autoOnly = canvasGenerationPreflight({
            mode: "image",
            capability: { reason: "unconfigured" },
            config: { ...defaultConfig, size: "auto", quality: "auto", count: "auto" },
        });

        expect(unconfigured).toMatchObject({ compatible: false, issue: { reason: "unconfigured", field: "generationParameters" } });
        expect(unsupported).toMatchObject({ compatible: false, issue: { reason: "unsupported", field: "aspectRatio", value: "1:1" } });
        expect(autoOnly).toEqual({ compatible: true, request: {} });
    });
});

function canvasConfig(logicalModels: AiConfig["logicalModels"]): AiConfig {
    return {
        ...defaultConfig,
        logicalModels,
        models: logicalModels.map((model) => model.id),
        imageModels: logicalModels.filter((model) => model.capability === "image").map((model) => model.id),
        videoModels: logicalModels.filter((model) => model.capability === "video").map((model) => model.id),
        audioModels: logicalModels.filter((model) => model.capability === "audio").map((model) => model.id),
    };
}

function logicalModel(id: string, capability: "image" | "video" | "audio", profiles: Array<LogicalModelGenerationParameters | undefined>): AiConfig["logicalModels"][number] {
    return {
        id,
        name: id,
        capability,
        enabled: true,
        bindings: profiles.map((generationParameters, index) => ({ id: `${id}-${index}`, channelId: "channel", upstreamModel: `${id}-${index}`, enabled: true, priority: index, generationParameters })),
    };
}

function agentModel(id: string, capability: "image" | "video" | "audio", generationParameters?: LogicalModelGenerationParameters): CreativeGenerationCapabilityModel {
    return { id, capability, generationParameters };
}

function profile(overrides: Partial<LogicalModelGenerationParameters> = {}): LogicalModelGenerationParameters {
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
    };
}
