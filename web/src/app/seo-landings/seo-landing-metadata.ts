import type { Metadata } from "next";

import type { SeoLandingDefinition } from "./seo-landing-data";

export function buildSeoLandingMetadata(definition: SeoLandingDefinition, metadataBase: URL, siteName: string): Metadata {
    const canonicalPath = `/${definition.slug}`;
    const socialImage = {
        url: definition.visual.src,
        alt: definition.visual.alt,
        width: definition.visual.width,
        height: definition.visual.height,
    };

    return {
        metadataBase,
        title: definition.title,
        description: definition.description,
        keywords: [definition.primaryKeyword, ...definition.secondaryKeywords],
        alternates: { canonical: canonicalPath },
        robots: { index: true, follow: true },
        openGraph: {
            type: "website",
            url: canonicalPath,
            title: definition.title,
            description: definition.description,
            siteName,
            locale: "vi_VN",
            images: [socialImage],
        },
        twitter: {
            card: "summary_large_image",
            title: definition.title,
            description: definition.description,
            images: [socialImage],
        },
    };
}
