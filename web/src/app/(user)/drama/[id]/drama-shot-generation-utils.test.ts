import { describe, expect, it, vi } from "vitest";

import type { AiConfig } from "@/stores/use-config-store";
import type { DramaEpisode, DramaProject, DramaShot } from "../types";
import { queueDramaShotsAfterPreflight } from "../drama-generation-capabilities";
import { dramaImageGenerationPreflight, dramaShotQueuePreflight, dramaVideoGenerationPreflight, dramaVideoRequestConfig, shotReferenceImages, storyboardReferenceImages } from "./drama-shot-generation-utils";

const generationProfile = (overrides: Record<string, unknown> = {}) => ({
    referenceInputs: ["image"],
    maxReferenceImages: 8,
    aspectRatios: ["16:9", "2:3"],
    pixelSizes: [],
    supportsCustomSize: false,
    qualities: ["high"],
    resolutions: ["720"],
    durationMode: "range",
    durationSeconds: [],
    durationRange: { min: 1.5, max: 8.5 },
    maxBatchSize: 1,
    videoReferenceModes: ["reference", "first_frame", "first_last"],
    voices: [],
    formats: [],
    ...overrides,
});

function capabilityConfig(overrides: Partial<AiConfig> = {}) {
    return {
        imageModel: "image-default",
        videoModel: "video-default",
        quality: "high",
        vquality: "720",
        videoGenerateAudio: "false",
        videoWatermark: "false",
        logicalModels: [
            { id: "image-default", capability: "image", enabled: true, bindings: [{ enabled: true, generationParameters: generationProfile() }] },
            { id: "video-default", capability: "video", enabled: true, bindings: [{ enabled: true, generationParameters: generationProfile() }] },
        ],
        channelMode: "local",
        ...overrides,
    } as unknown as AiConfig & { channelMode: "local" };
}

