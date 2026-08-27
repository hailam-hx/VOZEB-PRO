// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "antd";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";
import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import { defaultConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { CanvasConfigNodePanel } from "./canvas-config-node-panel";

beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }),
    });
    Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: { offsetTop: 0, height: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

afterEach(() => cleanup());

describe("CanvasConfigNodePanel generation capability", () => {
    beforeEach(() => {
        useConfigStore.setState({ config: configWithImageCapability(profile({ aspectRatios: ["1:1"], qualities: ["studio"], maxBatchSize: 2 })) });
    });

    it("keeps an unsupported persisted exact size visible and blocks generation with an accessible reason", async () => {
        const user = userEvent.setup();
        const onGenerate = vi.fn();
        renderPanel(onGenerate);

        expect(screen.getByRole("button", { name: /图片设置：4097×17/ })).toBeTruthy();
        const generate = screen.getByRole("button", { name: /开始生成/ });
        const tooltipTarget = generate.closest<HTMLElement>("[data-capability-tooltip]");
        expect((generate as HTMLButtonElement).disabled).toBe(true);
        expect(generate.getAttribute("aria-disabled")).toBe("true");
        expect(tooltipTarget?.tabIndex).toBe(0);

        tooltipTarget!.focus();
        expect((await screen.findByRole("tooltip")).textContent).toContain("当前模型不支持此参数");
        fireEvent.click(tooltipTarget!);
        await user.click(generate);
        expect(onGenerate).not.toHaveBeenCalled();
    });
});

function renderPanel(onGenerate: () => void) {
    return render(
        <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
            <App>
                <CanvasConfigNodePanel
                    node={node()}
                    isRunning={false}
                    inputSummary={{ textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0 }}
                    references={[]}
                    onConfigChange={() => undefined}
                    onGenerate={onGenerate}
                    onStop={() => undefined}
                    onComposerToggle={() => undefined}
                />
            </App>
        </NextIntlClientProvider>,
    );
}

function node(): CanvasNodeData {
    return {
        id: "config-node",
        type: CanvasNodeType.Config,
        title: "生成配置",
        position: { x: 0, y: 0 },
        width: 360,
        height: 240,
        metadata: { generationMode: "image", composerContent: "生成一张海报", model: "image-model", size: "4097x17", quality: "auto" },
    };
}

function configWithImageCapability(generationParameters: LogicalModelGenerationParameters): AiConfig {
    return {
        ...defaultConfig,
        channels: [{ id: "channel", name: "Channel", baseUrl: "/api/ai/system/channel", apiKey: "system", apiFormat: "openai", models: ["image-upstream"] }],
        logicalModels: [
            {
                id: "image-model",
                name: "Image model",
                capability: "image",
                enabled: true,
                bindings: [{ id: "binding", channelId: "channel", upstreamModel: "image-upstream", enabled: true, priority: 0, generationParameters }],
            },
        ],
        models: ["image-model"],
        imageModels: ["image-model"],
        imageModel: "image-model",
        model: "image-model",
        size: "auto",
        quality: "auto",
        canvasImageCount: "auto",
    };
}

function profile(overrides: Partial<LogicalModelGenerationParameters> = {}): LogicalModelGenerationParameters {
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
