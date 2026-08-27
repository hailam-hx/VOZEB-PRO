import { describe, expect, it, vi } from "vitest";

import type { AiConfig } from "@/stores/use-config-store";
import {
    checkDramaImageRequest,
    checkDramaProjectSize,
    checkDramaDuration,
    checkDramaVideoRequest,
    checkDramaVideoReferenceMode,
    queueDramaShotsAfterPreflight,
    resolveDramaGenerationCapabilities,
    resolveDramaSmartProjectSize,
    startDramaTaskAfterPreflight,
} from "./drama-generation-capabilities";

const profile = (overrides: Record<string, unknown> = {}) => ({
    referenceInputs: ["image"],
    maxReferenceImages: 4,
    aspectRatios: ["9:16", "16:9"],
    pixelSizes: ["1080x1920"],
    supportsCustomSize: false,
    qualities: ["high"],
    resolutions: ["720"],
    durationMode: "discrete",
    durationSeconds: [5, 10],
    maxBatchSize: 1,
    videoReferenceModes: ["reference", "first_frame", "first_last"],
    voices: [],
    formats: [],
    ...overrides,
});

function config(imageProfiles: Array<Record<string, unknown> | undefined>, videoProfiles: Array<Record<string, unknown> | undefined>): AiConfig {
    return {
        imageModel: "image-default",
        videoModel: "video-default",
        logicalModels: [
            {
                id: "image-default",
                name: "Image",
                capability: "image",
                enabled: true,
                bindings: imageProfiles.map((generationParameters, index) => ({ id: `image-${index}`, channelId: "channel", upstreamModel: `image-${index}`, enabled: true, priority: index, generationParameters })) as never,
            },
            {
                id: "video-default",
                name: "Video",
                capability: "video",
                enabled: true,
                bindings: videoProfiles.map((generationParameters, index) => ({ id: `video-${index}`, channelId: "channel", upstreamModel: `video-${index}`, enabled: true, priority: index, generationParameters })) as never,
            },
        ],
    } as unknown as AiConfig;
}

