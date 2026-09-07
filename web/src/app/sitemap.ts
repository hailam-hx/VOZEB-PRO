import type { MetadataRoute } from "next";

import { SEO_LANDING_SLUGS } from "@/app/seo-landings/seo-landing-data";
import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";
import { listPublicWorkSitemapEntries } from "@/lib/server/work-governance-service";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const base = siteMetadataBase();
    const publicPaths = ["/", "/gallery", "/announcements", "/terms", "/privacy", ...SEO_LANDING_SLUGS.map((slug) => `/${slug}`)] as const;
    const staticEntries: MetadataRoute.Sitemap = publicPaths.map((path) => ({
        url: absoluteSiteUrl(path, base),
        changeFrequency: path === "/" || path === "/gallery" ? "daily" : path === "/announcements" || path.startsWith("/ai-") || path === "/voice-cloning" ? "weekly" : "yearly",
        priority: path === "/" ? 1 : path === "/gallery" ? 0.8 : path.startsWith("/ai-") || path === "/voice-cloning" ? 0.7 : path === "/announcements" ? 0.6 : 0.3,
    }));
    try {
        const works = await listPublicWorkSitemapEntries();
        return [...staticEntries, ...works.map((work) => ({ url: absoluteSiteUrl(`/share/${encodeURIComponent(work.slug)}`, base), lastModified: work.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 }))];
    } catch {
        return staticEntries;
    }
}
