import { describe, expect, expectTypeOf, it } from "vitest";

import type { AppLocale } from "@/i18n/config";
import {
    createSeoPublicationHelpers,
    getPublishedSeoAlternates,
    getSeoPagePath,
    isSeoPagePublished,
    matchSeoRoute,
    resolveRequestLocale,
    routing,
    seoPageIds,
    seoPublicationRegistry,
    type SeoHreflang,
    type SeoPageId,
    type SeoPublicationRegistry,
} from "@/i18n/routing";

const expectedSeoPaths = {
    home: { vi: "/", en: "/en", "zh-CN": "/zh-cn" },
    "ai-image-generator": { vi: "/ai-image-generator", en: "/en/ai-image-generator", "zh-CN": "/zh-cn/ai-image-generator" },
    "ai-video-generator": { vi: "/ai-video-generator", en: "/en/ai-video-generator", "zh-CN": "/zh-cn/ai-video-generator" },
    "ai-voice-generator": { vi: "/ai-voice-generator", en: "/en/ai-voice-generator", "zh-CN": "/zh-cn/ai-voice-generator" },
    "voice-cloning": { vi: "/voice-cloning", en: "/en/voice-cloning", "zh-CN": "/zh-cn/voice-cloning" },
    "ai-short-drama": { vi: "/ai-short-drama", en: "/en/ai-short-drama", "zh-CN": "/zh-cn/ai-short-drama" },
    "ai-agent": { vi: "/ai-agent", en: "/en/ai-agent", "zh-CN": "/zh-cn/ai-agent" },
    terms: { vi: "/terms", en: "/en/terms", "zh-CN": "/zh-cn/terms" },
    privacy: { vi: "/privacy", en: "/en/privacy", "zh-CN": "/zh-cn/privacy" },
} as const satisfies Record<SeoPageId, Record<AppLocale, string>>;

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
        expectTypeOf(getPublishedSeoAlternates).returns.toEqualTypeOf<Partial<Record<SeoHreflang, string>>>();
    });

    it("publishes all nine page IDs in all three locales", () => {
        expect(seoPageIds).toEqual(["home", "ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent", "terms", "privacy"]);
        expect(seoPageIds.flatMap((pageId) => Object.entries(seoPublicationRegistry[pageId].published))).toHaveLength(27);
        expect(seoPageIds.every((pageId) => Object.values(seoPublicationRegistry[pageId].published).every(Boolean))).toBe(true);
    });

    it("pins every canonical page and locale path, route match, and published alternate", () => {
        const base = new URL("https://example.com/base/");

        for (const pageId of seoPageIds) {
            const paths = expectedSeoPaths[pageId];
            for (const locale of ["vi", "en", "zh-CN"] as const) {
                expect(getSeoPagePath(pageId, locale), `${pageId}/${locale} canonical path`).toBe(paths[locale]);
                expect(matchSeoRoute(paths[locale]), `${pageId}/${locale} route match`).toEqual({
                    pageId,
                    locale,
                    published: true,
                    explicitPrefix: locale !== "vi",
                });
            }
            expect(getPublishedSeoAlternates(pageId, base), `${pageId} alternates`).toEqual({
                vi: new URL(paths.vi, base).toString(),
                en: new URL(paths.en, base).toString(),
                "zh-Hans": new URL(paths["zh-CN"], base).toString(),
                "x-default": new URL(paths.vi, base).toString(),
            });
        }
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

    it("matches the legacy explicit Vietnamese prefix without making it canonical", () => {
        expect(matchSeoRoute("/vi/privacy")).toEqual({ pageId: "privacy", locale: "vi", published: true, explicitPrefix: true });
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
