// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "antd";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CreativeGenerationControls, type CreativeModelOption } from "@/app/(user)/create/components/creative-generation-controls";
import { CreativeGenerationPreferences } from "@/components/creative-generation-preferences";
import { loadMessages } from "@/i18n/messages";
import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";

import { SuggestedPositiveIntegerField, VideoQualityField } from "./creative-generation-preference-fields";

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
    HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("capability-aware generation preference components", () => {
    it("opens the disabled button tooltip by focus and touch-compatible click", async () => {
        const user = userEvent.setup();
        renderInteractive(
            <VideoQualityField
                value={undefined}
                options={[
                    { value: "auto", label: "智能" },
                    { value: "1080", label: "1080P", supported: false },
                ]}
                disabledReason="管理员尚未为该模型配置此能力"
                onChange={() => undefined}
            />,
        );

        const disabled = screen.getByRole("button", { name: "选择视频清晰度 1080P" });
        const target = disabled.closest<HTMLElement>("[data-capability-tooltip]");
        expect((disabled as HTMLButtonElement).disabled).toBe(true);
        expect(disabled.getAttribute("aria-disabled")).toBe("true");
        expect(target?.getAttribute("tabindex")).toBe("0");

        target!.focus();
        expect((await screen.findByRole("tooltip")).textContent).toContain("管理员尚未为该模型配置此能力");
        target!.blur();
        fireEvent.mouseLeave(target!);
        await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
        fireEvent.click(target!);
        expect((await screen.findByRole("tooltip")).textContent).toContain("管理员尚未为该模型配置此能力");
        await user.unhover(target!);
    });

    it("keeps an unsupported numeric input natively disabled and explains it on hover", async () => {
        const user = userEvent.setup();
        renderInteractive(<SuggestedPositiveIntegerField label="时长" ariaLabel="输入视频时长" value={undefined} suffix="秒" options={[]} customEnabled={false} disabledReason="并非所有已选模型都支持此参数" onChange={() => undefined} />);

        const input = screen.getByRole("spinbutton", { name: "输入视频时长" });
        const target = input.closest<HTMLElement>("[data-capability-tooltip]");
        expect((input as HTMLInputElement).disabled).toBe(true);
        expect(input.getAttribute("aria-disabled")).toBe("true");
        await user.hover(target!);
        expect((await screen.findByRole("tooltip")).textContent).toContain("并非所有已选模型都支持此参数");
    });

    it("keeps duration presets and the custom input in one row group", () => {
        renderInteractive(
            <SuggestedPositiveIntegerField
                label="时长"
                ariaLabel="输入视频时长"
                value={undefined}
                suffix="秒"
                options={[
                    { value: 4, label: "4 秒" },
                    { value: 15, label: "15 秒" },
                ]}
                customEnabled
                onChange={() => undefined}
            />,
        );

        const row = screen.getByRole("group", { name: "时长" });
        expect(row.contains(screen.getByRole("button", { name: "输入视频时长 4 秒" }))).toBe(true);
        expect(row.contains(screen.getByRole("button", { name: "输入视频时长 15 秒" }))).toBe(true);
        expect(row.contains(screen.getByRole("spinbutton", { name: "输入视频时长" }))).toBe(true);
    });

    it("selects configured extra image and audio values through the real controls", async () => {
        const user = userEvent.setup();
        const imageChange = vi.fn();
        const view = renderInteractive(<CreativeGenerationPreferences capability="image" preferences={{}} generationParameters={profile({ qualities: ["studio"] })} capabilityReason="unsupported" triggerAriaLabel="打开图片参数" onChange={imageChange} />);
        await user.click(screen.getByRole("button", { name: "打开图片参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));
        await user.click(screen.getByRole("button", { name: "选择图片画质 studio" }));
        expect(imageChange).toHaveBeenCalledWith({ quality: "studio" });

        view.unmount();
        cleanup();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url.startsWith("/api/audio-voices/presets")) return Response.json({ code: 0, data: { voices: [{ id: "narrator-pro", name: "narrator-pro" }] }, msg: "ok" });
                if (url.startsWith("/api/voice-profiles")) return Response.json({ code: 0, data: { items: [], total: 0, page: 1, pageSize: 100 }, msg: "ok" });
                throw new Error(`unexpected request: ${url}`);
            }),
        );
        const audioChange = vi.fn();
        renderInteractive(
            <CreativeGenerationPreferences capability="audio" preferences={{}} generationParameters={profile({ voices: ["narrator-pro"], formats: ["m4a"] })} capabilityReason="unsupported" triggerAriaLabel="打开音频参数" onChange={audioChange} />,
        );
        await user.click(screen.getByRole("button", { name: "打开音频参数" }));
        const voice = screen.getByRole("combobox", { name: "选择音色" });
        await user.click(voice);
        await user.click(await screen.findByText("narrator-pro"));
        expect(audioChange).toHaveBeenCalledWith({ voiceSelection: { type: "preset", voiceId: "narrator-pro" } });
    });

    it("offers 2K and 4K presets without exposing configured extra video resolutions", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderInteractive(
            <CreativeGenerationPreferences
                capability="video"
                preferences={{}}
                generationParameters={profile({ resolutions: ["2k", "4k", "1440"] })}
                capabilityReason="unsupported"
                triggerAriaLabel="打开视频参数"
                showCustomVideoResolution={false}
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));
        const twoK = screen.getByRole("button", { name: "选择视频清晰度 2K" });
        const fourK = screen.getByRole("button", { name: "选择视频清晰度 4K" });
        expect((twoK as HTMLButtonElement).disabled).toBe(false);
        expect((fourK as HTMLButtonElement).disabled).toBe(false);
        await user.click(twoK);
        expect(onChange).toHaveBeenCalledWith({ quality: "2k" });
        expect(screen.queryByRole("button", { name: "选择视频清晰度 自定义" })).toBeNull();
        expect(screen.queryByRole("textbox", { name: "输入自定义视频清晰度" })).toBeNull();
    });

    it("keeps configured extra video resolutions available on shared settings surfaces", async () => {
        const user = userEvent.setup();
        renderInteractive(<CreativeGenerationPreferences capability="video" preferences={{}} generationParameters={profile({ resolutions: ["1440"] })} capabilityReason="unsupported" triggerAriaLabel="打开视频参数" onChange={() => undefined} />);

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));
        const custom = screen.getByRole("button", { name: "选择视频清晰度 自定义" });
        expect((custom as HTMLButtonElement).disabled).toBe(false);
        await user.click(custom);
        expect(screen.getByRole("textbox", { name: "输入自定义视频清晰度" })).toBeTruthy();
    });

    it("does not mark a configured exact pixel size as a custom-size selection", async () => {
        const user = userEvent.setup();
        renderInteractive(
            <CreativeGenerationPreferences
                capability="image"
                preferences={{ image: { size: "1024x1024" } }}
                generationParameters={profile({ pixelSizes: ["1024x1024"], supportsCustomSize: false })}
                capabilityReason="unsupported"
                triggerAriaLabel="打开图片参数"
                onChange={() => undefined}
            />,
        );

        await user.click(screen.getByRole("button", { name: "打开图片参数" }));
        const listed = screen.getByRole("button", { name: "选择图片比例 1024×1024" });
        const custom = screen.getByRole("button", { name: "打开图片自定义像素尺寸" });
        expect(listed.getAttribute("aria-pressed")).toBe("true");
        expect((custom as HTMLButtonElement).disabled).toBe(true);
        expect(custom.getAttribute("aria-pressed")).toBe("false");
    });

    it("keeps video audio and watermark as compact switches outside binding capabilities", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderInteractive(
            <CreativeGenerationPreferences capability="video" preferences={{ video: { generateAudio: true, watermark: false } }} generationParameters={profile()} capabilityReason="unsupported" triggerAriaLabel="打开视频参数" onChange={onChange} />,
        );

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));

        const generateAudio = screen.getByRole("switch", { name: "生成声音" });
        const watermark = screen.getByRole("switch", { name: "添加水印" });
        expect(generateAudio.getAttribute("aria-checked")).toBe("true");
        expect(watermark.getAttribute("aria-checked")).toBe("false");

        await user.click(generateAudio);
        await user.click(watermark);
        expect(onChange).toHaveBeenCalledWith({ generateAudio: false });
        expect(onChange).toHaveBeenCalledWith({ watermark: true });
    });

    it("does not offer an automatic video reference mode", async () => {
        const user = userEvent.setup();
        renderInteractive(
            <CreativeGenerationPreferences
                capability="video"
                preferences={{}}
                generationParameters={profile({ videoReferenceModes: ["reference", "first_frame", "first_last"] })}
                capabilityReason="unsupported"
                triggerAriaLabel="打开视频参数"
                onChange={() => undefined}
            />,
        );

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));

        expect(screen.queryByRole("button", { name: "选择视频参考方式 智能" })).toBeNull();
        expect((screen.getByRole("button", { name: "选择视频参考方式 智能参考" }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole("button", { name: "选择视频参考方式 首帧" }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole("button", { name: "选择视频参考方式 首尾帧" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("keeps fixed count and duration buttons while enabling configured custom ranges", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderInteractive(
            <CreativeGenerationPreferences
                capability="video"
                preferences={{}}
                generationParameters={profile({
                    durationMode: "discrete",
                    durationSeconds: [4, 15],
                    supportsCustomDuration: true,
                    customDurationRange: { min: 3, max: 20 },
                    maxBatchSize: 4,
                    supportsCustomBatchSize: true,
                    customBatchSizeRange: { min: 5, max: 10 },
                })}
                capabilityReason="unsupported"
                triggerAriaLabel="打开视频参数"
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));
        expect((screen.getByRole("button", { name: "选择视频生成数量 4 份" }) as HTMLButtonElement).disabled).toBe(false);
        expect(screen.queryByRole("button", { name: "输入视频时长 智能" })).toBeNull();
        expect((screen.getByRole("button", { name: "输入视频时长 4 秒" }) as HTMLButtonElement).disabled).toBe(false);

        const count = screen.getByRole("textbox", { name: "自定义生成数量" });
        const duration = screen.getByRole("spinbutton", { name: "输入视频时长" });
        expect((count as HTMLInputElement).disabled).toBe(false);
        expect((duration as HTMLInputElement).disabled).toBe(false);
        await user.type(count, "7");
        await user.type(duration, "7");
        expect(onChange).toHaveBeenCalledWith({ count: 7 });
        expect(onChange).toHaveBeenCalledWith({ seconds: 7 });
    });

    it("accepts a multi-digit custom count typed one digit at a time", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderInteractive(
            <CreativeGenerationPreferences
                capability="video"
                preferences={{}}
                generationParameters={profile({ maxBatchSize: 4, supportsCustomBatchSize: true, customBatchSizeRange: { min: 1, max: 30 } })}
                capabilityReason="unsupported"
                triggerAriaLabel="打开视频参数"
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));
        const count = screen.getByRole("textbox", { name: "自定义生成数量" }) as HTMLInputElement;
        await user.type(count, "28");

        expect(count.value).toBe("28");
        expect(onChange).toHaveBeenLastCalledWith({ count: 28 });
    });

    it("shows the configured five-second default as the selected duration", async () => {
        const user = userEvent.setup();
        renderInteractive(
            <CreativeGenerationPreferences
                capability="video"
                preferences={{}}
                generationParameters={profile({ durationMode: "discrete", durationSeconds: [5, 15] })}
                capabilityReason="unsupported"
                triggerAriaLabel="打开视频参数"
                onChange={() => undefined}
            />,
        );

        await user.click(screen.getByRole("button", { name: "打开视频参数" }));
        await user.click(await screen.findByRole("tab", { name: "输出" }));

        expect(screen.queryByRole("button", { name: "输入视频时长 4 秒" })).toBeNull();
        expect(screen.getByRole("button", { name: "输入视频时长 5 秒" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("sanitizes stale preferences after a capability transition and switches tabs with a manually selected model", async () => {
        const user = userEvent.setup();
        const replace = vi.fn();
        const toggle = vi.fn();
        const capabilityChange = vi.fn();
        const image = model("image-model", "image", profile({ qualities: ["studio"] }));
        const video = model("video-model", "video", profile({ resolutions: ["720"] }));
        const props = {
            models: [image, video],
            selectedModels: [image],
            smartPlanning: false,
            creationMode: "agent" as const,
            generationPreferences: { mode: "image" as const, image: { quality: "studio" } },
            placement: "topLeft" as const,
            onToggleModel: toggle,
            onClearModels: vi.fn(),
            onToggleSmartPlanning: vi.fn(),
            onCapabilityChange: capabilityChange,
            onChangeGenerationPreference: vi.fn(),
            onReplaceGenerationPreferences: replace,
        };
        const view = renderInteractive(<CreativeGenerationControls {...props} />);
        const changedImage = model("image-model", "image", profile({ qualities: ["draft"] }));

        view.rerender(withProviders(<CreativeGenerationControls {...props} models={[changedImage, video]} selectedModels={[changedImage]} />));
        await waitFor(() => expect(replace).toHaveBeenCalledWith({ mode: "image" }));

        await user.click(screen.getByRole("button", { name: /生成模型/ }));
        await user.click(await screen.findByRole("button", { name: "视频 · 1" }));
        await user.click(await screen.findByRole("button", { name: /video-model/i }));
        expect(capabilityChange).toHaveBeenCalledWith("video");
        expect(toggle).toHaveBeenCalledWith(video);
    });

    it("resets a configured non-preset video resolution to automatic on create", async () => {
        const replace = vi.fn();
        const video = model("video-model", "video", profile({ resolutions: ["2k", "4k", "1440"] }));

        renderInteractive(
            <CreativeGenerationControls
                models={[video]}
                selectedModels={[video]}
                smartPlanning={false}
                creationMode="video"
                generationPreferences={{ mode: "video", video: { quality: "1440" } }}
                placement="topLeft"
                onToggleModel={vi.fn()}
                onClearModels={vi.fn()}
                onToggleSmartPlanning={vi.fn()}
                onCapabilityChange={vi.fn()}
                onChangeGenerationPreference={vi.fn()}
                onReplaceGenerationPreferences={replace}
            />,
        );

        await waitFor(() => expect(replace).toHaveBeenCalledWith({ mode: "video" }));
    });
});

function renderInteractive(element: ReactElement) {
    return render(withProviders(element));
}

function withProviders(element: ReactElement) {
    return (
        <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
            <App>{element}</App>
        </NextIntlClientProvider>
    );
}

function model(id: string, capability: CreativeModelOption["capability"], generationParameters: LogicalModelGenerationParameters): CreativeModelOption {
    return { id, name: id, capability, generationParameters };
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
