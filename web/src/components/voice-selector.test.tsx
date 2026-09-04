// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "antd";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";

const mocks = vi.hoisted(() => ({ fetchPresets: vi.fn(), fetchProfiles: vi.fn() }));

vi.mock("@/services/api/voice-profiles", async (importOriginal) => ({
    ...(await importOriginal()),
    fetchPresetVoices: mocks.fetchPresets,
    fetchVoiceProfiles: mocks.fetchProfiles,
}));

import { VoiceSelector } from "./voice-selector";

beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }),
    });
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPresets.mockResolvedValue({ voices: [{ id: "alloy", name: "Alloy" }] });
    mocks.fetchProfiles.mockResolvedValue({ items: [{ id: "profile-one", name: "我的声音", status: "ready" }], total: 1, page: 1, pageSize: 100 });
});

afterEach(cleanup);

describe("VoiceSelector", () => {
    it("groups the current model presets and ready user profiles, then returns a stable profile selection", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        renderSelector(<VoiceSelector model="speech-model-a" value={{ type: "preset", voiceId: "alloy" }} onChange={onChange} />);

        expect(((await screen.findByRole("combobox", { name: "选择音色" })) as HTMLInputElement).disabled).toBe(false);
        expect(mocks.fetchProfiles).toHaveBeenCalledWith({ status: "ready", pageSize: 100 });
        await user.click(screen.getByRole("combobox", { name: "选择音色" }));
        expect(await screen.findByText("平台音色")).not.toBeNull();
        expect(screen.getByText("我的声音", { selector: ".ant-select-item-option-content" })).not.toBeNull();

        await user.click(screen.getByText("我的声音", { selector: ".ant-select-item-option-content" }));
        expect(onChange).toHaveBeenCalledWith({ type: "profile", voiceProfileId: "profile-one" });
    });

    it("resets an invalid preset after a model change to the first valid catalog voice", async () => {
        mocks.fetchPresets.mockResolvedValue({ voices: [{ id: "new-voice", name: "新音色" }] });
        const onChange = vi.fn();

        renderSelector(<VoiceSelector model="speech-model-b" value={{ type: "preset", voiceId: "removed-voice" }} onChange={onChange} />);

        await waitFor(() => expect(onChange).toHaveBeenCalledWith({ type: "preset", voiceId: "new-voice" }));
        expect(mocks.fetchPresets).toHaveBeenCalledWith("speech-model-b");
    });
});

function renderSelector(element: React.ReactElement) {
    return render(
        <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
            <App>{element}</App>
        </NextIntlClientProvider>,
    );
}
