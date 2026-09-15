/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { App } from "antd";
import { LocaleProvider } from "@/i18n/locale-provider";
import { loadMessages } from "@/i18n/messages";
import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store-foundation";
import { applyPublicSiteSettings, resetPublicSession } from "@/stores/use-public-session-store";

import { HomeActionsProvider } from "./home-actions";
import { HomeFooter } from "./home-footer";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/i18n/actions", () => ({ setLocalePreference: vi.fn() }));

afterEach(() => {
    cleanup();
    resetPublicSession();
});

function renderFooter(locale: "vi" | "en" | "zh-CN", customerService: typeof DEFAULT_SITE_SETTINGS.customerService) {
    return render(
        <LocaleProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
            <App>
                <HomeActionsProvider initialSite={{ ...DEFAULT_SITE_SETTINGS, title: "Brand fixture", customerService }}>
                    <HomeFooter />
                </HomeActionsProvider>
            </App>
        </LocaleProvider>,
    );
}

describe("HomeFooter customer service", () => {
    it("does not render a customer-service landmark when every public field is empty", () => {
        renderFooter("en", { businessName: "", phone: "", email: "", address: "" });

        expect(screen.queryByRole("region", { name: "Customer service" })).toBeNull();
    });

    it("uses customer-service settings delivered by the public session", () => {
        renderFooter("en", { businessName: "", phone: "", email: "", address: "" });

        act(() =>
            applyPublicSiteSettings({
                title: "Brand fixture",
                logoUrl: "/hx-favicon.png",
                customerService: { businessName: "Session business", phone: "", email: "", address: "" },
            }),
        );

        expect(screen.getByRole("region", { name: "Customer service" }).textContent).toContain("Session business");
    });

    it.each([
        ["vi", "Dịch vụ khách hàng", "Tên doanh nghiệp", "Điện thoại", "Email", "Địa chỉ"],
        ["en", "Customer service", "Business name", "Phone", "Email", "Address"],
        ["zh-CN", "客户服务", "企业名称", "电话", "邮箱", "地址"],
    ] as const)("localizes every customer-service label in %s", (locale, title, businessName, phone, email, address) => {
        renderFooter(locale, { businessName: "HOTX AI", phone: "+84 123", email: "support@example.com", address: "胡志明市" });

        const section = screen.getByRole("region", { name: title });
        expect(section.textContent).toContain(businessName);
        expect(section.textContent).toContain(phone);
        expect(section.textContent).toContain(email);
        expect(section.textContent).toContain(address);
    });

    it("renders only configured rows with exact telephone and email links as text", () => {
        renderFooter("en", { businessName: "<strong>HOTX</strong>", phone: "+84 123 456", email: "support@example.com", address: "" });

        const section = screen.getByRole("region", { name: "Customer service" });
        expect(section.textContent).toContain("<strong>HOTX</strong>");
        expect(section.querySelector("strong")).toBeNull();
        expect(screen.getByRole("link", { name: "+84 123 456" }).getAttribute("href")).toBe("tel:+84 123 456");
        expect(screen.getByRole("link", { name: "support@example.com" }).getAttribute("href")).toBe("mailto:support@example.com");
        expect(section.textContent).not.toContain("Address");
    });
});
