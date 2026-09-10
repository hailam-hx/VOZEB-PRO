import { notFound } from "next/navigation";
import { isAppLocale } from "@/i18n/config";
import type { LocalizedPageProps } from "@/i18n/seo-page";
import { SeoLocaleProvider } from "@/i18n/locale-provider";
import { loadMessages } from "@/i18n/messages";
import { getSeoPagePath } from "@/i18n/routing";
import { DEFAULT_SITE_LOGO_URL } from "@/lib/site-brand";
import { getPublicSiteSettings, siteMetadataBase, absoluteSiteUrl } from "@/lib/server/site-metadata";
import { buildWebsiteStructuredData, serializeStructuredData } from "@/lib/structured-data";

export default async function LocalizedLayout({ children, params }: LocalizedPageProps & { children: React.ReactNode }) {
    const { locale } = await params;
    if (!isAppLocale(locale)) notFound();
    const site = await getPublicSiteSettings();
    const base = siteMetadataBase();
    const structuredData = buildWebsiteStructuredData({
        name: site.title,
        alternateName: ["HOTXAI"],
        locale,
        description: site.seo[locale].description,
        url: absoluteSiteUrl(getSeoPagePath("home", locale) || "/", base),
        logoUrl: absoluteSiteUrl(site.logoUrl || DEFAULT_SITE_LOGO_URL, base),
    });
    return (
        <SeoLocaleProvider locale={locale} messages={loadMessages(locale)}>
            <script id="website-json-ld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(structuredData) }} />
            {children}
        </SeoLocaleProvider>
    );
}
