import type { MetadataRoute } from "next";

import { appLocales } from "@/i18n/config";
import { seoPageIds, getSeoPagePath } from "@/i18n/routing";
import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
    const base = siteMetadataBase();
    return {
        rules: {
            userAgent: "*",
            allow: [
                "/gallery",
                "/share/",
                "/announcements",
                ...seoPageIds.flatMap((pageId) =>
                    appLocales.flatMap((locale) => {
                        const path = getSeoPagePath(pageId, locale);
                        return path ? [path] : [];
                    }),
                ),
            ],
            disallow: ["/api/", "/admin", "/assets", "/billing", "/canvas", "/create", "/drama", "/image", "/install", "/login", "/my-prompts", "/profile", "/prompts", "/register", "/video", "/works"],
        },
        sitemap: absoluteSiteUrl("/sitemap.xml", base),
    };
}
