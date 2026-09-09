import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { HomeActionsProvider } from "@/app/home/home-actions";
import { HomeFooter } from "@/app/home/home-footer";
import { HomeHeader } from "@/app/home/home-header";
import homeStyles from "@/app/home/home.module.css";
import { SeoLandingActions } from "@/app/seo-landings/seo-landing-actions";
import { SeoLandingContent } from "@/app/seo-landings/seo-landing-content";
import { SEO_LANDING_SLUGS, getSeoLandingDefinition, isSeoLandingSlug } from "@/app/seo-landings/seo-landing-data";
import { buildSeoLandingMetadata } from "@/app/seo-landings/seo-landing-metadata";
import { getInstallStatus } from "@/lib/server/install-status";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { buildSeoLandingStructuredData, serializeStructuredData } from "@/lib/structured-data";

import { requireSeoPageLocale } from "@/i18n/seo-page";
import { getSeoPagePath } from "@/i18n/routing";
import { landingUi } from "@/app/seo-landings/content/ui";

type SeoLandingPageProps = {
    params: Promise<{ slug: string; locale: string }>;
};

export const dynamic = "force-dynamic";

export function generateStaticParams() {
    return SEO_LANDING_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: SeoLandingPageProps): Promise<Metadata> {
    const { slug, locale: requestedLocale } = await params;
    if (!isSeoLandingSlug(slug)) notFound();
    const locale = requireSeoPageLocale(slug, requestedLocale);
    const definition = getSeoLandingDefinition(slug, locale);
    if (!definition) notFound();

    const site = await getPublicSiteSettings();
    return buildSeoLandingMetadata(definition, siteMetadataBase(), site.title, locale);
}

export default async function SeoLandingPage({ params }: SeoLandingPageProps) {
    const { slug, locale: requestedLocale } = await params;
    if (!isSeoLandingSlug(slug)) notFound();
    const locale = requireSeoPageLocale(slug, requestedLocale);
    const definition = getSeoLandingDefinition(slug, locale);
    if (!definition) notFound();

    const [install, site] = await Promise.all([getInstallStatus(), getPublicSiteSettings()]);
    if (!install.ready) redirect("/install");

    const base = siteMetadataBase();
    const canonicalUrl = absoluteSiteUrl(getSeoPagePath(slug, locale)!, base);
    const structuredData = buildSeoLandingStructuredData({
        url: canonicalUrl,
        locale,
        homeUrl: absoluteSiteUrl(getSeoPagePath("home", locale) || "/", base),
        homeName: landingUi[locale].home,
        websiteId: `${absoluteSiteUrl(getSeoPagePath("home", locale) || "/", base)}#website`,
        title: definition.title,
        description: definition.description,
        breadcrumbName: definition.primaryKeyword,
        imageUrl: absoluteSiteUrl(definition.visual.src, base),
    });

    return (
        <HomeActionsProvider initialSite={site}>
            <main className={`app-scroll-page ${homeStyles.root}`} lang={locale}>
                <script id="seo-landing-json-ld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(structuredData) }} />
                <HomeHeader />
                <SeoLandingContent locale={locale} definition={definition} actions={<SeoLandingActions locale={locale} definition={definition} />} finalAction={<SeoLandingActions locale={locale} definition={definition} compact />} />
                <HomeFooter />
            </main>
        </HomeActionsProvider>
    );
}
