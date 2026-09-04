import { describe, expect, it } from "vitest";

import { audioGenerationRequest, filterGenerationCandidates, imageGenerationRequest, resolveAudioGenerationCandidates, resolveImageGenerationCandidates, resolveVideoGenerationCandidates, videoGenerationRequest } from "./capability-constraints";

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

    it("resolves image Auto fields independently for every binding and preserves an explicit count", () => {
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

        expect(result.candidates).toEqual([expect.objectContaining({ id: "square", size: "1:1", quality: "low", count: 2 }), expect.objectContaining({ id: "portrait", size: "3:4", quality: "medium", count: 2 })]);
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

    it("resolves every video Auto field against the selected binding instead of global defaults", () => {
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

        expect(result.candidates).toEqual([expect.objectContaining({ id: "video", size: "4:3", vquality: "480", videoSeconds: 8 })]);
    });

    it("omits unresolved Auto fields for an unconfigured binding", () => {
        expect(resolveImageGenerationCandidates([{ id: "unconfigured" }], { size: "auto", quality: "auto" }, { imageSize: "16:9", imageQuality: "high" }, 0, false).candidates).toEqual([{ id: "unconfigured" }]);
        expect(resolveAudioGenerationCandidates([{ id: "unconfigured" }], undefined, { audioVoice: "alloy", audioFormat: "mp3" }).candidates).toEqual([{ id: "unconfigured" }]);
        expect(resolveVideoGenerationCandidates([{ id: "unconfigured" }], {}, { imageSize: "16:9", videoQuality: "1080", videoSeconds: 5 }, []).candidates).toEqual([{ id: "unconfigured" }]);
    });
});
