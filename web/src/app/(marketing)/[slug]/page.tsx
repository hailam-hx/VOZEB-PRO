import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { HomeActionsProvider } from "@/app/home/home-actions";
import { HomeFooter } from "@/app/home/home-footer";
import { HomeHeader } from "@/app/home/home-header";
import homeStyles from "@/app/home/home.module.css";
import { SeoLandingActions } from "@/app/seo-landings/seo-landing-actions";
import { SeoLandingContent } from "@/app/seo-landings/seo-landing-content";
import { SEO_LANDING_SLUGS, getSeoLandingDefinition } from "@/app/seo-landings/seo-landing-data";
import { buildSeoLandingMetadata } from "@/app/seo-landings/seo-landing-metadata";
import { getInstallStatus } from "@/lib/server/install-status";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { buildSeoLandingStructuredData, serializeStructuredData } from "@/lib/structured-data";

type SeoLandingPageProps = {
    params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export function generateStaticParams() {
    return SEO_LANDING_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: SeoLandingPageProps): Promise<Metadata> {
    const { slug } = await params;
    const definition = getSeoLandingDefinition(slug);
    if (!definition) notFound();

    const site = await getPublicSiteSettings();
    return buildSeoLandingMetadata(definition, siteMetadataBase(), site.title);
}

export default async function SeoLandingPage({ params }: SeoLandingPageProps) {
    const { slug } = await params;
    const definition = getSeoLandingDefinition(slug);
    if (!definition) notFound();

    const [install, site] = await Promise.all([getInstallStatus(), getPublicSiteSettings()]);
    if (!install.ready) redirect("/install");

    const base = siteMetadataBase();
    const canonicalUrl = absoluteSiteUrl(`/${definition.slug}`, base);
    const structuredData = buildSeoLandingStructuredData({
        url: canonicalUrl,
        websiteId: `${absoluteSiteUrl("/", base)}#website`,
        title: definition.title,
        description: definition.description,
        breadcrumbName: definition.primaryKeyword,
        imageUrl: absoluteSiteUrl(definition.visual.src, base),
    });

    return (
        <HomeActionsProvider initialSite={site}>
            <main className={`app-scroll-page ${homeStyles.root}`} lang="vi">
                <script id="seo-landing-json-ld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(structuredData) }} />
                <HomeHeader />
                <SeoLandingContent definition={definition} actions={<SeoLandingActions definition={definition} />} finalAction={<SeoLandingActions definition={definition} compact />} />
                <HomeFooter />
            </main>
        </HomeActionsProvider>
    );
}
