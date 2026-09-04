/** @vitest-environment jsdom */

import { App } from "antd";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/auth/store";
import { GenerationDefaultsPanel } from "./admin-generation-settings";
import { AdminLogicalModelManager } from "./admin-logical-model-manager";

const roots: Array<ReturnType<typeof createRoot>> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;
const getComputedStyleWithoutPseudo = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element) => getComputedStyleWithoutPseudo(element)) as typeof window.getComputedStyle;
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 320, height: 32, top: 0, right: 320, bottom: 32, left: 0, toJSON() {} }),
});

afterEach(async () => {
    await act(async () => {
        while (roots.length) roots.pop()?.unmount();
    });
    document.body.replaceChildren();
});

async function render(node: ReactNode) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<App>{node}</App>));
    return host;
}

function LogicalModelHarness({
    channels,
    logicalModels,
    defaultModels,
    onApplied,
}: Omit<Parameters<typeof AdminLogicalModelManager>[0], "onChange"> & { onApplied?: (value: { logicalModels: typeof logicalModels; defaultModels: typeof defaultModels }) => void }) {
    const [state, setState] = useState({ logicalModels, defaultModels });
    return (
        <AdminLogicalModelManager
            channels={channels}
            logicalModels={state.logicalModels}
            defaultModels={state.defaultModels}
            onChange={(value) => {
                setState(value);
                onApplied?.(value);
            }}
        />
    );
}

const videoChannels = [{ id: "one", name: "渠道", baseUrl: "https://api.example.com/v1", apiKey: "", apiFormat: "openai" as const, models: ["video"], enabled: true }];
const videoDefaults = { imageModel: "", videoModel: "video", textModel: "", audioModel: "", voiceCloneModel: "" };
const textChannels = [{ ...videoChannels[0], models: ["gpt-5.6-sol"] }];
const textDefaults = { imageModel: "", videoModel: "", textModel: "gpt-5.6-sol", audioModel: "", voiceCloneModel: "" };

function videoModels(
    generationParameters?: Parameters<typeof LogicalModelHarness>[0]["logicalModels"][number]["bindings"][number]["generationParameters"],
    capabilityProfile?: Parameters<typeof LogicalModelHarness>[0]["logicalModels"][number]["bindings"][number]["capabilityProfile"],
) {
    return [{ id: "video", name: "视频", capability: "video" as const, enabled: true, bindings: [{ id: "video:one", channelId: "one", upstreamModel: "video", enabled: true, priority: 1, generationParameters, capabilityProfile }] }];
}

function textModels(capabilityProfile?: Parameters<typeof LogicalModelHarness>[0]["logicalModels"][number]["bindings"][number]["capabilityProfile"]) {
    return [
        {
            id: "gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            capability: "text" as const,
            enabled: true,
            bindings: [{ id: "gpt-5.6-sol:one", channelId: "one", upstreamModel: "gpt-5.6-sol", enabled: true, priority: 1, capabilityProfile }],
        },
    ];
}

async function openVideoEditor(host: HTMLElement) {
    await act(async () => (Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("路由设置")) as HTMLButtonElement).click());
}

function fieldInput(label: string) {
    return Array.from(document.querySelectorAll("label"))
        .find((item) => item.textContent?.startsWith(label))
        ?.querySelector("input") as HTMLInputElement;
}

