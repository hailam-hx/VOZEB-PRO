import type { MetadataRoute } from "next";

import { SEO_LANDING_SLUGS } from "@/app/seo-landings/seo-landing-data";
import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
    const base = siteMetadataBase();
    return {
        rules: {
            userAgent: "*",
            allow: ["/", "/gallery", "/share/", "/terms", "/privacy", ...SEO_LANDING_SLUGS.map((slug) => `/${slug}`)],
            disallow: ["/api/", "/admin", "/assets", "/billing", "/canvas", "/create", "/drama", "/image", "/install", "/login", "/my-prompts", "/profile", "/prompts", "/register", "/video", "/works"],
        },
        sitemap: absoluteSiteUrl("/sitemap.xml", base),
    };
}
