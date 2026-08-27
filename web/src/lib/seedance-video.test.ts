import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceResolution, seedanceVideoReferenceIssue } from "./seedance-video";

describe("Seedance video configuration", () => {
    it("recognizes SD2.0 aliases without confusing Stable Diffusion", () => {
        expect(isSeedanceVideoConfig({ model: "sd2.0", videoModel: "", baseUrl: "" })).toBe(true);
        expect(isSeedanceVideoConfig({ model: "sd_2.0_fast_discount_720p", videoModel: "", baseUrl: "" })).toBe(true);
        expect(isSeedanceFastModel("sd_2.0_fast_discount_720p")).toBe(true);
        expect(isSeedanceVideoConfig({ model: "stable-diffusion-2.0", videoModel: "", baseUrl: "" })).toBe(false);
    });

    it("uses the selected model's protocol on a mixed channel", () => {
        expect(isSeedanceVideoConfig(mixedChannelConfig("video-logical", "seedance"))).toBe(true);
        expect(isSeedanceVideoConfig(mixedChannelConfig("video-logical", "compatible"))).toBe(false);
    });

    it("recognizes Ark paths only on the exact provider host", () => {
        expect(isSeedanceVideoConfig({ model: "other-video", videoModel: "", baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3" })).toBe(true);
        expect(isSeedanceVideoConfig({ model: "other-video", videoModel: "", baseUrl: "https://ark.cn-beijing.volces.com.evil.test/api/plan/v3" })).toBe(false);
        expect(isSeedanceVideoConfig({ model: "other-video", videoModel: "", baseUrl: "https://example.com/api/plan/v3" })).toBe(false);
    });

    it("returns diagnostic reference issue codes instead of display-language errors", () => {
        expect(seedanceVideoReferenceIssue([{ id: "large", name: "large.mp4", type: "video/mp4", url: "blob:large", bytes: 51 * 1024 * 1024 }])).toEqual({ code: "file-too-large", index: 1 });
        expect(seedanceVideoReferenceIssue([{ id: "long", name: "long.mp4", type: "video/mp4", url: "blob:long", durationMs: 16_000 }])).toEqual({ code: "duration-out-of-range", index: 1 });
    });

    it("keeps supported fractional duration exact and rejects values outside provider constraints", () => {
        expect(normalizeSeedanceDuration("5.5")).toBe(5.5);
        expect(() => normalizeSeedanceDuration("20")).toThrow("不支持 20 秒");
    });

    it("rejects a fast-model 1080p request instead of lowering it to 720p", () => {
        expect(() => normalizeSeedanceResolution("1080p", "Seedance 2.0-fast-720p")).toThrow("不支持 1080p");
    });
});

function mixedChannelConfig(model: string, protocol: "seedance" | "compatible"): AiConfig {
    return {
        ...defaultConfig,
        model,
        videoModel: model,
        channels: [
            {
                id: "mixed",
                name: "混合渠道",
                baseUrl: "/api/ai/system/mixed",
                apiKey: "system",
                apiFormat: "openai",
                models: ["openai-text", "opaque-video"],
                advancedConfig: {
                    protocol: "auto",
                    textModel: "openai-text",
                    imageModel: "",
                    videoModel: "opaque-video",
                    createPath: "",
                    queryPath: "",
                    requestTemplate: "",
                    resultField: "",
                    statusField: "",
                    durationRange: "",
                    referenceRule: "",
                    supportsReferenceImage: false,
                    supportsReferenceVideo: false,
                    supportsReferenceAudio: false,
                    modelConfigs: { "opaque-video": { capability: "video", protocol } },
                },
            },
        ],
        logicalModels: [
            {
                id: "video-logical",
                name: "视频模型",
                capability: "video",
                enabled: true,
                bindings: [{ id: "video-binding", channelId: "mixed", upstreamModel: "opaque-video", enabled: true, priority: 1 }],
            },
        ],
    };
}
