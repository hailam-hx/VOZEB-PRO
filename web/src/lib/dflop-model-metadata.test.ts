import { describe, expect, it } from "vitest";

import { mergeDflopGenerationParameters, parseDflopModelMetadata, reconcileDflopUpstreamModelMetadata } from "./dflop-model-metadata";

describe("DFLOP structured model metadata", () => {
    it("retains a structured image quality profile for authoritative binding sync", () => {
        const parsed = parseDflopModelMetadata({
            id: "structured-image",
            category: "image",
            image_quality_profile: {
                version: 1,
                controlType: "request_parameter",
                selectionMode: "explicit",
                options: [
                    { value: "standard", label: "标准", effect: { type: "request_parameter", requestParameter: { name: "quality", value: "standard" } } },
                    { value: "high", label: "高清", effect: { type: "request_parameter", requestParameter: { name: "quality", value: "high" } } },
                ],
                defaultValue: "standard",
            },
        });
        expect(parsed.imageQualityProfile).toMatchObject({ source: "structured_upstream", controlType: "request_parameter", defaultValue: "standard" });
    });

    it.each([
        ["doubao-seedance-2.5", ["480p", "720p", "1080p"], ["480", "720", "1080"], 4, 30],
        ["doubao-seedance-2.5-lite", ["720p", "1080p"], ["720", "1080"], 4, 30],
        ["doubao-seedance-2.0-mini", ["480p", "720p"], ["480", "720"], 4, 15],
    ])("maps %s video capabilities without parsing its description", (id, resolutions, expectedResolutions, min, max) => {
        const parsed = parseDflopModelMetadata({
            id,
            display_name: id === "doubao-seedance-2.5" ? "Seedance 2.5" : id,
            category: "video",
            endpoint_type: "videos_generations",
            description: "unstructured text that must not control capabilities",
            video_ratios: ["16:9", "9:16", "1:1"],
            video_resolutions: resolutions,
            video_duration_min: min,
            video_duration_max: max,
        });

        expect(parsed.displayName).toBe(id === "doubao-seedance-2.5" ? "Seedance 2.5" : id);
        expect(parsed.generationParameters).toMatchObject({
            aspectRatios: ["16:9", "9:16", "1:1"],
            resolutions: expectedResolutions,
            durationMode: "range",
            durationRange: { min, max },
            supportsCustomDuration: true,
            customDurationRange: { min, max },
        });
        expect(parsed.generationParameterSources?.resolutions).toBe("upstream");
    });

    it("applies the exact versioned Seedance 2.5 reference preset and never a name substring match", () => {
        const exact = parseDflopModelMetadata({ id: "doubao-seedance-2.5", category: "video" });
        const lookalike = parseDflopModelMetadata({ id: "custom-seedance-lookalike", category: "video" });

        expect(exact.presetVersion).toBeTruthy();
        expect(exact.generationParameters).toMatchObject({ referenceInputs: ["image", "video", "audio"], maxReferenceImages: 30, videoReferenceModes: ["reference", "first_frame", "first_last"] });
        expect(exact.generationParameterSources?.maxReferenceImages).toBe("preset");
        expect(lookalike.generationParameters).toBeUndefined();
        expect(lookalike.generationParameters?.maxReferenceImages).toBeUndefined();
    });

    it.each([
        ["tvod-kling-expand", { referenceInputs: ["image"], minReferenceImages: 1, maxReferenceImages: 1 }],
        ["doubao-seedream-5-0-pro-260628", { supportsAutoSize: false }],
        ["qwen-image-3.0-pro", { supportsAutoSize: false }],
        ["tvod-midjourney-v7", { maxBatchSize: 1 }],
        ["tvod-midjourney-v8.1", { maxBatchSize: 1 }],
    ])("applies the audited image execution contract for %s", (id, expected) => {
        expect(parseDflopModelMetadata({ id, category: "image" }).generationParameters).toMatchObject(expected);
    });

    it.each(["tvod-midjourney-v7", "tvod-midjourney-v8.1"])("publishes only the documented executable aspect ratios for %s", (id) => {
        const parsed = parseDflopModelMetadata({
            id,
            category: "image",
            image_ratios: ["1:1", "2:3", "3:2", "9:16", "16:9", "3:4", "4:3", "auto"],
        });

        expect(parsed.generationParameters?.aspectRatios).toEqual(["1:1", "9:16", "16:9", "3:4", "4:3"]);
    });

    it.each([
        ["veo-model", "video", "videos_generations", ["720p", "1080p"]],
        ["tvod-kling-video", "video", "videos_generations", ["1080p"]],
    ])("maps model-specific video metadata for %s", (id, category, endpointType, resolutions) => {
        const parsed = parseDflopModelMetadata({ id, category, endpoint_type: endpointType, video_resolutions: resolutions });
        expect(parsed.category).toBe("video");
        expect(parsed.generationParameters?.resolutions).toEqual(resolutions.map((value) => value.replace(/p$/i, "")));
    });

    it("keeps image output count as runtime metadata and preserves structured price metadata", () => {
        const parsed = parseDflopModelMetadata({
            id: "image-model",
            category: "image",
            image_ratios: ["1:1", "16:9"],
            images_per_request: 4,
            price_per_image: 0.08,
            price_per_input_image: 0.02,
            future_unknown_field: { safe: true },
        });

        expect(parsed.generationParameters?.aspectRatios).toEqual(["1:1", "16:9"]);
        expect(parsed.generationParameters?.maxBatchSize).toBeUndefined();
        expect(parsed.runtime?.imagesPerRequest).toBe(4);
        expect(parsed.providerPricingProfile).toMatchObject({
            provider: "dflop",
            status: "READY",
            dimensions: expect.arrayContaining([expect.objectContaining({ kind: "IMAGE_OUTPUT", effectiveValue: "0.08" }), expect.objectContaining({ kind: "IMAGE_INPUT", effectiveValue: "0.02" })]),
        });
    });

    it("stores text runtime metadata and does not create a generation profile", () => {
        const parsed = parseDflopModelMetadata({ id: "writer", category: "text", supported_protocols: ["openai_chat"], context_window: 128000, default_max_tokens: 8192, supports_tools: true });
        expect(parsed.supportedProtocols).toEqual(["openai_chat"]);
        expect(parsed.runtime).toMatchObject({ contextWindow: 128000, defaultMaxTokens: 8192, supportsTools: true });
        expect(parsed.generationParameters).toBeUndefined();
    });

    it("updates upstream-owned fields while preserving manual fields and reporting drift", () => {
        const result = mergeDflopGenerationParameters(
            {
                referenceInputs: [],
                aspectRatios: ["16:9"],
                pixelSizes: [],
                supportsCustomSize: false,
                qualities: [],
                resolutions: ["4k"],
                durationSeconds: [],
                videoReferenceModes: [],
                voices: [],
                formats: [],
            },
            { aspectRatios: "upstream", resolutions: "manual" },
            {
                referenceInputs: [],
                aspectRatios: ["16:9", "9:16"],
                pixelSizes: [],
                supportsCustomSize: false,
                qualities: [],
                resolutions: ["720p", "1080p"],
                durationSeconds: [],
                videoReferenceModes: [],
                voices: [],
                formats: [],
            },
            { aspectRatios: "upstream", resolutions: "upstream" },
        );

        expect(result.parameters.aspectRatios).toEqual(["16:9", "9:16"]);
        expect(result.parameters.resolutions).toEqual(["4k"]);
        expect(result.drifts).toEqual([{ field: "resolutions", local: ["4k"], upstream: ["720p", "1080p"], source: "manual" }]);
        expect(result.manualOverridesPreserved).toBe(1);
    });

    it("force sync overwrites manual fields after explicit confirmation", () => {
        const result = mergeDflopGenerationParameters(
            { referenceInputs: [], aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: ["4k"], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { resolutions: "manual" },
            { referenceInputs: [], aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: ["1080p"], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { resolutions: "upstream" },
            true,
        );
        expect(result.parameters.resolutions).toEqual(["1080"]);
        expect(result.sources.resolutions).toBe("upstream");
        expect(result.drifts).toEqual([]);
    });

    it("removes a capability that disappeared upstream when the field is upstream-managed", () => {
        const result = mergeDflopGenerationParameters(
            { referenceInputs: [], aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: ["720p", "1080p", "4k"], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { resolutions: "upstream" },
            undefined,
            undefined,
        );

        expect(result.parameters.resolutions).toEqual([]);
        expect(result.sources.resolutions).toBeUndefined();
    });

    it("maps description evidence into the existing generation profile without changing structured priority", () => {
        const parsed = parseDflopModelMetadata({
            id: "video-model",
            category: "video",
            description: "支持参考图片，最多30张参考图片，并支持首帧/尾帧。",
            max_reference_images: 20,
        });

        expect(parsed.generationParameters).toMatchObject({ referenceInputs: ["image"], maxReferenceImages: 20, videoReferenceModes: ["first_frame", "first_last"] });
        expect(parsed.generationParameterSources).toMatchObject({ referenceInputs: "description", maxReferenceImages: "upstream", videoReferenceModes: "description" });
        expect(parsed.generationParameterEvidence?.referenceInputs).toContain("参考图片");
        expect(parsed.metadataConflicts).toEqual([{ field: "maxReferenceImages", structured: 20, description: 30, descriptionEvidence: "最多30张参考图片" }]);
    });

    it("preserves a manual value when description inference changes and records evidence", () => {
        const result = mergeDflopGenerationParameters(
            { referenceInputs: [], maxReferenceImages: 20, aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { maxReferenceImages: "manual" },
            { referenceInputs: [], maxReferenceImages: 30, aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { maxReferenceImages: "description" },
            false,
            undefined,
            { maxReferenceImages: "up to 30 reference images" },
        );

        expect(result.parameters.maxReferenceImages).toBe(20);
        expect(result.drifts).toEqual([{ field: "maxReferenceImages", local: 20, upstream: 30, source: "manual", upstreamSource: "description", evidence: "up to 30 reference images" }]);
    });

    it("keeps description-owned values when evidence disappears", () => {
        const result = mergeDflopGenerationParameters(
            { referenceInputs: ["audio"], aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { referenceInputs: "description" },
            undefined,
            undefined,
        );
        expect(result.parameters.referenceInputs).toEqual(["audio"]);
        expect(result.sources.referenceInputs).toBe("description");
        expect(result.descriptionEvidenceMissing).toEqual(["referenceInputs"]);
    });

    it("updates a description-owned limit when the evidence changes", () => {
        const result = mergeDflopGenerationParameters(
            { referenceInputs: ["image"], maxReferenceImages: 10, aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { maxReferenceImages: "description" },
            { referenceInputs: ["image"], maxReferenceImages: 30, aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
            { maxReferenceImages: "description" },
            false,
            { maxReferenceImages: "最多10张参考图片" },
            { maxReferenceImages: "最多30张参考图片" },
        );

        expect(result.parameters.maxReferenceImages).toBe(30);
        expect(result.sources.maxReferenceImages).toBe("description");
        expect(result.evidence.maxReferenceImages).toBe("最多30张参考图片");
    });

    it("retains description capability audit values and marks missing evidence", () => {
        const previous = parseDflopModelMetadata({ id: "video-model", description: "支持参考音频" });
        const incoming = parseDflopModelMetadata({ id: "video-model", description: "能力说明已精简" });
        const reconciled = reconcileDflopUpstreamModelMetadata(previous, incoming);
        expect(reconciled?.descriptionCapabilities?.values.referenceAudio).toBe(true);
        expect(reconciled?.descriptionCapabilities?.sources?.referenceAudio).toBe("description");
        expect(reconciled?.descriptionCapabilities?.evidenceMissing).toContain("referenceAudio");
    });
});
