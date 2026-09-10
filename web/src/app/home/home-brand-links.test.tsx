// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "antd";
import { LocaleProvider } from "@/i18n/locale-provider";
import { loadMessages } from "@/i18n/messages";
import { seoPublicationRegistry } from "@/i18n/routing";
import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store-foundation";
import { HomeActionsProvider } from "./home-actions";
import { HomeHeader } from "./home-header";
import { HomeFooter } from "./home-footer";

vi.mock("next/navigation", () => ({ usePathname: () => "/en/ai-agent", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/i18n/actions", () => ({ setLocalePreference: vi.fn() }));
afterEach(() => {
    cleanup();
    seoPublicationRegistry.home.published.en = true;
});

describe("publication-aware Home brand", () => {
    it.each([
        ["header", HomeHeader],
        ["footer", HomeFooter],
    ] as const)("keeps the %s brand visual but removes navigation when Home is unpublished", (_, Component) => {
        const mount = () =>
            render(
                <LocaleProvider locale="en" messages={loadMessages("en")} timeZone="UTC">
                    <App>
                        <HomeActionsProvider initialSite={{ ...DEFAULT_SITE_SETTINGS, title: "Brand fixture" }}>
                            <Component />
                        </HomeActionsProvider>
                    </App>
                </LocaleProvider>,
            );
        const published = mount();
        const link = screen.getByText("Brand fixture").closest("a");
        expect(link?.getAttribute("href")).toBe("/en");
        const brandClass = link?.className;
        const publishedLogo = link?.querySelector('img[src="/hx-favicon.png"]');
        expect(publishedLogo).not.toBeNull();
        const logoClass = publishedLogo!.getAttribute("class");
        published.unmount();
        seoPublicationRegistry.home.published.en = false;
        const unpublished = mount();
        const brand = screen.getByText("Brand fixture").parentElement;
        expect(brand?.closest("a")).toBeNull();
        expect(unpublished.container.querySelector('a[href="#"]')).toBeNull();
        expect(brand?.className).toBe(brandClass);
        const unpublishedLogo = brand?.querySelector('img[src="/hx-favicon.png"]');
        expect(unpublishedLogo).not.toBeNull();
        expect(unpublishedLogo!.getAttribute("class")).toBe(logoClass);
    });
});