describe("admin generation controls", () => {
    it("opens the logical model drawer without deprecated Ant Design warnings", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const host = await render(<LogicalModelHarness channels={videoChannels} logicalModels={videoModels()} defaultModels={videoDefaults} />);

            await openVideoEditor(host);

            expect(consoleError.mock.calls.flat().join(" ")).not.toContain("[antd: Drawer] `width` is deprecated");
        } finally {
            consoleError.mockRestore();
        }
    });

    it("configures text input and output token limits while preserving the operational profile", async () => {
        const applied = vi.fn();
        const host = await render(<LogicalModelHarness channels={textChannels} logicalModels={textModels({ supportsAsync: false, timeoutMs: 180000, concurrencyLimit: 3 })} defaultModels={textDefaults} onApplied={applied} />);

        await openVideoEditor(host);
        expect(document.body.textContent).toContain("最大输入 Token");
        expect(document.body.textContent).toContain("最大输出 Token");
        await act(async () => fireEvent.change(fieldInput("最大输入 Token"), { target: { value: "1000000" } }));
        await act(async () => fireEvent.change(fieldInput("最大输出 Token"), { target: { value: "16384" } }));
        await userEvent.setup().click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement);

        expect(applied.mock.lastCall?.[0].logicalModels[0].bindings[0].capabilityProfile).toEqual({
            supportsAsync: false,
            timeoutMs: 180000,
            concurrencyLimit: 3,
            maxInputTokens: 1000000,
            maxOutputTokens: 16384,
        });
    });

    it("configures upstream idempotency while preserving the operational profile", async () => {
        const applied = vi.fn();
        const host = await render(
            <LogicalModelHarness channels={videoChannels} logicalModels={videoModels(undefined, { supportsAsync: true, supportsCancel: true, timeoutMs: 600000, concurrencyLimit: 2 })} defaultModels={videoDefaults} onApplied={applied} />,
        );

        await openVideoEditor(host);
        const idempotencyCheckbox = Array.from(document.querySelectorAll("label"))
            .find((item) => item.textContent?.includes("支持上游幂等"))
            ?.querySelector("input") as HTMLInputElement;
        expect(idempotencyCheckbox).toBeInstanceOf(HTMLInputElement);
        expect(idempotencyCheckbox.checked).toBe(false);
        await userEvent.setup().click(idempotencyCheckbox);
        await userEvent.setup().click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement);

        expect(applied.mock.lastCall?.[0].logicalModels[0].bindings[0].capabilityProfile).toEqual({
            supportsAsync: true,
            supportsCancel: true,
            supportsIdempotency: true,
            timeoutMs: 600000,
            concurrencyLimit: 2,
        });
    });

    it("enables every VOZEB option for only the selected binding", async () => {
        const channels = [...videoChannels, { ...videoChannels[0], id: "two", name: "备用渠道" }];
        const models = [
            {
                ...videoModels()[0],
                bindings: [
                    { id: "video:one", channelId: "one", upstreamModel: "video", enabled: true, priority: 1 },
                    { id: "video:two", channelId: "two", upstreamModel: "video", enabled: true, priority: 2 },
                ],
            },
        ];
        const applied = vi.fn();
        const host = await render(<LogicalModelHarness channels={channels} logicalModels={models} defaultModels={videoDefaults} onApplied={applied} />);

        await openVideoEditor(host);
        expect(document.body.textContent).not.toContain("支持生成音频");
        expect(document.body.textContent).not.toContain("支持水印");
        const quickButtons = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.includes("启用全部选项"));
        expect(quickButtons).toHaveLength(2);
        expect(document.body.textContent).toContain("快速模板只覆盖 VOZEB 当前选项，不代表上游已确认支持");
        await userEvent.setup().click(quickButtons[0]);
        expect(document.body.textContent).not.toContain("支持生成音频");
        expect(document.body.textContent).not.toContain("支持水印");
        await userEvent.setup().click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement);

        const quickProfile = applied.mock.lastCall?.[0].logicalModels[0].bindings[0].generationParameters;
        expect(quickProfile).toMatchObject({
            referenceInputs: ["image"],
            maxReferenceImages: 9,
            aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
            resolutions: ["480", "720", "1080", "2k", "4k"],
            durationMode: "discrete",
            durationSeconds: [5, 15],
            supportsCustomDuration: true,
            customDurationRange: { min: 4, max: 15 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 1, max: 30 },
            videoReferenceModes: ["reference", "first_frame", "first_last"],
            supportsCustomSize: true,
        });
        expect(applied.mock.lastCall?.[0].logicalModels[0].bindings[1].generationParameters).toBeUndefined();
    });

    it("asks for confirmation before replacing an existing capability profile", async () => {
        const existing = {
            referenceInputs: [],
            aspectRatios: ["16:9"],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: ["720"],
            durationMode: "discrete" as const,
            durationSeconds: [5],
            maxBatchSize: 1,
            videoReferenceModes: [],
            voices: [],
            formats: [],
        };
        const host = await render(<LogicalModelHarness channels={videoChannels} logicalModels={videoModels(existing)} defaultModels={videoDefaults} />);

        await openVideoEditor(host);
        await userEvent.setup().click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("重新启用全部选项")) as HTMLButtonElement);

        expect(document.body.textContent).toContain("覆盖当前能力配置？");
        expect(fieldInput("支持比例（逗号分隔）").value).toBe("16:9");
    });

    it("applies a custom exact size on blur without resetting an intermediate draft", async () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.logicalModels = [
            {
                id: "image",
                name: "图片",
                capability: "image",
                enabled: true,
                bindings: [
                    {
                        id: "image:one",
                        channelId: "one",
                        upstreamModel: "image",
                        enabled: true,
                        priority: 1,
                        generationParameters: {
                            referenceInputs: [],
                            aspectRatios: ["4:3"],
                            pixelSizes: [],
                            supportsCustomSize: true,
                            qualities: ["ultra"],
                            resolutions: [],
                            durationSeconds: [],
                            videoReferenceModes: [],
                            voices: [],
                            formats: [],
                            maxBatchSize: 2,
                        },
                    },
                ],
            },
        ];
        settings.defaultModels = { imageModel: "image", videoModel: "", textModel: "", audioModel: "", voiceCloneModel: "" };
        settings.generationDefaults.imageSize = "4:3";
        const onChange = vi.fn();
        const host = await render(<GenerationDefaultsPanel settings={settings} onChange={onChange} />);
        const input = host.querySelector('input[value="4:3"]') as HTMLInputElement;
        const user = userEvent.setup();

        await user.click(input);
        await user.clear(input);
        await user.type(input, "1920x1080");
        expect(onChange).not.toHaveBeenCalledWith("imageSize", "1");
        await user.tab();

        expect(onChange).toHaveBeenCalledWith("imageSize", "1920x1080");
    });

    it("applies an exact fractional duration inside the configured range", async () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.logicalModels = [
            {
                id: "video",
                name: "视频",
                capability: "video",
                enabled: true,
                bindings: [
                    {
                        id: "video:one",
                        channelId: "one",
                        upstreamModel: "video",
                        enabled: true,
                        priority: 1,
                        generationParameters: {
                            referenceInputs: [],
                            aspectRatios: ["16:9"],
                            pixelSizes: [],
                            supportsCustomSize: false,
                            qualities: [],
                            resolutions: ["1080"],
                            durationMode: "range",
                            durationSeconds: [],
                            durationRange: { min: 4.5, max: 7.5 },
                            videoReferenceModes: [],
                            voices: [],
                            formats: [],
                            maxBatchSize: 1,
                        },
                    },
                ],
            },
        ];
        settings.defaultModels = { imageModel: "", videoModel: "video", textModel: "", audioModel: "", voiceCloneModel: "" };
        settings.generationDefaults.videoSeconds = 5.5;
        const onChange = vi.fn();
        const host = await render(<GenerationDefaultsPanel settings={settings} onChange={onChange} />);
        const input = host.querySelector('input[value="5.5"]') as HTMLInputElement;
        const user = userEvent.setup();

        await user.click(input);
        await user.clear(input);
        await user.type(input, "5.5");
        await user.tab();

        expect(onChange).toHaveBeenCalledWith("videoSeconds", 5.5);
    });

    it("completes and applies discrete and range duration modes", async () => {
        const applied = vi.fn();
        const discrete = {
            referenceInputs: [],
            aspectRatios: [],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: ["1080"],
            durationMode: "discrete" as const,
            durationSeconds: [],
            videoReferenceModes: [],
            voices: [],
            formats: [],
            maxBatchSize: 1,
        };
        const host = await render(<LogicalModelHarness channels={videoChannels} logicalModels={videoModels(discrete)} defaultModels={videoDefaults} onApplied={applied} />);
        const user = userEvent.setup();

        await openVideoEditor(host);
        const durations = fieldInput("可选秒数（逗号分隔）");
        await user.type(durations, "5, 10");
        await user.tab();
        await act(async () => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement).click());
        expect(applied.mock.lastCall?.[0].logicalModels[0].bindings[0].generationParameters?.durationSeconds).toEqual([5, 10]);

        const rangeApplied = vi.fn();
        const range = { ...discrete, durationMode: "range" as const, durationSeconds: [], durationRange: { min: 1, max: 1 } };
        const rangeHost = await render(<LogicalModelHarness channels={videoChannels} logicalModels={videoModels(range)} defaultModels={videoDefaults} onApplied={rangeApplied} />);
        await openVideoEditor(rangeHost);
        const max = fieldInput("最长时长（秒）");
        await act(async () => fireEvent.change(max, { target: { value: "7.5" } }));
        await act(async () => fireEvent.change(fieldInput("最短时长（秒）"), { target: { value: "4.5" } }));
        await act(async () => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement).click());
        expect(rangeApplied.mock.lastCall?.[0].logicalModels[0].bindings[0].generationParameters?.durationRange).toEqual({ min: 4.5, max: 7.5 });
    });

    it("configures custom count and duration ranges without removing fixed options", async () => {
        const applied = vi.fn();
        const parameters = {
            referenceInputs: [],
            aspectRatios: [],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: ["1080"],
            durationMode: "discrete" as const,
            durationSeconds: [4, 15],
            maxBatchSize: 4,
            videoReferenceModes: [],
            voices: [],
            formats: [],
        };
        const host = await render(<LogicalModelHarness channels={videoChannels} logicalModels={videoModels(parameters)} defaultModels={videoDefaults} onApplied={applied} />);
        const user = userEvent.setup();

        await openVideoEditor(host);
        await user.click(screenCheckbox("允许自定义数量"));
        await user.click(screenCheckbox("允许自定义时长"));
        await act(async () => fireEvent.change(fieldInput("自定义数量上限"), { target: { value: "10" } }));
        await act(async () => fireEvent.change(fieldInput("自定义数量下限"), { target: { value: "5" } }));
        await act(async () => fireEvent.change(fieldInput("自定义时长上限（秒）"), { target: { value: "20" } }));
        await act(async () => fireEvent.change(fieldInput("自定义时长下限（秒）"), { target: { value: "3" } }));
        await user.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement);

        expect(applied.mock.lastCall?.[0].logicalModels[0].bindings[0].generationParameters).toMatchObject({
            durationMode: "discrete",
            durationSeconds: [4, 15],
            supportsCustomDuration: true,
            customDurationRange: { min: 3, max: 20 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 5, max: 10 },
        });
    });

    it("clears generation parameters without changing the operational profile", async () => {
        const applied = vi.fn();
        const operational = { supportsAsync: true, timeoutMs: 123000, concurrencyLimit: 7 };
        const host = await render(
            <LogicalModelHarness
                channels={videoChannels}
                logicalModels={videoModels(
                    {
                        referenceInputs: [],
                        aspectRatios: [],
                        pixelSizes: [],
                        supportsCustomSize: false,
                        qualities: [],
                        resolutions: ["1080"],
                        durationMode: "discrete",
                        durationSeconds: [5],
                        videoReferenceModes: [],
                        voices: [],
                        formats: [],
                        maxBatchSize: 1,
                    },
                    operational,
                )}
                defaultModels={videoDefaults}
                onApplied={applied}
            />,
        );

        await openVideoEditor(host);
        await act(async () => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("清除能力配置")) as HTMLButtonElement).click());
        await act(async () => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "应用修改") as HTMLButtonElement).click());

        expect(applied.mock.lastCall?.[0].logicalModels[0].bindings[0]).toMatchObject({ capabilityProfile: operational, generationParameters: undefined });
    });

    it("does not mutate nested generation parameters when cancelling", async () => {
        const original = videoModels({
            referenceInputs: [],
            aspectRatios: ["16:9"],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: ["1080"],
            durationMode: "range",
            durationSeconds: [],
            durationRange: { min: 4.5, max: 7.5 },
            videoReferenceModes: [],
            voices: [],
            formats: [],
            maxBatchSize: 1,
        });
        const snapshot = structuredClone(original);
        const host = await render(<LogicalModelHarness channels={videoChannels} logicalModels={original} defaultModels={videoDefaults} />);
        const user = userEvent.setup();

        await openVideoEditor(host);
        const min = fieldInput("最短时长（秒）");
        await user.clear(min);
        await user.type(min, "6.5");
        await user.click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "取消") as HTMLButtonElement);

        expect(original).toEqual(snapshot);
    });
});

function screenCheckbox(label: string) {
    return Array.from(document.querySelectorAll("label.ant-checkbox-wrapper")).find((item) => item.textContent?.trim() === label) as HTMLElement;
}
