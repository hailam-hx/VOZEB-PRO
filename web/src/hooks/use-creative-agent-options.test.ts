// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { creativeAgentModelsFromConfig, useCreativeAgentOptions } from "@/hooks/use-creative-agent-options";
import viMessages from "@/i18n/messages/vi.json";
import { applyPublicSystemSettings, defaultConfig, type PublicSystemSettings } from "@/stores/use-config-store";

afterEach(() => vi.unstubAllGlobals());

describe("creative Agent public model catalog", () => {
    it("uses the same resolved capability lists as image, video, audio and Canvas workbenches", () => {
        const config = applyPublicSystemSettings(defaultConfig, publicSettings());

        expect(creativeAgentModelsFromConfig(config)).toEqual([
            { id: "image-one", name: "图片模型", capability: "image" },
            { id: "video-one", name: "视频模型", capability: "video" },
            { id: "audio-one", name: "音频模型", capability: "audio" },
        ]);
    });

    it("keeps a channel-catalog fallback visible while logical model synchronization catches up", () => {
        const settings = publicSettings();
        settings.logicalModels = settings.logicalModels?.filter((model) => model.capability !== "video");
        const config = applyPublicSystemSettings(defaultConfig, settings);

        expect(config.videoModels).toEqual(["video-one"]);
        expect(creativeAgentModelsFromConfig(config, ["video"])).toEqual([{ id: "video-one", name: "video-one", capability: "video" }]);
    });

    it("adds the effective union of enabled binding generation profiles to logical media models", () => {
        const settings = publicSettings();
        const image = settings.logicalModels?.find((item) => item.id === "image-one");
        if (!image) throw new Error("missing image fixture");
        image.bindings[0].generationParameters = generationParameters({ aspectRatios: ["1:1"], qualities: ["studio"] });
        image.bindings.push({
            id: "image-one-binding-two",
            channelId: "media-channel",
            upstreamModel: "image-one-hd",
            enabled: true,
            priority: 2,
            generationParameters: generationParameters({ aspectRatios: ["16:9"], qualities: ["high"] }),
        });
        image.bindings.push({
            id: "image-one-binding-disabled",
            channelId: "media-channel",
            upstreamModel: "image-one-disabled",
            enabled: false,
            priority: 3,
            generationParameters: generationParameters({ aspectRatios: ["9:16"] }),
        });

        const config = applyPublicSystemSettings(defaultConfig, settings);

        expect(creativeAgentModelsFromConfig(config, ["image"])).toEqual([
            {
                id: "image-one",
                name: "图片模型",
                capability: "image",
                generationParameters: generationParameters({ aspectRatios: ["1:1", "16:9"], qualities: ["studio", "high"] }),
            },
        ]);
    });

    it.each(["canvas", "drama"] as const)("returns localized built-in skills to the %s Agent consumer", async (workspace) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                expect(String(input)).toContain(`workspace=${workspace}`);
                return new Response(
                    JSON.stringify({
                        code: 0,
                        data: { skills: [{ id: "character-design", name: "角色设定", description: "原始角色描述", workspaces: [workspace] }] },
                        msg: "OK",
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                );
            }),
        );
        const TestIntlProvider = NextIntlClientProvider as ComponentType<{ locale: string; messages: typeof viMessages; children?: ReactNode }>;
        const wrapper = ({ children }: { children: ReactNode }) => createElement(TestIntlProvider, { locale: "vi", messages: viMessages }, children);

        const { result } = renderHook(() => useCreativeAgentOptions(workspace), { wrapper });
        await waitFor(() => expect(result.current.skillsLoading).toBe(false));

        expect(result.current.skills).toEqual([expect.objectContaining({ id: "character-design", name: "Thiết kế nhân vật", description: "Xây dựng ngoại hình, trang phục, biểu cảm và góc nhìn nhân vật có thể tái sử dụng nhất quán." })]);
    });
});

function publicSettings(): PublicSystemSettings {
    return {
        systemChannels: [
            {
                id: "media-channel",
                name: "媒体渠道",
                baseUrl: "/api/ai/system/media-channel",
                apiKey: "system",
                apiFormat: "openai",
                models: ["image-one", "video-one", "audio-one"],
                enabled: true,
                hasApiKey: true,
            },
        ],
        logicalModels: [logicalModel("image-one", "图片模型", "image"), logicalModel("video-one", "视频模型", "video"), logicalModel("audio-one", "音频模型", "audio")],
    };
}

function logicalModel(id: string, name: string, capability: "image" | "video" | "audio") {
    return { id, name, capability, enabled: true, bindings: [{ id: `${id}-binding`, channelId: "media-channel", upstreamModel: id, enabled: true, priority: 1 }] };
}

function generationParameters(overrides: Record<string, unknown>) {
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
