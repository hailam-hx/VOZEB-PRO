import { describe, expect, it, vi } from "vitest";

import {
    audioGenerationRequest,
    filterGenerationCandidates,
    imageGenerationRequest,
    resolveAudioGenerationCandidates,
    resolveBindingImageGenerationCandidates,
    resolveImageGenerationCandidates,
    resolveVideoGenerationCandidates,
    videoGenerationRequest,
} from "./capability-constraints";
import { normalizeImageQualityProfile } from "@/lib/image-quality-profile";
import type { ResolvedLogicalModel } from "./logical-model-router";

describe("generation capability constraints", () => {
    it("filters each binding independently without changing routing order", () => {
        const candidates = [
            { id: "first", generationParameters: { aspectRatios: ["1:1"] } },
            { id: "second", generationParameters: { aspectRatios: ["16:9"] } },
            { id: "third", generationParameters: { aspectRatios: ["16:9"] } },
        ];
        const result = filterGenerationCandidates(candidates, { aspectRatio: "16:9" });
        expect(result.candidates.map((candidate) => candidate.id)).toEqual(["second", "third"]);
        expect(result.error?.message).toContain("16:9");
    });

    it("allows Auto on an unconfigured binding but fails closed for concrete parameters", () => {
        expect(filterGenerationCandidates([{ id: "unconfigured" }], {})).toMatchObject({ candidates: [{ id: "unconfigured" }] });
        const concrete = filterGenerationCandidates([{ id: "unconfigured" }], { quality: "high" });
        expect(concrete.candidates).toEqual([]);
        expect(concrete.error?.message).toContain("尚未配置生成参数能力");
    });

    it("keeps only bindings whose explicit custom ranges contain the requested values", () => {
        const result = filterGenerationCandidates(
            [
                {
                    id: "compatible",
                    generationParameters: {
                        durationMode: "discrete",
                        durationSeconds: [4, 15],
                        supportsCustomDuration: true,
                        customDurationRange: { min: 3, max: 20 },
                        maxBatchSize: 4,
                        supportsCustomBatchSize: true,
                        customBatchSizeRange: { min: 5, max: 10 },
                    },
                },
                { id: "fixed-only", generationParameters: { durationMode: "discrete", durationSeconds: [4, 15], maxBatchSize: 4 } },
            ],
            { durationSeconds: 7, batchSize: 7 },
        );

        expect(result.candidates.map((candidate) => candidate.id)).toEqual(["compatible"]);
    });

    it.each([
        [{ referenceInputs: [] }, { referenceInputs: ["image"] }, "参考图片"],
        [{ maxReferenceImages: 1 }, { referenceCount: 2 }, "参考图数量"],
        [{ pixelSizes: ["1024x1024"] }, { pixelSize: "1280x720" }, "1280x720"],
        [{ qualities: ["low"] }, { quality: "high" }, "画质 high"],
        [{ resolutions: ["720"] }, { resolution: "1080" }, "清晰度 1080"],
        [{ durationMode: "discrete", durationSeconds: [5] }, { durationSeconds: 6 }, "6 秒"],
        [{ maxBatchSize: 1 }, { batchSize: 2 }, "生成 2 个结果"],
        [{ voices: ["alloy"] }, { voice: "nova" }, "音色 nova"],
        [{ formats: ["mp3"] }, { format: "wav" }, "格式 wav"],
    ] as const)("returns a clear field error for %o", (generationParameters, request, message) => {
        const result = filterGenerationCandidates([{ id: "candidate", generationParameters }], request as never);
        expect(result.error?.message).toContain(message);
    });

    it("maps image fields while omitting Auto values", () => {
        expect(imageGenerationRequest({ size: "1920X1080", quality: "high", count: 2 }, 1, true)).toEqual({ referenceInputs: ["image"], referenceCount: 2, pixelSize: "1920x1080", quality: "high", batchSize: 2 });
        expect(imageGenerationRequest({ size: "16:9", quality: "auto", count: "auto" }, 0, false)).toEqual({ aspectRatio: "16:9" });
    });

    it("maps video references and concrete preferences without rewriting them", () => {
        expect(
            videoGenerationRequest({ size: "1280x720", vquality: "1080", videoSeconds: 5, count: 2, videoGenerateAudio: false, videoWatermark: true }, [{ type: "image", role: "first_frame" }, { type: "image", role: "last_frame" }, { type: "audio" }]),
        ).toEqual({ referenceInputs: ["image", "audio"], referenceCount: 2, pixelSize: "1280x720", resolution: "1080", durationSeconds: 5, batchSize: 2, videoReferenceMode: "first_last" });
        expect(videoGenerationRequest({ size: "auto", vquality: "", videoSeconds: -1, count: 0 }, [])).toEqual({});
    });

    it("maps only concrete audio preferences", () => {
        expect(audioGenerationRequest({ voice: "alloy", format: "mp3", speed: "1.25" })).toEqual({ voice: "alloy", format: "mp3", speed: 1.25 });
        expect(audioGenerationRequest({ voice: "auto", format: " ", speed: 0 })).toEqual({});
    });

    it("keeps image Smart size unresolved while resolving other Auto fields per binding", () => {
        const result = resolveImageGenerationCandidates(
            [
                { id: "square", generationParameters: { aspectRatios: ["1:1"], qualities: ["low"], maxBatchSize: 3 } },
                { id: "portrait", generationParameters: { aspectRatios: ["3:4"], qualities: ["medium"], maxBatchSize: 2 } },
            ],
            { size: "auto", quality: "auto", count: 2 },
            { imageSize: "16:9", imageQuality: "high" },
            0,
            false,
        );

        expect(result.candidates).toEqual([expect.objectContaining({ id: "square", quality: "low", count: 2 }), expect.objectContaining({ id: "portrait", quality: "medium", count: 2 })]);
        expect(result.candidates.every((candidate) => !("size" in candidate))).toBe(true);
    });

    it("keeps an explicit Smart aspect ratio unresolved for the upstream provider", () => {
        const result = resolveImageGenerationCandidates([{ id: "image", generationParameters: { aspectRatios: ["1:1", "16:9"] } }], { size: "auto" }, { imageSize: "1:1", imageQuality: "auto" }, 0, false);

        expect(result).toEqual({ candidates: [{ id: "image", generationParameters: { aspectRatios: ["1:1", "16:9"] } }], error: undefined });
    });

    it("resolves image quality for every binding and retains only complete candidates", () => {
        const validation = { status: "VALID" as const, reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" };
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "prompt_flag",
            selectionMode: "explicit",
            source: "provider_preset",
            options: [
                { value: "standard", label: "标准", effect: { type: "prompt_flag", promptSuffix: "--sd", mutexGroup: "midjourney-quality" } },
                { value: "high", label: "高清", effect: { type: "prompt_flag", promptSuffix: "--hd", mutexGroup: "midjourney-quality" } },
            ],
            validation,
        })!;
        const channel = { id: "dflop", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "secret", apiFormat: "openai" as const, models: ["good", "bad"], enabled: true };
        const generationParameters = { referenceInputs: [], aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], maxBatchSize: 1, videoReferenceModes: [], voices: [], formats: [] };
        const goodBinding = { id: "good", channelId: channel.id, upstreamModel: "good", enabled: true, priority: 1, imageQualityProfile: profile, generationParameters };
        const badBinding = {
            id: "bad",
            channelId: channel.id,
            upstreamModel: "bad",
            enabled: true,
            priority: 2,
            imageQualityProfile: { ...profile, validation: { status: "INVALID" as const, reasons: [{ code: "BAD", message: "不可执行", severity: "blocking" as const }], validatedAt: validation.validatedAt } },
            generationParameters,
        };
        const logicalModel = {
            id: "image",
            name: "Image",
            capability: "image" as const,
            enabled: true,
            saleRateCard: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "1" }] },
            bindings: [goodBinding, badBinding],
        };
        const resolved = [goodBinding, badBinding].map((binding) => ({
            logicalModelId: logicalModel.id,
            upstreamModel: binding.upstreamModel,
            channelId: channel.id,
            channel,
            logicalModel,
            binding,
            generationParameters: binding.generationParameters,
        })) as ResolvedLogicalModel[];

        const result = resolveBindingImageGenerationCandidates(resolved, { quality: "high", count: 1 }, { imageSize: "auto", imageQuality: "auto" }, 0, false, "a cat --sd", (candidate) => ({
            id: candidate.binding.id,
            generationParameters: candidate.generationParameters,
        }));

        expect(result.candidates).toEqual([expect.objectContaining({ id: "good", imageQualityContext: expect.objectContaining({ bindingId: "good", effectivePrompt: "a cat --hd" }) })]);
        expect(result.error).toMatchObject({ code: "QUALITY_CONTEXT_UNRESOLVABLE" });
    });

    it("keeps legacy qualities for non-DFLOP bindings and emits bounded telemetry", () => {
        const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
        const channel = { id: "legacy", name: "Legacy", baseUrl: "https://legacy.example/v1", apiKey: "secret", apiFormat: "openai" as const, models: ["legacy-image"], enabled: true };
        const binding = { id: "legacy-binding", channelId: channel.id, upstreamModel: "legacy-image", enabled: true, priority: 1, generationParameters: { qualities: ["high"] } };
        const logicalModel = { id: "legacy-image", name: "Legacy image", capability: "image" as const, enabled: true, bindings: [binding] };
        const resolved = [{ logicalModelId: logicalModel.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, logicalModel, binding, generationParameters: binding.generationParameters }] as ResolvedLogicalModel[];

        const result = resolveBindingImageGenerationCandidates(resolved, { quality: "high" }, { imageSize: "auto", imageQuality: "auto" }, 0, false, "a cat", (candidate) => ({
            id: candidate.binding.id,
            generationParameters: candidate.generationParameters,
        }));

        expect(result.candidates).toEqual([expect.objectContaining({ id: "legacy-binding", quality: "high" })]);
        expect(debug).toHaveBeenCalledWith("Image quality legacy adapter", { channelId: "legacy", bindingId: "legacy-binding", upstreamProtocol: "compatible" });
    });

    it("resolves an official Seedream minimum execution size before dispatch", () => {
        const profile = normalizeImageQualityProfile({ version: 1, controlType: "none", selectionMode: "none", source: "none", options: [], validation: { status: "VALID", reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" } })!;
        const channel = { id: "dflop", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "secret", apiFormat: "openai" as const, models: ["doubao-seedream-5-0-260128"], enabled: true, advancedConfig: { protocol: "dflop" as const } };
        const generationParameters = { aspectRatios: ["16:9"], supportsCustomSize: false };
        const binding = { id: "seedream", channelId: channel.id, upstreamModel: "doubao-seedream-5-0-260128", enabled: true, priority: 1, imageQualityProfile: profile, generationParameters };
        const logicalModel = { id: "seedream", name: "Seedream", capability: "image" as const, enabled: true, saleRateCard: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "1" }] }, bindings: [binding] };
        const resolved = [{ logicalModelId: logicalModel.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, logicalModel, binding, generationParameters }] as unknown as ResolvedLogicalModel[];

        const result = resolveBindingImageGenerationCandidates(resolved, { size: "16:9", count: 1 }, { imageSize: "auto", imageQuality: "auto" }, 0, false, "a cat", (candidate) => ({
            id: candidate.binding.id,
            generationParameters: candidate.generationParameters,
        }));

        expect(result.candidates).toEqual([expect.objectContaining({ id: "seedream", size: "2560x1440", imageQualityContext: expect.objectContaining({ resolvedSize: "2560x1440", resolvedWidth: 2560, resolvedHeight: 1440 }) })]);
    });

    it("keeps a Qwen ratio compatible after its quality profile resolves an exact execution size", () => {
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "resolution_tier",
            selectionMode: "explicit",
            source: "provider_preset",
            defaultValue: "1k",
            options: [
                {
                    value: "1k",
                    label: "1K",
                    effect: { type: "resolution_tier", resolutionTier: "1k", exactSizes: ["1024x1024"], sizeByAspectRatio: { "1:1": "1024x1024" } },
                },
            ],
            validation: { status: "VALID", reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" },
        })!;
        const channel = {
            id: "dflop",
            name: "DFLOP",
            baseUrl: "https://api.dflop.top/v1",
            apiKey: "secret",
            apiFormat: "openai" as const,
            models: ["qwen-image-3.0-pro"],
            enabled: true,
            advancedConfig: { protocol: "dflop" as const },
        };
        const generationParameters = { referenceInputs: [], aspectRatios: ["1:1"], pixelSizes: [], supportsCustomSize: false };
        const binding = { id: "qwen", channelId: channel.id, upstreamModel: "qwen-image-3.0-pro", enabled: true, priority: 1, imageQualityProfile: profile, generationParameters };
        const logicalModel = {
            id: "qwen",
            name: "Qwen",
            capability: "image" as const,
            enabled: true,
            saleRateCard: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "1" }] },
            bindings: [binding],
        };
        const resolved = [{ logicalModelId: logicalModel.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, logicalModel, binding, generationParameters }] as unknown as ResolvedLogicalModel[];

        const result = resolveBindingImageGenerationCandidates(resolved, { size: "1:1", quality: "1k", count: 1 }, { imageSize: "auto", imageQuality: "auto" }, 0, false, "a cat", (candidate) => ({
            id: candidate.binding.id,
            generationParameters: candidate.generationParameters,
        }));

        expect(result.candidates).toEqual([expect.objectContaining({ id: "qwen", size: "1024x1024", imageQualityContext: expect.objectContaining({ resolvedSize: "1024x1024", resolvedResolutionTier: "1k" }) })]);
    });

    it("fails closed when a DFLOP image binding has no authoritative quality profile", () => {
        const channel = { id: "dflop", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "secret", apiFormat: "openai" as const, models: ["image-model"], enabled: true, advancedConfig: { protocol: "dflop" as const } };
        const binding = { id: "dflop-binding", channelId: channel.id, upstreamModel: "image-model", enabled: true, priority: 1, generationParameters: { qualities: ["high"] } };
        const logicalModel = { id: "image-model", name: "Image", capability: "image" as const, enabled: true, bindings: [binding] };
        const resolved = [{ logicalModelId: logicalModel.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, logicalModel, binding, generationParameters: binding.generationParameters }] as ResolvedLogicalModel[];

        const result = resolveBindingImageGenerationCandidates(resolved, { quality: "high" }, { imageSize: "auto", imageQuality: "auto" }, 0, false, "a cat", (candidate) => ({
            id: candidate.binding.id,
            generationParameters: candidate.generationParameters,
        }));

        expect(result.candidates).toEqual([]);
        expect(result.error).toMatchObject({ code: "QUALITY_CONTEXT_UNRESOLVABLE" });
    });

    it("resolves image Auto count from the compatible global default, then one, then provider default", () => {
        const result = resolveImageGenerationCandidates(
            [{ id: "global", generationParameters: { maxBatchSize: 4 } }, { id: "minimum", generationParameters: { maxBatchSize: 2 } }, { id: "provider-default" }],
            { count: "auto" },
            { imageSize: "auto", imageQuality: "auto", imageCount: 3 },
            0,
            false,
        );

        expect(result.candidates).toEqual([expect.objectContaining({ id: "global", count: 3 }), expect.objectContaining({ id: "minimum", count: 1 }), { id: "provider-default" }]);
    });

    it("treats a persisted single result as the provider default when batch capability is undeclared", () => {
        const image = resolveImageGenerationCandidates([{ id: "image", generationParameters: { aspectRatios: ["1:1"] } }], { size: "1:1", count: 1 }, { imageSize: "auto", imageQuality: "auto" }, 0, false);
        const video = resolveVideoGenerationCandidates(
            [{ id: "video", generationParameters: { aspectRatios: ["16:9"], durationMode: "discrete", durationSeconds: [5] } }],
            { size: "16:9", videoSeconds: 5, count: 1 },
            { imageSize: "auto", videoQuality: "auto", videoSeconds: 5 },
            [],
        );
        const unsupportedBatch = resolveImageGenerationCandidates([{ id: "image", generationParameters: { aspectRatios: ["1:1"] } }], { size: "1:1", count: 2 }, { imageSize: "auto", imageQuality: "auto" }, 0, false);

        expect(image).toEqual({ candidates: [{ id: "image", generationParameters: { aspectRatios: ["1:1"] }, size: "1:1" }], error: undefined });
        expect(video).toEqual({ candidates: [{ id: "video", generationParameters: { aspectRatios: ["16:9"], durationMode: "discrete", durationSeconds: [5] }, size: "16:9", videoSeconds: 5 }], error: undefined });
        expect(unsupportedBatch.candidates).toEqual([]);
        expect(unsupportedBatch.error?.message).toBe("当前模型不支持一次生成 2 个结果");
    });

    it("resolves Auto count from the lower custom range bound when fixed counts are unavailable", () => {
        const result = resolveImageGenerationCandidates(
            [{ id: "custom", generationParameters: { supportsCustomBatchSize: true, customBatchSizeRange: { min: 5, max: 10 } } }],
            { count: "auto" },
            { imageSize: "auto", imageQuality: "auto", imageCount: 3 },
            0,
            false,
        );

        expect(result.candidates).toEqual([expect.objectContaining({ id: "custom", count: 5 })]);
    });

    it("resolves audio Auto fields from a compatible default then the binding list or range minimum", () => {
        const result = resolveAudioGenerationCandidates(
            [{ id: "audio", generationParameters: { voices: ["nova"], formats: ["wav"], speedRange: { min: 1.25, max: 1.5 } } }],
            { voice: "auto", format: "auto", speed: "auto" },
            { audioVoice: "alloy", audioFormat: "mp3" },
        );

        expect(result.candidates).toEqual([expect.objectContaining({ id: "audio", voice: "nova", format: "wav", speed: "1.25" })]);
    });

    it("defers a cloned profile provider voice to the owned profile resolver", () => {
        const result = resolveAudioGenerationCandidates(
            [{ id: "audio", generationParameters: { audioOperation: "speech", supportsClonedVoices: true, voices: ["alloy"], formats: ["mp3"] } }],
            { voiceSelection: { type: "profile", voiceProfileId: "profile-one" }, voice: "provider-private-voice", format: "mp3" },
            { audioVoice: "alloy", audioFormat: "mp3" },
        );

        expect(result.error).toBeUndefined();
        expect(result.candidates).toEqual([expect.objectContaining({ id: "audio", format: "mp3" })]);
    });

    it("uses the binding speed minimum instead of inventing speed one", () => {
        const result = resolveAudioGenerationCandidates([{ id: "audio", generationParameters: { speedRange: { min: 0.5, max: 2 } } }], { speed: "auto" }, { audioVoice: "auto", audioFormat: "auto" });

        expect(result.candidates).toEqual([expect.objectContaining({ id: "audio", speed: "0.5" })]);
    });

    it("keeps video Smart size unresolved while resolving other Auto fields per binding", () => {
        const result = resolveVideoGenerationCandidates(
            [
                {
                    id: "video",
                    generationParameters: {
                        aspectRatios: ["4:3"],
                        resolutions: ["480"],
                        durationMode: "discrete",
                        durationSeconds: [8, 10],
                    },
                },
            ],
            { size: "auto", vquality: "auto", videoSeconds: -1 },
            { imageSize: "16:9", videoQuality: "1080", videoSeconds: 5 },
            [],
        );

        expect(result.candidates).toEqual([expect.objectContaining({ id: "video", vquality: "480", videoSeconds: 8 })]);
        expect(result.candidates.every((candidate) => !("size" in candidate))).toBe(true);
    });

    it("omits unresolved Auto fields for an unconfigured binding", () => {
        expect(resolveImageGenerationCandidates([{ id: "unconfigured" }], { size: "auto", quality: "auto" }, { imageSize: "16:9", imageQuality: "high" }, 0, false).candidates).toEqual([{ id: "unconfigured" }]);
        expect(resolveAudioGenerationCandidates([{ id: "unconfigured" }], undefined, { audioVoice: "alloy", audioFormat: "mp3" }).candidates).toEqual([{ id: "unconfigured" }]);
        expect(resolveVideoGenerationCandidates([{ id: "unconfigured" }], {}, { imageSize: "16:9", videoQuality: "1080", videoSeconds: 5 }, []).candidates).toEqual([{ id: "unconfigured" }]);
    });
});
