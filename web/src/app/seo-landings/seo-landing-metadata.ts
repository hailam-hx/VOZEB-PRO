import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/config";
import { buildLocalizedSeoMetadata } from "@/i18n/seo-metadata";
import type { SeoLandingDefinition } from "./seo-landing-data";

export function buildSeoLandingMetadata(definition: SeoLandingDefinition, metadataBase: URL, siteName: string, locale: AppLocale = "vi"): Metadata {
    return buildLocalizedSeoMetadata({
        pageId: definition.slug,
        locale,
        base: metadataBase,
        siteName,
        title: definition.title,
        description: definition.description,
        keywords: [definition.primaryKeyword, ...definition.secondaryKeywords],
        image: definition.visual,
    });
}
