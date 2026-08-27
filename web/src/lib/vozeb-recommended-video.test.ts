import { describe, expect, it } from "vitest";

import { assertVozebRecommendedVideoReferences, buildVozebRecommendedVideoRequest } from "./vozeb-recommended-video";

describe("VOZEB recommended video protocol", () => {
    it("rejects unsupported resolution and generated audio instead of silently rewriting them", () => {
        const request = {
            model: "Seedance 2.0-fast-720p",
            prompt: "test",
            duration: 5,
            aspectRatio: "16:9",
            resolution: "1080p",
            generateAudio: true,
            images: [],
            videos: [],
            audios: [],
        };

        expect(() => buildVozebRecommendedVideoRequest(request)).toThrow("不支持 1080p");
        expect(() => buildVozebRecommendedVideoRequest({ ...request, resolution: "720p" })).toThrow("不支持生成音频");
    });

    it("forwards a supported fractional duration exactly and rejects provider-out-of-range values", () => {
        const request = {
            model: "Seedance 2.0-fast-720p",
            prompt: "test",
            duration: 5.5,
            aspectRatio: "16:9",
            resolution: "720p",
            generateAudio: false,
            images: [],
            videos: [],
            audios: [],
        };

        expect(buildVozebRecommendedVideoRequest(request)).toMatchObject({ duration: 5.5, resolution: "720p", generate_audio: false });
        expect(() => buildVozebRecommendedVideoRequest({ ...request, duration: 20 })).toThrow("不支持 20 秒");
    });

    it("keeps supported reference media in JSON arrays", () => {
        expect(
            buildVozebRecommendedVideoRequest({
                model: "qy-seedance-2.0-fast",
                prompt: "test",
                duration: 10,
                aspectRatio: "9:16",
                resolution: "720p",
                generateAudio: true,
                images: ["image-one"],
                videos: ["video-one"],
                audios: ["audio-one"],
            }),
        ).toEqual({
            model: "qy-seedance-2.0-fast",
            prompt: "test",
            duration: 10,
            resolution: "720p",
            metadata: { resolution: "720p" },
            generate_audio: true,
            aspect_ratio: "9:16",
            images: ["image-one"],
            videos: ["video-one"],
            audios: ["audio-one"],
        });
    });

    it("rejects unsupported reference video and audio for Seedance 2.0-fast-720p", () => {
        expect(() => assertVozebRecommendedVideoReferences("Seedance 2.0-fast-720p", [{ type: "video" }])).toThrow("不支持参考视频");
        expect(() => assertVozebRecommendedVideoReferences("models/Seedance 2.0-fast-720p", [{ type: "audio" }])).toThrow("不支持参考音频");
    });
});
