import { describe, expect, it } from "vitest";

import type { AppLocale } from "@/i18n/config";
import { createSeoPublicationHelpers, getPublishedSeoAlternates, getSeoPagePath, isSeoPagePublished, matchSeoRoute, resolveRequestLocale, routing, seoPageIds, seoPublicationRegistry, type SeoPageId, type SeoPublicationRegistry } from "@/i18n/routing";

describe("localized SEO routing", () => {
    it("defines the typed next-intl routing contract without automatic detection or Link headers", () => {
        expect(routing).toMatchObject({
            locales: ["vi", "en", "zh-CN"],
            defaultLocale: "vi",
            localePrefix: { mode: "as-needed", prefixes: { "zh-CN": "/zh-cn" } },
            localeCookie: { name: "vozeb-pro-locale" },
            localeDetection: false,
            alternateLinks: false,
        });
        expect(Object.keys(routing.pathnames)).toEqual(["/", "/ai-image-generator", "/ai-video-generator", "/ai-voice-generator", "/voice-cloning", "/ai-short-drama", "/ai-agent", "/terms", "/privacy"]);
    });

    it("publishes all nine page IDs in all three locales", () => {
        expect(seoPageIds).toEqual(["home", "ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent", "terms", "privacy"]);
        expect(seoPageIds.flatMap((pageId) => Object.entries(seoPublicationRegistry[pageId].published))).toHaveLength(27);
        expect(seoPageIds.every((pageId) => Object.values(seoPublicationRegistry[pageId].published).every(Boolean))).toBe(true);
    });

    it("builds canonical external paths with the custom Simplified Chinese prefix", () => {
        expect(getSeoPagePath("home", "vi")).toBe("/");
        expect(getSeoPagePath("home", "en")).toBe("/en");
        expect(getSeoPagePath("home", "zh-CN")).toBe("/zh-cn");
        expect(getSeoPagePath("terms", "vi")).toBe("/terms");
        expect(getSeoPagePath("terms", "en")).toBe("/en/terms");
        expect(getSeoPagePath("terms", "zh-CN")).toBe("/zh-cn/terms");
    });

    it("builds absolute published hreflang alternates and maps x-default to Vietnamese", () => {
        expect(getPublishedSeoAlternates("terms", new URL("https://example.com/base/"))).toEqual({
            vi: "https://example.com/terms",
            en: "https://example.com/en/terms",
            "zh-Hans": "https://example.com/zh-cn/terms",
            "x-default": "https://example.com/terms",
        });
    });

    it("rejects invalid and unpublished locale/page pairs", () => {
        const registry: SeoPublicationRegistry = {
            ...seoPublicationRegistry,
            terms: {
                ...seoPublicationRegistry.terms,
                published: { ...seoPublicationRegistry.terms.published, en: false },
            },
        };
        const helpers = createSeoPublicationHelpers(registry);

        expect(helpers.isSeoPagePublished("terms", "vi")).toBe(true);
        expect(helpers.isSeoPagePublished("terms", "en")).toBe(false);
        expect(isSeoPagePublished("gallery" as SeoPageId, "en")).toBe(false);
        expect(isSeoPagePublished("terms", "fr" as AppLocale)).toBe(false);
        expect(getSeoPagePath("gallery" as SeoPageId, "en")).toBeNull();
        expect(getSeoPagePath("terms", "fr" as AppLocale)).toBeNull();
        expect(helpers.getSeoPagePath("terms", "en")).toBeNull();
        expect(helpers.getPublishedSeoAlternates("terms", new URL("https://example.com"))).toEqual({
            vi: "https://example.com/terms",
            "zh-Hans": "https://example.com/zh-cn/terms",
            "x-default": "https://example.com/terms",
        });
        expect(matchSeoRoute("/en/terms", registry)).toEqual({ pageId: "terms", locale: "en", published: false, explicitPrefix: true });
    });

    it.each([
        ["/", { pageId: "home", locale: "vi", published: true, explicitPrefix: false }],
        ["/en", { pageId: "home", locale: "en", published: true, explicitPrefix: true }],
        ["/zh-cn/ai-agent/", { pageId: "ai-agent", locale: "zh-CN", published: true, explicitPrefix: true }],
        ["/vi/privacy", { pageId: "privacy", locale: "vi", published: true, explicitPrefix: true }],
    ] as const)("matches SEO route %s", (pathname, expected) => {
        expect(matchSeoRoute(pathname)).toEqual(expected);
    });

    it.each(["/en/gallery", "/zh-cn/announcements", "/en/share/work", "/zh-cn/u/creator", "/en/create", "/zh-cn/admin", "/fr/terms", "/en/terms/extra"])("does not localize excluded path %s", (pathname) => {
        expect(matchSeoRoute(pathname)).toBeNull();
    });

    it("lets valid SEO URLs choose the request locale while excluded routes keep cookie and header negotiation", () => {
        expect(resolveRequestLocale({ pathname: "/en/terms", cookieLocale: "zh-CN", acceptLanguage: "vi" })).toBe("en");
        expect(resolveRequestLocale({ pathname: "/zh-cn/ai-agent", cookieLocale: "vi", acceptLanguage: "en" })).toBe("zh-CN");
        expect(resolveRequestLocale({ pathname: "/privacy", cookieLocale: "en", acceptLanguage: "zh-CN" })).toBe("vi");
        expect(resolveRequestLocale({ pathname: "/en/gallery", cookieLocale: "zh-CN", acceptLanguage: "vi" })).toBe("zh-CN");
        expect(resolveRequestLocale({ pathname: "/create", cookieLocale: "en", acceptLanguage: "zh-CN" })).toBe("en");
    });
});
