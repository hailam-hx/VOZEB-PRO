import type { MetadataRoute } from "next";

import { getPublicSiteSettings } from "@/lib/server/site-metadata";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
    const site = await getPublicSiteSettings();
    return {
        name: site.title,
        short_name: site.title.slice(0, 16),
        description: site.seo.vi.description,
        start_url: "/",
        display: "standalone",
        lang: "vi",
        background_color: "#ffffff",
        theme_color: "#111111",
        icons: [{ src: "/favicon.ico", sizes: "any", purpose: "any" }],
    };
}
