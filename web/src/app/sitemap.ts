import type { MetadataRoute } from "next";

import { SEO_LANDING_SLUGS, type SeoLandingSlug } from "@/app/seo-landings/seo-landing-data";
import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";
import { listPublicWorkSitemapEntries } from "@/lib/server/work-governance-service";

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
        { path: "/", changeFrequency: "daily", priority: 1 },
        ...SEO_LANDING_SLUGS.map((slug) => ({ path: `/${slug}`, changeFrequency: "weekly" as const, priority: landingPriorities[slug] })),
        { path: "/gallery", changeFrequency: "daily", priority: 0.8 },
        { path: "/announcements", changeFrequency: "weekly", priority: 0.5 },
        { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
        { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
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