describe("storyboardReferenceImages", () => {
    it("marks the storyboard start and end images as explicit video frames", () => {
        const references = storyboardReferenceImages({
            id: "shot-one",
            title: "雨夜相遇",
            storyboardFrameMode: "first_last",
            storyboardImageUrl: "/api/reference-assets/start.png",
            storyboardImageWidth: 1280,
            storyboardImageHeight: 720,
            storyboardEndImageUrl: "/api/reference-assets/end.png",
            storyboardEndImageWidth: 1280,
            storyboardEndImageHeight: 720,
        } as never);

        expect(references).toMatchObject([
            { id: "storyboard-start-shot-one", videoRole: "first_frame", serverUrl: "/api/reference-assets/start.png" },
            { id: "storyboard-end-shot-one", videoRole: "last_frame", serverUrl: "/api/reference-assets/end.png" },
        ]);
    });

    it("keeps storyboard mode as a first-frame-only request", () => {
        const references = storyboardReferenceImages({
            id: "shot-two",
            title: "单帧分镜",
            storyboardFrameMode: "first_frame",
            storyboardImageUrl: "https://cdn.example.com/start.png",
            storyboardEndImageUrl: "https://cdn.example.com/end.png",
        } as never);

        expect(references).toEqual([expect.objectContaining({ id: "storyboard-start-shot-two", videoRole: "first_frame", remoteUrl: "https://cdn.example.com/start.png" })]);
    });

    it("keeps every matching project reference instead of taking the first four", () => {
        const characters = Array.from({ length: 5 }, (_, index) => ({ id: `character-${index}`, name: `角色 ${index}`, references: [{ id: `reference-${index}`, url: `/api/reference-assets/${index}.png` }], primaryReferenceId: `reference-${index}` }));
        const references = shotReferenceImages({ characters, scenes: [], props: [], sourceAssets: [] } as never, { characterIds: characters.map((item) => item.id), propIds: [] } as never);

        expect(references).toHaveLength(5);
        expect(references.at(-1)).toMatchObject({ id: "character-4", serverUrl: "/api/reference-assets/4.png" });
    });

    it("validates the actual size inherited from a reference rather than the stored project ratio", () => {
        const project = { ratio: "16:9" } as never;
        const references = [{ width: 1000, height: 1500, videoRole: "first_frame" }] as never;

        expect(dramaImageGenerationPreflight(capabilityConfig(), project, "生成镜头", references)).toEqual({ compatible: true });
        expect(dramaVideoGenerationPreflight(capabilityConfig(), project, { duration: 3.75 } as never, "生成镜头", references)).toEqual({ compatible: true });
    });

    it("keeps an incompatible old duration unchanged and blocks queue preflight", () => {
        const project = { title: "项目", style: "", ratio: "16:9", defaultVideoMode: "direct", characters: [], scenes: [], props: [], clues: [], sourceAssets: [] } as unknown as DramaProject;
        const episode = { id: "episode", title: "第一集", shots: [] } as unknown as DramaEpisode;
        const shot = {
            id: "legacy",
            duration: 9.25,
            videoMode: "direct",
            characterIds: [],
            propIds: [],
            clueIds: [],
            imagePrompt: "图",
            videoPrompt: "视频",
            description: "",
            sourceText: "",
            cameraMotion: "",
            dialogue: "",
            narration: "",
        } as unknown as DramaShot;

        const result = dramaShotQueuePreflight(capabilityConfig(), project, episode, shot);

        expect(result).toMatchObject({ compatible: false, field: "durationSeconds" });
        expect(shot.duration).toBe(9.25);
    });

    it("blocks the whole storyboard pipeline before queueing when the final video is incompatible", () => {
        const project = { title: "项目", style: "", ratio: "16:9", defaultVideoMode: "storyboard", characters: [], scenes: [], props: [], clues: [], sourceAssets: [] } as unknown as DramaProject;
        const episode = { id: "episode", title: "第一集", shots: [] } as unknown as DramaEpisode;
        const shot = {
            id: "storyboard-legacy",
            title: "旧镜头",
            duration: 9.25,
            videoMode: "storyboard",
            storyboardFrameMode: "single",
            characterIds: [],
            propIds: [],
            clueIds: [],
            imagePrompt: "图",
            videoPrompt: "视频",
            description: "",
            sourceText: "",
            cameraMotion: "",
            dialogue: "",
            narration: "",
        } as unknown as DramaShot;
        const queue = vi.fn();
        const preflight = dramaShotQueuePreflight(capabilityConfig(), project, episode, shot);
        const result = queueDramaShotsAfterPreflight([{ id: shot.id, failure: preflight.compatible ? undefined : preflight }], queue);

        expect(preflight).toMatchObject({ compatible: false, field: "durationSeconds" });
        expect(result).toMatchObject({ queued: false, shotId: shot.id });
        expect(queue).not.toHaveBeenCalled();
    });

    it("checks the future end-frame image step before queueing a first-last storyboard", () => {
        const config = capabilityConfig();
        config.logicalModels[0].bindings[0].generationParameters = generationProfile({ maxReferenceImages: undefined }) as never;
        const project = { title: "项目", style: "", ratio: "16:9", defaultVideoMode: "storyboard", characters: [], scenes: [], props: [], clues: [], sourceAssets: [] } as unknown as DramaProject;
        const episode = { id: "episode", title: "第一集", shots: [] } as unknown as DramaEpisode;
        const shot = {
            id: "first-last",
            title: "首尾帧",
            duration: 5,
            videoMode: "storyboard",
            storyboardFrameMode: "first_last",
            characterIds: [],
            propIds: [],
            clueIds: [],
            imagePrompt: "图",
            videoPrompt: "视频",
            description: "",
            sourceText: "",
            cameraMotion: "",
            dialogue: "",
            narration: "",
        } as unknown as DramaShot;

        expect(dramaShotQueuePreflight(config, project, episode, shot)).toMatchObject({ compatible: false, field: "referenceCount" });
    });

    it("blocks reference mode before queueing when no reference image exists", () => {
        const project = { title: "项目", style: "", ratio: "16:9", defaultVideoMode: "reference", characters: [], scenes: [], props: [], clues: [], sourceAssets: [] } as unknown as DramaProject;
        const episode = { id: "episode", title: "第一集", shots: [] } as unknown as DramaEpisode;
        const shot = {
            id: "reference-without-image",
            title: "参考生成",
            duration: 5,
            videoMode: "reference",
            characterIds: [],
            propIds: [],
            clueIds: [],
            imagePrompt: "图",
            videoPrompt: "视频",
            description: "",
            sourceText: "",
            cameraMotion: "",
            dialogue: "",
            narration: "",
        } as unknown as DramaShot;

        expect(dramaShotQueuePreflight(capabilityConfig(), project, episode, shot)).toMatchObject({ compatible: false, field: "referenceCount" });
    });

    it("omits the implicit config watermark while an explicit false switch remains concrete", () => {
        const config = capabilityConfig();
        const project = { ratio: "16:9" } as unknown as DramaProject;
        const shot = { duration: 5 } as DramaShot;

        expect(config.videoWatermark).toBe("false");
        expect(dramaVideoGenerationPreflight(config, project, shot, "生成镜头")).toEqual({ compatible: true });
        expect(dramaVideoRequestConfig(config, shot).videoWatermark).toBeUndefined();
    });
});
