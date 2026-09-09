// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { App } from "antd";
import { loadMessages } from "@/i18n/messages";
import { seoPublicationRegistry } from "@/i18n/routing";
const navigation = vi.hoisted(() => ({ path: "/en/ai-agent", refresh: vi.fn(), replace: vi.fn(), setLocale: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.path, useRouter: () => ({ refresh: navigation.refresh }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }) }));
vi.mock("@/i18n/actions", () => ({ setLocalePreference: navigation.setLocale }));
import { LanguageSwitcher } from "./language-switcher";
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
);
beforeAll(() => {
    Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    seoPublicationRegistry["ai-agent"].published["zh-CN"] = true;
});
function mount() {
    render(
        <NextIntlClientProvider locale="en" messages={loadMessages("en")}>
            <App>
                <LanguageSwitcher />
            </App>
        </NextIntlClientProvider>,
    );
}
describe("language switching", () => {
    it("uses localized navigation for the same SEO page", async () => {
        navigation.path = "/en/ai-agent";
        mount();
        fireEvent.click(screen.getByRole("button", { name: "Change language" }));
        fireEvent.click(await screen.findByRole("menuitem", { name: "简体中文" }));
        await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/ai-agent", { locale: "zh-CN" }));
        expect(navigation.refresh).not.toHaveBeenCalled();
        expect(navigation.setLocale).not.toHaveBeenCalled();
    });
    it("keeps nonlocalized routes on native refresh to preserve client drafts", async () => {
        navigation.path = "/create";
        mount();
        fireEvent.click(screen.getByRole("button", { name: "Change language" }));
        fireEvent.click(await screen.findByRole("menuitem", { name: "简体中文" }));
        await waitFor(() => expect(navigation.refresh).toHaveBeenCalledOnce());
        expect(navigation.setLocale).toHaveBeenCalledWith("zh-CN");
        expect(navigation.replace).not.toHaveBeenCalled();
    });
    it("hides unpublished language destinations", async () => {
        navigation.path = "/en/ai-agent";
        seoPublicationRegistry["ai-agent"].published["zh-CN"] = false;
        mount();
        fireEvent.click(screen.getByRole("button", { name: "Change language" }));
        await screen.findByRole("menu");
        expect(screen.queryByRole("menuitem", { name: "简体中文" })).toBeNull();
    });
});
