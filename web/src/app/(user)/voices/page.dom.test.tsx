/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { App } from "antd";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";

const mocks = vi.hoisted(() => ({ fetchVoiceProfiles: vi.fn() }));

vi.mock("@/services/api/voice-profiles", async (importOriginal) => ({
    ...(await importOriginal()),
    fetchVoiceProfiles: mocks.fetchVoiceProfiles,
}));

vi.mock("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => ({ voiceCloneModel: "voice-clone" }),
}));

import VoicesPage from "./page";

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
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchVoiceProfiles.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
});

afterEach(cleanup);

describe("VoicesPage", () => {
    it("renders the preview modal without deprecated Ant Design warnings", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            render(
                <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
                    <App>
                        <VoicesPage />
                    </App>
                </NextIntlClientProvider>,
            );

            await waitFor(() => expect(mocks.fetchVoiceProfiles).toHaveBeenCalled());
            expect(consoleError.mock.calls.flat().join(" ")).not.toContain("[antd: Modal] `maskClosable` is deprecated");
        } finally {
            consoleError.mockRestore();
        }
    });
});