describe("Short Drama generation capabilities", () => {
    it("intersects default image and video model sizes symmetrically after unioning their bindings", () => {
        const first = resolveDramaGenerationCapabilities(config([profile({ aspectRatios: ["9:16"] }), profile({ aspectRatios: ["16:9"], pixelSizes: ["2048x1080"] })], [profile({ aspectRatios: ["16:9", "1:1"], pixelSizes: ["2048x1080"] })]));
        const reversed = resolveDramaGenerationCapabilities(config([profile({ aspectRatios: ["16:9", "1:1"], pixelSizes: ["2048x1080"] })], [profile({ aspectRatios: ["9:16"] }), profile({ aspectRatios: ["16:9"], pixelSizes: ["2048x1080"] })]));

        expect(first.projectParameters?.aspectRatios).toEqual(["16:9"]);
        expect(first.projectParameters?.pixelSizes).toEqual(["2048x1080"]);
        expect(reversed.projectParameters?.aspectRatios).toEqual(["16:9"]);
        expect(reversed.projectParameters?.pixelSizes).toEqual(["2048x1080"]);
    });

    it("distinguishes missing profiles from configured empty unsupported profiles", () => {
        const missing = resolveDramaGenerationCapabilities(config([undefined], [profile()]));
        const empty = resolveDramaGenerationCapabilities(config([{}], [{}]));

        expect(checkDramaProjectSize(missing, "9:16")).toMatchObject({ compatible: false, reason: "管理员尚未为该模型配置此能力" });
        expect(checkDramaProjectSize(empty, "9:16")).toMatchObject({ compatible: false, field: "aspectRatio" });
    });

    it("accepts listed pixels without custom support and accepts arbitrary positive integer pixels only when both defaults support custom size", () => {
        const listed = resolveDramaGenerationCapabilities(config([profile({ pixelSizes: ["1080x1920"], supportsCustomSize: false })], [profile({ pixelSizes: ["1080x1920"], supportsCustomSize: false })]));
        const custom = resolveDramaGenerationCapabilities(config([profile({ supportsCustomSize: true })], [profile({ supportsCustomSize: true })]));

        expect(checkDramaProjectSize(listed, "1080×1920").compatible).toBe(true);
        expect(checkDramaProjectSize(listed, "1001x777").compatible).toBe(false);
        expect(checkDramaProjectSize(custom, "1001x777").compatible).toBe(true);
        expect(checkDramaProjectSize(custom, "0x777").compatible).toBe(false);
        expect(checkDramaProjectSize(custom, "1001.5x777").compatible).toBe(false);
    });

    it("keeps exact discrete durations and original in-range decimals without clamping", () => {
        const discrete = resolveDramaGenerationCapabilities(config([profile()], [profile({ durationMode: "discrete", durationSeconds: [5, 10] })]));
        const range = resolveDramaGenerationCapabilities(config([profile()], [profile({ durationMode: "range", durationSeconds: [], durationRange: { min: 1.5, max: 6.5 } })]));

        expect(checkDramaVideoRequest(discrete, { size: "16:9", durationSeconds: 6 }).compatible).toBe(false);
        expect(checkDramaVideoRequest(discrete, { size: "16:9", durationSeconds: 10 }).compatible).toBe(true);
        expect(checkDramaVideoRequest(range, { size: "16:9", durationSeconds: 3.75 }).compatible).toBe(true);
        expect(checkDramaVideoRequest(range, { size: "16:9", durationSeconds: 6.51 }).compatible).toBe(false);
        expect(checkDramaDuration(range, 3.75)).toEqual({ compatible: true });
        expect(checkDramaDuration(range, 9.25)).toMatchObject({ compatible: false, field: "durationSeconds" });
    });

    it("accepts custom shot durations inside the explicit range while retaining discrete values", () => {
        const state = resolveDramaGenerationCapabilities(config([profile()], [profile({ durationMode: "discrete", durationSeconds: [4, 15], supportsCustomDuration: true, customDurationRange: { min: 3, max: 20 } })]));

        expect(checkDramaDuration(state, 4)).toEqual({ compatible: true });
        expect(checkDramaDuration(state, 7.5)).toEqual({ compatible: true });
        expect(checkDramaDuration(state, 20.1)).toMatchObject({ compatible: false, field: "durationSeconds" });
    });

    it("validates actual reference mode, count, quality and resolution", () => {
        const state = resolveDramaGenerationCapabilities(config([profile({ maxReferenceImages: 1 })], [profile({ maxReferenceImages: 1, videoReferenceModes: ["first_frame"] })]));

        expect(checkDramaImageRequest(state, { size: "16:9", referenceCount: 2, quality: "high" })).toMatchObject({ compatible: false, field: "referenceCount" });
        expect(checkDramaVideoRequest(state, { size: "16:9", durationSeconds: 5, referenceCount: 1, referenceMode: "first_last" })).toMatchObject({ compatible: false, field: "videoReferenceMode" });
        expect(checkDramaVideoReferenceMode(state, "first_frame")).toEqual({ compatible: true });
        expect(checkDramaVideoReferenceMode(state, "first_last")).toMatchObject({ compatible: false, field: "videoReferenceMode" });
        expect(checkDramaVideoRequest(state, { size: "16:9", durationSeconds: 5, resolution: "1080" })).toMatchObject({ compatible: false, field: "resolution" });
    });

    it("requires one binding to support the whole image or video request", () => {
        const state = resolveDramaGenerationCapabilities(
            config(
                [profile({ aspectRatios: ["16:9"], qualities: ["low"] }), profile({ aspectRatios: ["9:16"], qualities: ["high"] })],
                [profile({ aspectRatios: ["16:9"], resolutions: ["720"] }), profile({ aspectRatios: ["9:16"], resolutions: ["1080"] })],
            ),
        );

        expect(checkDramaImageRequest(state, { size: "16:9", quality: "high" })).toMatchObject({ compatible: false });
        expect(checkDramaVideoRequest(state, { size: "16:9", durationSeconds: 5, resolution: "1080" })).toMatchObject({ compatible: false });
    });

    it("validates the actual single-image batch against maxBatchSize", () => {
        const state = resolveDramaGenerationCapabilities(config([profile({ maxBatchSize: undefined })], [profile()]));

        expect(checkDramaImageRequest(state, { size: "16:9", quality: "high" })).toMatchObject({ compatible: false, field: "batchSize" });
    });

    it("resolves Smart project size from a supported system default then administrator order", () => {
        const state = resolveDramaGenerationCapabilities(config([profile({ aspectRatios: ["16:9", "9:16"] })], [profile({ aspectRatios: ["16:9", "9:16"] })]));

        expect(resolveDramaSmartProjectSize(state, "9:16")).toBe("9:16");
        expect(resolveDramaSmartProjectSize(state, "1:1")).toBe("16:9");
    });

    it("keeps Auto usable when both default models only support custom sizes", () => {
        const customOnly = profile({ aspectRatios: [], pixelSizes: [], supportsCustomSize: true });
        const state = resolveDramaGenerationCapabilities(config([customOnly], [customOnly]));

        expect(checkDramaProjectSize(state, "auto")).toEqual({ compatible: true });
        expect(resolveDramaSmartProjectSize(state, "auto")).toBe("auto");
    });

    it("preserves old values and does not call the queue callback when any shot fails preflight", () => {
        const queue = vi.fn();
        const blocked = queueDramaShotsAfterPreflight(
            [
                { id: "valid", failure: undefined },
                { id: "legacy", failure: { compatible: false as const, field: "durationSeconds" as const, reason: "默认视频模型不支持当前镜头时长" } },
            ],
            queue,
        );

        expect(blocked).toMatchObject({ queued: false, shotId: "legacy" });
        expect(queue).not.toHaveBeenCalled();
    });

    it("does not start a media task side effect when preflight fails", () => {
        const startTask = vi.fn();
        const result = startDramaTaskAfterPreflight({ compatible: false, field: "pixelSize", reason: "默认图片模型不支持当前生成尺寸" }, startTask);

        expect(result).toMatchObject({ started: false, failure: { field: "pixelSize" } });
        expect(startTask).not.toHaveBeenCalled();
    });
});
