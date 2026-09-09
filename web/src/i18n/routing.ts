import { defineRouting } from "next-intl/routing";

import { appLocales, defaultLocale, isAppLocale, localeCookieName, resolveLocale, type AppLocale } from "@/i18n/config";

export const seoPageIds = ["home", "ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent", "terms", "privacy"] as const;

export type SeoPageId = (typeof seoPageIds)[number];
export type SeoHreflang = "vi" | "en" | "zh-Hans" | "x-default";

export type SeoPagePublication<Path extends string = string> = {
    internalPath: Path;
    pathnames: Record<AppLocale, string>;
    published: Record<AppLocale, boolean>;
};

export type SeoPublicationRegistry = Record<SeoPageId, SeoPagePublication>;

function publishedSeoPage<const Path extends string>(internalPath: Path): SeoPagePublication<Path> {
    return {
        internalPath,
        pathnames: { vi: internalPath, en: internalPath, "zh-CN": internalPath },
        published: { vi: true, en: true, "zh-CN": true },
    };
}

export const seoPublicationRegistry = {
    home: publishedSeoPage("/"),
    "ai-image-generator": publishedSeoPage("/ai-image-generator"),
    "ai-video-generator": publishedSeoPage("/ai-video-generator"),
    "ai-voice-generator": publishedSeoPage("/ai-voice-generator"),
    "voice-cloning": publishedSeoPage("/voice-cloning"),
    "ai-short-drama": publishedSeoPage("/ai-short-drama"),
    "ai-agent": publishedSeoPage("/ai-agent"),
    terms: publishedSeoPage("/terms"),
    privacy: publishedSeoPage("/privacy"),
} satisfies SeoPublicationRegistry;

type SeoRoutingPathnames = {
    [PageId in SeoPageId as (typeof seoPublicationRegistry)[PageId]["internalPath"]]: (typeof seoPublicationRegistry)[PageId]["pathnames"];
};

const routingPathnames = Object.fromEntries(seoPageIds.map((pageId) => [seoPublicationRegistry[pageId].internalPath, seoPublicationRegistry[pageId].pathnames])) as SeoRoutingPathnames;
const localePathPrefixes = { vi: "", en: "/en", "zh-CN": "/zh-cn" } as const satisfies Record<AppLocale, string>;

export const routing = defineRouting({
    locales: appLocales,
    defaultLocale,
    localePrefix: { mode: "as-needed", prefixes: { "zh-CN": localePathPrefixes["zh-CN"] } },
    localeCookie: { name: localeCookieName },
    localeDetection: false,
    alternateLinks: false,
    pathnames: routingPathnames,
});

const hrefLangByLocale = { vi: "vi", en: "en", "zh-CN": "zh-Hans" } as const satisfies Record<AppLocale, Exclude<SeoHreflang, "x-default">>;

export function createSeoPublicationHelpers(registry: SeoPublicationRegistry) {
    function isPublished(pageId: SeoPageId, locale: AppLocale): boolean {
        return isSeoPageId(pageId) && isAppLocale(locale) && registry[pageId]?.published[locale] === true;
    }

    function getPagePath(pageId: SeoPageId, locale: AppLocale): string | null {
        if (!isPublished(pageId, locale)) return null;
        const pathname = registry[pageId].pathnames[locale];
        const prefix = localePathPrefixes[locale];
        return pathname === "/" ? prefix || "/" : `${prefix}${pathname}`;
    }

    function getAlternates(pageId: SeoPageId, base: URL): Partial<Record<SeoHreflang, string>> {
        const alternates: Partial<Record<SeoHreflang, string>> = {};
        for (const locale of appLocales) {
            const pathname = getPagePath(pageId, locale);
            if (pathname) alternates[hrefLangByLocale[locale]] = new URL(pathname, base).toString();
        }
        const vietnamesePath = getPagePath(pageId, defaultLocale);
        if (vietnamesePath) alternates["x-default"] = new URL(vietnamesePath, base).toString();
        return alternates;
    }

    return { isSeoPagePublished: isPublished, getSeoPagePath: getPagePath, getPublishedSeoAlternates: getAlternates };
}

const seoPublicationHelpers = createSeoPublicationHelpers(seoPublicationRegistry);

export function isSeoPagePublished(pageId: SeoPageId, locale: AppLocale) {
    return seoPublicationHelpers.isSeoPagePublished(pageId, locale);
}

export function getSeoPagePath(pageId: SeoPageId, locale: AppLocale) {
    return seoPublicationHelpers.getSeoPagePath(pageId, locale);
}

export function getPublishedSeoAlternates(pageId: SeoPageId, base: URL): Partial<Record<SeoHreflang, string>> {
    return seoPublicationHelpers.getPublishedSeoAlternates(pageId, base);
}

export function matchSeoRoute(pathname: string, registry: SeoPublicationRegistry = seoPublicationRegistry): { pageId: SeoPageId; locale: AppLocale; published: boolean; explicitPrefix: boolean } | null {
    const normalizedPath = normalizeSeoPathname(pathname);
    const prefixMatch = (
        [
            ["zh-CN", "/zh-cn"],
            ["en", "/en"],
            ["vi", "/vi"],
        ] as const
    ).find(([, prefix]) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
    const locale = prefixMatch?.[0] || defaultLocale;
    const localizedPath = prefixMatch ? normalizedPath.slice(prefixMatch[1].length) || "/" : normalizedPath;
    const pageId = seoPageIds.find((candidate) => normalizeSeoPathname(registry[candidate].pathnames[locale]) === localizedPath);
    if (!pageId) return null;
    return { pageId, locale, published: registry[pageId].published[locale], explicitPrefix: Boolean(prefixMatch) };
}

export function resolveRequestLocale({ pathname, cookieLocale, acceptLanguage }: { pathname: string; cookieLocale?: string | null; acceptLanguage?: string | null }): AppLocale {
    const route = matchSeoRoute(pathname);
    return resolveLocale({ routeLocale: route?.published ? route.locale : null, cookieLocale, acceptLanguage });
}

function normalizeSeoPathname(pathname: string) {
    if (!pathname.startsWith("/")) return `/${pathname.replace(/\/+$/, "")}`;
    return pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
}

function isSeoPageId(value: unknown): value is SeoPageId {
    return seoPageIds.includes(value as SeoPageId);
}

export function getLocalizedSeoHref(href: string, locale: string): string | null {
    const route = matchSeoRoute(href);
    return route && isAppLocale(locale) ? getSeoPagePath(route.pageId, locale) : href;
}
