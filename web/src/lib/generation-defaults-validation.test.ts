import { describe, expect, it } from "vitest";

import type { LogicalModelGenerationParameters } from "@/lib/auth/store";
import { generationDefaultImageSizeOptions, generationDefaultsValidationError, generationParametersStatus, resetIncompatibleGenerationDefaults } from "./generation-defaults-validation";

const image = (generationParameters: Record<string, unknown> | undefined) => ({
    id: "image",
    name: "图片",
    capability: "image" as const,
    enabled: true,
    bindings: [{ id: "image:one", channelId: "one", upstreamModel: "image", enabled: true, priority: 1, generationParameters: generationParameters as LogicalModelGenerationParameters | undefined }],
});
const video = (generationParameters: Record<string, unknown> | undefined) => ({
    id: "video",
    name: "视频",
    capability: "video" as const,
    enabled: true,
    bindings: [{ id: "video:one", channelId: "one", upstreamModel: "video", enabled: true, priority: 1, generationParameters: generationParameters as LogicalModelGenerationParameters | undefined }],
});
const audio = (generationParameters: Record<string, unknown> | undefined) => ({
    id: "audio",
    name: "音频",
    capability: "audio" as const,
    enabled: true,
    bindings: [{ id: "audio:one", channelId: "one", upstreamModel: "audio", enabled: true, priority: 1, generationParameters: generationParameters as LogicalModelGenerationParameters | undefined }],
});

const profiles = {
    image: { aspectRatios: ["1:1", "16:9"], pixelSizes: ["1024x1024"], qualities: ["high"], maxBatchSize: 2 },
    video: { aspectRatios: ["1:1"], pixelSizes: ["1024x1024"], resolutions: ["1080"], durationMode: "discrete", durationSeconds: [5, 10], maxBatchSize: 1 },
    audio: { voices: ["alloy"], formats: ["mp3"], speedRange: { min: 0.75, max: 1.25 } },
};

const settings = (generationDefaults = {}) => ({
    logicalModels: [image(profiles.image), video(profiles.video), audio(profiles.audio)],
    defaultModels: { imageModel: "image", videoModel: "video", textModel: "", audioModel: "audio", voiceCloneModel: "" },
    generationDefaults: { createPromptMaxLength: 4000, canvasImageCount: 1, imageCount: 1, imageSize: "auto", imageQuality: "auto", videoQuality: "auto", videoSeconds: -1, audioVoice: "auto", audioFormat: "auto", ...generationDefaults },
});

