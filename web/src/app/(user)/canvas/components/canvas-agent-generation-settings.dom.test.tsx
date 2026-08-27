// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";

import { CanvasAgentGenerationSettings } from "./canvas-agent-generation-settings";

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

afterEach(() => cleanup());

describe("Canvas Agent generation settings accessibility", () => {
    it("keeps a profile-defined image quality in the request preferences selected through the shared control", async () => {
        const user = userEvent.setup();
        render(
            <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
                <RequestPreferenceHarness />
            </NextIntlClientProvider>,
        );

        await user.click(screen.getByRole("button", { name: /生成参数/ }));
        await user.click(screen.getByRole("tab", { name: "输出" }));
        await user.click(screen.getByRole("button", { name: /studio/i }));

        expect(screen.getByTestId("request-preferences").textContent).toBe('{"mode":"image","image":{"quality":"studio"}}');
    });

    it("does not announce a fabricated duration when video duration remains Smart", () => {
        render(
            <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
                <CanvasAgentGenerationSettings preferences={{ mode: "video", video: { size: "16:9", quality: "1080" } }} onChange={() => undefined} />
            </NextIntlClientProvider>,
        );

        const trigger = screen.getByRole("button", { name: /生成参数/ });
        expect(trigger.getAttribute("aria-label")).toContain("16:9");
        expect(trigger.getAttribute("aria-label")).toContain("1080P");
        expect(trigger.getAttribute("aria-label")).not.toMatch(/5\s*秒|5s/i);
    });

    it("does not announce a fabricated count when image count remains Smart", () => {
        render(
            <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
                <CanvasAgentGenerationSettings preferences={{ mode: "image", image: { size: "1:1", quality: "studio" } }} onChange={() => undefined} />
            </NextIntlClientProvider>,
        );

        const trigger = screen.getByRole("button", { name: /生成参数/ });
        expect(trigger.getAttribute("aria-label")).toContain("studio");
        expect(trigger.getAttribute("aria-label")).not.toMatch(/1\s*(张|个|image)/i);
    });
});

function RequestPreferenceHarness() {
    const [preferences, setPreferences] = useState<CreativeGenerationPreferences>({ mode: "image" });
    return (
        <>
            <CanvasAgentGenerationSettings
                preferences={preferences}
                generationParameters={{
                    referenceInputs: [],
                    aspectRatios: [],
                    pixelSizes: [],
                    supportsCustomSize: false,
                    qualities: ["studio"],
                    resolutions: [],
                    durationSeconds: [],
                    videoReferenceModes: [],
                    voices: [],
                    formats: [],
                }}
                onChange={setPreferences}
            />
            <output data-testid="request-preferences">{JSON.stringify(preferences)}</output>
        </>
    );
}
