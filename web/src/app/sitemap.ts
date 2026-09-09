import type { MetadataRoute } from "next";

import { type SeoLandingSlug } from "@/app/seo-landings/seo-landing-data";
import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";
import { listPublicWorkSitemapEntries } from "@/lib/server/work-governance-service";

import { appLocales } from "@/i18n/config";
import { seoPageIds, getSeoPagePath } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const landingPriorities: Record<SeoLandingSlug, number> = {
    "ai-image-generator": 0.9,
    "ai-video-generator": 0.9,
    "ai-voice-generator": 0.9,
    "voice-cloning": 0.9,
    "ai-short-drama": 0.8,
    "ai-agent": 0.8,
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const base = siteMetadataBase();
    const staticPages: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
        ...seoPageIds.flatMap((pageId) =>
            appLocales.flatMap((locale) => {
                const path = getSeoPagePath(pageId, locale);
                if (!path) return [];
                return [
                    {
                        path,
                        changeFrequency: pageId === "home" ? ("daily" as const) : pageId === "terms" || pageId === "privacy" ? ("yearly" as const) : ("weekly" as const),
                        priority: pageId === "home" ? 1 : pageId === "terms" || pageId === "privacy" ? 0.3 : landingPriorities[pageId],
                    },
                ];
            }),
        ),
        { path: "/gallery", changeFrequency: "daily", priority: 0.8 },
        { path: "/announcements", changeFrequency: "weekly", priority: 0.5 },
    ];
    const staticEntries: MetadataRoute.Sitemap = staticPages.map(({ path, changeFrequency, priority }) => ({
        url: absoluteSiteUrl(path, base),
        changeFrequency,
        priority,
    }));
    try {
        const works = await listPublicWorkSitemapEntries();
        return [...staticEntries, ...works.map((work) => ({ url: absoluteSiteUrl(`/share/${encodeURIComponent(work.slug)}`, base), lastModified: work.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 }))];
    } catch {
        return staticEntries;
    }
}
