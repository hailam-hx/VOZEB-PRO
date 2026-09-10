import type { MetadataRoute } from "next";

import { DEFAULT_SITE_TITLE } from "@/lib/site-brand";
import { getPublicSiteSettings } from "@/lib/server/site-metadata";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
    const site = await getPublicSiteSettings();
    const title = site.title.trim() || DEFAULT_SITE_TITLE;
    return {
        name: title,
        short_name: title.slice(0, 16),
        description: site.seo.vi.description.trim() || undefined,
        start_url: "/",
        display: "standalone",
        lang: "vi",
        background_color: "#ffffff",
        theme_color: "#111111",
        icons: [{ src: "/favicon.ico", sizes: "any", purpose: "any" }],
    };
}
