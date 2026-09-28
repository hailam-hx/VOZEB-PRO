import { describe, expect, it } from "vitest";

import { parseDflopDescriptionCapabilities } from "./dflop-description-capabilities";

const chinese = "字节跳动 Seedance 2.5,视频生成新旗舰(异步任务)。支持文生视频、图生视频首帧/首尾帧,以及图片(≤30 张)/视频/音频的多模态参考与组合参考;可生成有声视频。480p/720p/1080p,4-30 秒,24fps,画幅 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16。";
const english = "Supports text-to-video, image-to-video with first / first-and-last frames, and multimodal references from images (≤30), video and audio; can generate videos with sound. 480p/720p/1080p, 4-30s, 24fps.";

const seedanceExpected = {
    referenceImage: true,
    maxReferenceImages: 30,
    referenceVideo: true,
    maxReferenceVideos: null,
    referenceAudio: true,
    maxReferenceAudios: null,
    firstFrame: true,
    lastFrame: true,
    firstLastFrame: true,
    textToVideo: true,
    imageToVideo: true,
    videoToVideo: null,
    generateAudio: true,
    fps: 24,
    maxReferenceVideoDuration: null,
    maxTotalReferenceVideoDuration: null,
};

describe("DFLOP description capability parser", () => {
    it.each([
        ["Chinese", chinese],
        ["English", english],
    ])("parses the Seedance 2.5 %s description deterministically", (_language, description) => {
        const parsed = parseDflopDescriptionCapabilities(description);
        expect(parsed.values).toEqual(seedanceExpected);
        expect(parsed.evidence.referenceImage).toBeTruthy();
        expect(parsed.evidence.fps).toMatch(/24\s*fps/i);
    });

    it.each([null, undefined, "", "A new creative model with flexible output."])("returns unknown values for %s", (description) => {
        const parsed = parseDflopDescriptionCapabilities(description);
        expect(Object.values(parsed.values).every((value) => value === null)).toBe(true);
        expect(parsed.evidence).toEqual({});
    });

    it("does not confuse generation with reference input", () => {
        expect(parseDflopDescriptionCapabilities("image generation model").values.referenceImage).toBeNull();
        expect(parseDflopDescriptionCapabilities("video generation model").values.referenceVideo).toBeNull();
        expect(parseDflopDescriptionCapabilities("can generate audio").values).toMatchObject({ generateAudio: true, referenceAudio: null });
        expect(parseDflopDescriptionCapabilities("supports image-to-video from one first frame").values).toMatchObject({ imageToVideo: true, firstFrame: true, referenceImage: null });
    });

    it.each(["≤30 images", "up to 30 images", "最多30张图片", "图片(≤30 张)", "图片（≤30张）", "supports reference images up to 30"])("parses the reference image limit in %s", (description) => {
        expect(parseDflopDescriptionCapabilities(description).values).toMatchObject({ referenceImage: true, maxReferenceImages: 30 });
    });

    it.each(["首尾帧", "首帧/尾帧", "首帧和尾帧", "首帧与尾帧", "首帧+尾帧", "first and last frame", "first-and-last frame", "first / last frame", "first + last frames"])("parses the first/last frame form %s", (description) => {
        expect(parseDflopDescriptionCapabilities(description).values).toMatchObject({ firstFrame: true, lastFrame: true, firstLastFrame: true });
    });

    it("parses explicit negation without treating missing mentions as false", () => {
        expect(parseDflopDescriptionCapabilities("不支持参考音频；reference video is not supported").values).toMatchObject({ referenceAudio: false, referenceVideo: false, referenceImage: null });
    });

    it("extracts reference video duration limits only when semantically bound", () => {
        expect(parseDflopDescriptionCapabilities("Reference video [1,15] seconds each, 15 seconds total.").values).toMatchObject({ referenceVideo: true, maxReferenceVideoDuration: 15, maxTotalReferenceVideoDuration: 15 });
        expect(parseDflopDescriptionCapabilities("480p/720p/1080p, 4-30 seconds, 24fps").values).toMatchObject({ maxReferenceVideoDuration: null, maxTotalReferenceVideoDuration: null, fps: 24 });
    });
});