describe("generation-default capability validation", () => {
    it("reports unconfigured, incomplete, and configured profiles by media capability", () => {
        expect(generationParametersStatus("image", undefined)).toEqual({ state: "unconfigured", label: "能力档案未配置" });
        expect(generationParametersStatus("image", { qualities: ["high"], maxBatchSize: 1 })).toEqual({ state: "incomplete", label: "能力档案未完成" });
        expect(generationParametersStatus("video", profiles.video)).toEqual({ state: "configured", label: "已配置" });
        expect(generationParametersStatus("audio", profiles.audio)).toEqual({ state: "configured", label: "已配置" });
        expect(generationParametersStatus("video", { ...profiles.video, supportsCustomDuration: true })).toEqual({ state: "incomplete", label: "能力档案未完成" });
        expect(generationParametersStatus("image", { ...profiles.image, supportsCustomBatchSize: true })).toEqual({ state: "incomplete", label: "能力档案未完成" });
    });

    it("treats clone bindings separately from static and provider speech profiles", () => {
        expect(generationParametersStatus("audio", { audioOperation: "voice-clone" })).toEqual({ state: "configured", label: "已配置" });
        expect(generationParametersStatus("audio", { audioOperation: "speech", voiceCatalog: "provider", formats: ["mp3"], maxCharacters: 5000 })).toEqual({ state: "configured", label: "已配置" });
        expect(generationParametersStatus("audio", { audioOperation: "speech", voiceCatalog: "static", formats: ["mp3"] })).toEqual({ state: "incomplete", label: "能力档案未完成" });
    });

    it("requires a positive image-reference limit when image references are enabled", () => {
        expect(generationParametersStatus("video", { ...profiles.video, referenceInputs: ["image"] })).toEqual({ state: "incomplete", label: "能力档案未完成" });
        expect(generationParametersStatus("video", { ...profiles.video, referenceInputs: ["image"], maxReferenceImages: 1 })).toEqual({ state: "configured", label: "已配置" });
    });

    it("accepts Auto defaults and validates image size across image and video defaults", () => {
        expect(generationDefaultsValidationError(settings())).toBeUndefined();
        expect(generationDefaultsValidationError(settings({ imageSize: "1:1", imageQuality: "high", videoQuality: "1080", videoSeconds: 5, audioVoice: "alloy", audioFormat: "mp3" }))).toBeUndefined();
        expect(generationDefaultsValidationError(settings({ imageSize: "16:9" }))).toBe("默认图片/视频比例不受当前默认模型支持");
        expect(generationDefaultsValidationError(settings({ imageSize: "1024x1024" }))).toBeUndefined();
    });

    it("requires the creative prompt limit to be a positive safe integer", () => {
        expect(generationDefaultsValidationError(settings({ createPromptMaxLength: 12 }), ["createPromptMaxLength"])).toBeUndefined();
        expect(generationDefaultsValidationError(settings({ createPromptMaxLength: 0 }), ["createPromptMaxLength"])).toBe("创作输入字符上限必须是正整数");
        expect(generationDefaultsValidationError(settings({ createPromptMaxLength: 12.5 }), ["createPromptMaxLength"])).toBe("创作输入字符上限必须是正整数");
    });

    it("rejects concrete defaults that the effective model capability cannot execute", () => {
        expect(generationDefaultsValidationError(settings({ imageQuality: "low" }))).toBe("默认图片质量不受当前默认图片模型支持");
        expect(generationDefaultsValidationError(settings({ imageCount: 3 }))).toBe("默认图片数量不受当前默认图片模型支持");
        expect(generationDefaultsValidationError(settings({ videoQuality: "720" }))).toBe("默认视频清晰度不受当前默认视频模型支持");
        expect(generationDefaultsValidationError(settings({ videoSeconds: 7 }))).toBe("默认视频秒数不受当前默认视频模型支持");
        expect(generationDefaultsValidationError(settings({ audioVoice: "nova" }))).toBe("默认音频音色不受当前默认音频模型支持");
        expect(generationDefaultsValidationError(settings({ audioFormat: "wav" }))).toBe("默认音频格式不受当前默认音频模型支持");
    });

    it("resets only stale concrete values to Auto when capability or defaults change", () => {
        expect(resetIncompatibleGenerationDefaults(settings({ imageSize: "16:9", imageQuality: "low", videoQuality: "720", videoSeconds: 7, audioVoice: "nova", audioFormat: "wav" }))).toMatchObject({
            imageSize: "auto",
            imageQuality: "auto",
            videoQuality: "auto",
            videoSeconds: -1,
            audioVoice: "auto",
            audioFormat: "auto",
        });
    });

    it("requires an effective profile for concrete defaults and resets both image counts", () => {
        const unavailable = settings({ canvasImageCount: 3, imageCount: 3, imageQuality: "high" });
        unavailable.logicalModels = [];
        expect(generationDefaultsValidationError(unavailable, ["imageQuality"])).toBe("默认图片质量不受当前默认图片模型支持");
        expect(resetIncompatibleGenerationDefaults(unavailable)).toMatchObject({ canvasImageCount: "auto", imageCount: "auto", imageQuality: "auto" });
    });

    it("accepts an exact size when either default explicitly lists it and the other supports custom size", () => {
        const forward = settings({ imageSize: "1920x1080" });
        forward.logicalModels[0] = image({ ...profiles.image, supportsCustomSize: true });
        forward.logicalModels[1] = video({ ...profiles.video, pixelSizes: ["1920x1080"] });
        const reverse = settings({ imageSize: "1920x1080" });
        reverse.logicalModels[0] = image({ ...profiles.image, pixelSizes: ["1920x1080"] });
        reverse.logicalModels[1] = video({ ...profiles.video, supportsCustomSize: true });
        expect(generationDefaultsValidationError(forward)).toBeUndefined();
        expect(generationDefaultsValidationError(reverse)).toBeUndefined();
        expect(generationDefaultImageSizeOptions(forward).options).toContain("1920x1080");
        expect(generationDefaultImageSizeOptions(reverse).options).toContain("1920x1080");
    });
});
