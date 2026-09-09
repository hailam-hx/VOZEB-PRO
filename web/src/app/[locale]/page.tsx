import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireSeoPageLocale, type LocalizedPageProps } from "@/i18n/seo-page";
import { getSeoPagePath, getPublishedSeoAlternates } from "@/i18n/routing";
import { localeMetadata } from "@/i18n/config";
import { builtInSiteCopy, localizeBuiltInSiteCopy, localizeHomepageSeoDescription } from "@/i18n/site-copy";
import { getInstallStatus } from "@/lib/server/install-status";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { HomeActionsProvider } from "@/app/home/home-actions";
import { HomeAgentHero } from "@/app/home/home-agent-hero";
import { HomeCta, HomeFooter } from "@/app/home/home-footer";
import { HomeGallery } from "@/app/home/home-gallery";
import { HomeHeader } from "@/app/home/home-header";
import { HomeAdvantagesSection, HomeProductsSection, HomeStepsSection } from "@/app/home/home-static-sections";
import styles from "@/app/home/home.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: LocalizedPageProps): Promise<Metadata> {
    const locale = requireSeoPageLocale("home", (await params).locale);
    const site = await getPublicSiteSettings();
    const homeT = await getTranslations({ locale, namespace: "home" });
    const title = locale === "vi" ? site.seoTitle || site.title : homeT("metadataTitle", { site: site.title });
    const description = locale === "vi" ? localizeHomepageSeoDescription(site.seoDescription, homeT("metadataDescription")) : homeT("metadataDescription");
    const keywords = locale === "vi" ? localizeBuiltInSiteCopy(site.seoKeywords, builtInSiteCopy.seoKeywords, homeT("footerDefaultKeywords")) : homeT("footerDefaultKeywords");
    const base = siteMetadataBase();
    const canonical = absoluteSiteUrl(getSeoPagePath("home", locale)!, base);
    const socialImage = { url: absoluteSiteUrl("/seo/hotx-ai-og.webp", base), width: 1200, height: 630, alt: homeT("socialImageAlt") };

    return {
        metadataBase: null,
        title,
        description,
        alternates: { canonical, languages: getPublishedSeoAlternates("home", base) },
        keywords: keywords
            .split(/[,，]/)
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        openGraph: {
            type: "website",
            url: canonical,
            title,
            description,
            siteName: site.title,
            images: [socialImage],
            locale: localeMetadata[locale].openGraphLocale,
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [socialImage],
        },
    };
}

export default async function HomePage({ params }: LocalizedPageProps) {
    const locale = requireSeoPageLocale("home", (await params).locale);
    const [install, site, homeT] = await Promise.all([getInstallStatus(), getPublicSiteSettings(), getTranslations({ locale, namespace: "home" })]);
    if (!install.ready) redirect("/install");
    const initialSite = { ...site, seoDescription: locale === "vi" ? localizeHomepageSeoDescription(site.seoDescription, homeT("metadataDescription")) : homeT("metadataDescription") };

    return (
        <HomeActionsProvider initialSite={initialSite}>
            <main className={`app-scroll-page ${styles.root}`}>
                <HomeHeader />
                <HomeAgentHero />
                <div className={styles.contentBand}>
                    <HomeProductsSection />
                    <HomeStepsSection />
                    <HomeGallery />
                    <HomeAdvantagesSection />
                    <HomeCta />
                    <HomeFooter />
                </div>
            </main>
        </HomeActionsProvider>
    );
}
