// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "antd";
import { LocaleProvider } from "@/i18n/locale-provider";
import { loadMessages } from "@/i18n/messages";
import { seoPublicationRegistry } from "@/i18n/routing";
import { applyPublicSiteSettings, resetPublicSession } from "@/stores/use-public-session-store";
import { AuthForm } from "./auth-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
    cleanup();
    resetPublicSession();
    seoPublicationRegistry.terms.published.en = true;
    seoPublicationRegistry.privacy.published["zh-CN"] = true;
});

function mount(locale: "en" | "zh-CN", termsUrl?: string, privacyUrl?: string) {
    applyPublicSiteSettings({ title: "Legal fixture", logoUrl: "/logo.svg", termsUrl, privacyUrl });
    return render(
        <LocaleProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
            <App>
                <AuthForm mode="register" variant="embedded" />
            </App>
        </LocaleProvider>,
    );
}

describe("registration legal destinations", () => {
    for (const [locale, prefix, terms, privacy] of [
        ["en", "/en", "Terms of service", "Privacy policy"],
        ["zh-CN", "/zh-cn", "服务条款", "隐私政策"],
    ] as const) {
        it.each([
            [undefined, undefined],
            ["", "  "],
            ["/terms", "/privacy"],
        ])(`localizes default or blank legal links in ${locale}`, (termsUrl, privacyUrl) => {
            mount(locale, termsUrl, privacyUrl);
            expect(screen.getByRole("link", { name: terms }).getAttribute("href")).toBe(`${prefix}/terms`);
            expect(screen.getByRole("link", { name: privacy }).getAttribute("href")).toBe(`${prefix}/privacy`);
        });
        it(`preserves administrator external and non-built-in destinations in ${locale}`, () => {
            mount(locale, "https://legal.example.com/terms?lang=custom&version=2", "/help?section=privacy");
            expect(screen.getByRole("link", { name: terms }).getAttribute("href")).toBe("https://legal.example.com/terms?lang=custom&version=2");
            expect(screen.getByRole("link", { name: privacy }).getAttribute("href")).toBe("/help?section=privacy");
        });
        it(`resolves either exact built-in legal destination in ${locale}`, () => {
            mount(locale, "/privacy", "/terms");
            expect(screen.getByRole("link", { name: terms }).getAttribute("href")).toBe(`${prefix}/privacy`);
            expect(screen.getByRole("link", { name: privacy }).getAttribute("href")).toBe(`${prefix}/terms`);
        });
        it(`keeps consent labels but omits an unpublished ${locale} legal anchor`, () => {
            if (locale === "en") seoPublicationRegistry.terms.published.en = false;
            else seoPublicationRegistry.privacy.published["zh-CN"] = false;
            mount(locale, "/terms", "/privacy");
            expect(screen.queryByRole("link", { name: locale === "en" ? terms : privacy })).toBeNull();
            expect(screen.getByRole("checkbox").closest("label")?.textContent).toContain(terms);
            expect(screen.getByRole("checkbox").closest("label")?.textContent).toContain(privacy);
            expect(screen.getByRole("link", { name: locale === "en" ? privacy : terms })).toBeTruthy();
        });
    }
});
