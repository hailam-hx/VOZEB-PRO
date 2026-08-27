// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { NextIntlClientProvider } from "next-intl";
import { createRef, type ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";
import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";

import { ConversationAssets } from "./creative-assets-panel";
import { CreativeAssetMentionPicker } from "./creative-asset-mention-picker";
import { CreativeComposer } from "./creative-composer";
import { CreativeVideoFrameControls } from "./creative-video-frame-controls";

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

afterEach(() => cleanup());

describe("/create reference capability controls", () => {
    it("disables upload and conversation-reference entry points when the active model is unconfigured", async () => {
        const user = userEvent.setup();
        renderInteractive(<CreativeComposer {...composerProps()} referenceCapabilityState={{ reason: "unconfigured" }} />);

        for (const button of [screen.getByRole("button", { name: "添加素材" }), screen.getByRole("button", { name: "引用当前对话资产" })]) {
            expect((button as HTMLButtonElement).disabled).toBe(true);
            expect(button.getAttribute("aria-disabled")).toBe("true");
            const target = button.closest<HTMLElement>("[data-capability-tooltip]");
            await user.hover(target!);
            await waitFor(() => expect(screen.getAllByRole("tooltip").some((item) => item.textContent === "管理员尚未为该模型配置此能力")).toBe(true));
            await user.unhover(target!);
        }
    });

    it("explains the exact image-reference limit when no additional reference type is available", async () => {
        const user = userEvent.setup();
        const image = asset("stable-image", "image");
        renderInteractive(<CreativeComposer {...composerProps()} attachments={[image]} selectedAssetIds={[image.id]} referenceCapabilityState={{ reason: "unsupported", parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 1 }) }} />);

        const addButton = screen.getByRole("button", { name: "继续添加参考素材" });
        expect((addButton as HTMLButtonElement).disabled).toBe(true);
        await user.hover(addButton.closest<HTMLElement>("[data-capability-tooltip]")!);
        await waitFor(() => expect(screen.getAllByRole("tooltip").some((item) => item.textContent === "当前模型最多支持1张参考图")).toBe(true));
    });

    it("disables incompatible assets in the mention picker and conversation asset panel", async () => {
        const user = userEvent.setup();
        const video = asset("stable-video", "video");
        const state = { reason: "unsupported" as const, parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 1 }) };
        const mention = renderInteractive(<CreativeAssetMentionPicker assets={[video]} selectedAssetIds={[]} onSelect={() => undefined} referenceCapabilityState={state} selectedReferenceAssets={[]} />);
        const mentionButton = screen.getByRole("button", { name: "选择视频素材" });
        expect((mentionButton as HTMLButtonElement).disabled).toBe(true);
        expect(mentionButton.getAttribute("aria-disabled")).toBe("true");
        fireEvent.click(mentionButton.closest<HTMLElement>("[data-capability-tooltip]")!);
        await waitFor(() => expect(screen.getAllByRole("tooltip").some((item) => item.textContent === "当前模型不支持此参数")).toBe(true));

        mention.unmount();
        cleanup();
        renderInteractive(<ConversationAssets conversationId="conversation" assets={[video]} selectedAssetIds={[]} onToggle={() => undefined} onPreview={() => undefined} referenceCapabilityState={state} selectedReferenceAssets={[]} />);
        const panelButton = screen.getByRole("button", { name: "引用视频素材" });
        expect((panelButton as HTMLButtonElement).disabled).toBe(true);
        expect(panelButton.getAttribute("aria-disabled")).toBe("true");
        await user.hover(panelButton.closest<HTMLElement>("[data-capability-tooltip]")!);
        await waitFor(() => expect(screen.getAllByRole("tooltip").some((item) => item.textContent === "当前模型不支持此参数")).toBe(true));
    });

    it("shows the exact intersection image limit for a disabled conversation asset", async () => {
        const user = userEvent.setup();
        const candidate = asset("candidate-image", "image");
        renderInteractive(
            <ConversationAssets
                conversationId="conversation"
                assets={[candidate]}
                selectedAssetIds={[]}
                onToggle={() => undefined}
                onPreview={() => undefined}
                referenceCapabilityState={{ reason: "intersection", parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 2 }) }}
                selectedReferenceAssets={[asset("selected-image-one", "image"), asset("selected-image-two", "image")]}
            />,
        );

        const panelButton = screen.getByRole("button", { name: "引用图片素材" });
        expect((panelButton as HTMLButtonElement).disabled).toBe(true);
        await user.hover(panelButton.closest<HTMLElement>("[data-capability-tooltip]")!);
        await waitFor(() => expect(screen.getAllByRole("tooltip").some((item) => item.textContent === "并非所有已选模型都支持更多参考图（最多2张）")).toBe(true));
    });

    it("disables video frame selection and upload when image references are unsupported", async () => {
        const user = userEvent.setup();
        renderInteractive(
            <CreativeVideoFrameControls
                mode="first_frame"
                images={[]}
                uploading={false}
                placement="topLeft"
                onSelect={() => undefined}
                onUpload={() => undefined}
                onRemove={() => undefined}
                referenceCapabilityState={{ reason: "intersection", parameters: profile({ referenceInputs: ["video"] }) }}
                selectedReferenceAssets={[]}
            />,
        );
        const frameButton = screen.getByRole("button", { name: "添加视频首帧" });
        expect((frameButton as HTMLButtonElement).disabled).toBe(true);
        expect(frameButton.getAttribute("aria-disabled")).toBe("true");
        await user.hover(frameButton.closest<HTMLElement>("[data-capability-tooltip]")!);
        await waitFor(() => expect(screen.getAllByRole("tooltip").some((item) => item.textContent === "并非所有已选模型都支持此参数")).toBe(true));
    });

    it("allows an existing image to be assigned as a frame at the reference limit while disabling another upload", async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const image = asset("stable-image", "image");
        renderInteractive(
            <CreativeVideoFrameControls
                mode="first_frame"
                images={[image]}
                uploading={false}
                placement="topLeft"
                onSelect={onSelect}
                onUpload={() => undefined}
                onRemove={() => undefined}
                referenceCapabilityState={{ reason: "unsupported", parameters: profile({ referenceInputs: ["image"], maxReferenceImages: 1 }) }}
                selectedReferenceAssets={[image]}
            />,
        );

        const frameButton = screen.getByRole("button", { name: "添加视频首帧" });
        expect((frameButton as HTMLButtonElement).disabled).toBe(false);
        await user.click(frameButton);
        const existing = await screen.findByRole("button", { name: "设为首帧：图片素材" });
        expect((existing as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole("button", { name: "上传新图片" }) as HTMLButtonElement).disabled).toBe(true);
        await user.click(existing);
        expect(onSelect).toHaveBeenCalledWith("first_frame", image.id);
    });

    it("keeps configured audio references selectable from the conversation mention picker", async () => {
        const onSelect = vi.fn();
        const audio = asset("stable-audio", "audio");
        renderInteractive(<CreativeAssetMentionPicker assets={[audio]} selectedAssetIds={[]} referenceCapabilityState={{ reason: "unsupported", parameters: profile({ referenceInputs: ["audio"] }) }} selectedReferenceAssets={[]} onSelect={onSelect} />);

        const audioButton = screen.getByRole("button", { name: "选择音频素材" });
        expect((audioButton as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(audioButton);
        expect(onSelect).toHaveBeenCalledWith(audio);
    });
});

