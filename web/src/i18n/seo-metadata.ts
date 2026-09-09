import type { Metadata } from "next";
import { localeMetadata, type AppLocale } from "./config";
import { getPublishedSeoAlternates, getSeoPagePath, type SeoPageId } from "./routing";

export function buildLocalizedSeoMetadata({
    pageId,
    locale,
    base,
    siteName,
    title,
    description,
    keywords,
    image,
}: {
    pageId: SeoPageId;
    locale: AppLocale;
    base: URL;
    siteName: string;
    title: string;
    description: string;
    keywords: string[];
    image: { src: string; alt: string; width: number; height: number };
}): Metadata {
    const pathname = getSeoPagePath(pageId, locale);
    if (!pathname) throw new Error("Unpublished SEO page");
    const canonical = new URL(pathname, base).toString();
    const socialImage = { url: new URL(image.src, base).toString(), alt: image.alt, width: image.width, height: image.height };
    return {
        metadataBase: null,
        title,
        description,
        keywords,
        alternates: { canonical, languages: getPublishedSeoAlternates(pageId, base) },
        robots: { index: true, follow: true },
        openGraph: { type: "website", url: canonical, title, description, siteName, locale: localeMetadata[locale].openGraphLocale, images: [socialImage] },
        twitter: { card: "summary_large_image", title, description, images: [socialImage] },
    };
}
