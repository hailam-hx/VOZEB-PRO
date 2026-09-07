import { describe, expect, it } from "vitest";

import { SEO_LANDING_DEFINITIONS } from "./seo-landing-data";
import { buildSeoLandingMetadata } from "./seo-landing-metadata";

describe("SEO landing metadata", () => {
    it("uses the exact canonical, indexable robots policy and page-specific social metadata", () => {
        const definition = SEO_LANDING_DEFINITIONS["ai-image-generator"];
        const metadata = buildSeoLandingMetadata(definition, new URL("https://hotx-ai.com"), "HOTX AI");

        expect(metadata).toMatchObject({
            metadataBase: new URL("https://hotx-ai.com"),
            title: definition.title,
            description: definition.description,
            alternates: { canonical: "/ai-image-generator" },
            robots: { index: true, follow: true },
            openGraph: {
                type: "website",
                url: "/ai-image-generator",
                title: definition.title,
                description: definition.description,
                siteName: "HOTX AI",
                locale: "vi_VN",
            },
            twitter: {
                card: "summary_large_image",
                title: definition.title,
                description: definition.description,
            },
        });
        expect(metadata.keywords).toEqual([definition.primaryKeyword, ...definition.secondaryKeywords]);
        expect(metadata.openGraph?.images).toEqual([{ url: definition.visual.src, alt: definition.visual.alt, width: definition.visual.width, height: definition.visual.height }]);
    });
});