function renderInteractive(element: ReactElement) {
    return render(
        <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
            <App>{element}</App>
        </NextIntlClientProvider>,
    );
}

function composerProps() {
    return {
        inputRef: createRef<TextAreaRef | null>(),
        value: "生成一张图",
        busy: false,
        optimizing: false,
        onChange: vi.fn(),
        onOptimize: vi.fn(),
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        onAttachment: vi.fn(),
        onPasteImages: vi.fn(),
        attachments: [],
        referenceAssets: [],
        selectedAssetIds: [],
        skills: [],
        skillsLoading: false,
        models: [],
        selectedModels: [],
        smartPlanning: true,
        creationMode: "image" as const,
        generationPreferences: {},
        uploading: false,
        onRemoveAttachment: vi.fn(),
        onReferenceAsset: vi.fn(),
        onSelectSkill: vi.fn(),
        onRemoveSkill: vi.fn(),
        onToggleModel: vi.fn(),
        onClearModels: vi.fn(),
        onToggleSmartPlanning: vi.fn(),
        onChangeCreationMode: vi.fn(),
        onChangeGenerationCapability: vi.fn(),
        onChangeGenerationPreference: vi.fn(),
        onReplaceGenerationPreferences: vi.fn(),
        onSelectVideoFrame: vi.fn(),
        onUploadVideoFrame: vi.fn(),
        onRemoveVideoFrame: vi.fn(),
    };
}

function asset(id: string, type: "image" | "video" | "audio"): CreativeAsset {
    return {
        id,
        userId: "user",
        conversationId: "conversation",
        ordinal: 1,
        type,
        status: "ready",
        title: type === "image" ? "图片素材" : type === "video" ? "视频素材" : "音频素材",
        serverUrl: `/media/${id}.${type === "image" ? "webp" : type === "video" ? "mp4" : "mp3"}`,
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
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
