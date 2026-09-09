import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { defaultLocale, isAppLocale } from "@/i18n/config";
import { effectiveLocale, localeMetadata } from "@/i18n/runtime";
import { builtInSiteCopy, localizeBuiltInSiteCopy, localizeHomepageSeoDescription } from "@/i18n/site-copy";
import { getInstallStatus } from "@/lib/server/install-status";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { HomeActionsProvider } from "./home/home-actions";
import { HomeAgentHero } from "./home/home-agent-hero";
import { HomeCta, HomeFooter } from "./home/home-footer";
import { HomeGallery } from "./home/home-gallery";
import { HomeHeader } from "./home/home-header";
import { HomeAdvantagesSection, HomeProductsSection, HomeStepsSection } from "./home/home-static-sections";
import styles from "./home/home.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const [site, requestedLocale, requestHeaders] = await Promise.all([getPublicSiteSettings(), getLocale(), headers()]);
    const locale = effectiveLocale(isAppLocale(requestedLocale) ? requestedLocale : defaultLocale, requestHeaders.get("x-vozeb-pathname") || "/");
    const homeT = await getTranslations({ locale, namespace: "home" });
    const title = site.seoTitle || site.title;
    const description = localizeHomepageSeoDescription(site.seoDescription, homeT("metadataDescription"));
    const keywords = localizeBuiltInSiteCopy(site.seoKeywords, builtInSiteCopy.seoKeywords, homeT("footerDefaultKeywords"));
    const base = siteMetadataBase();
    const canonical = absoluteSiteUrl("/", base);
    const socialImage = { url: absoluteSiteUrl("/seo/hotx-ai-og.webp", base), width: 1200, height: 630, alt: homeT("socialImageAlt") };

    return {
        metadataBase: null,
        title,
        description,
        alternates: { canonical },
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
            images: [socialImage.url],
        },
    };
}

export default async function HomePage() {
    const [install, site, homeT] = await Promise.all([getInstallStatus(), getPublicSiteSettings(), getTranslations("home")]);
    if (!install.ready) redirect("/install");
    const initialSite = { ...site, seoDescription: localizeHomepageSeoDescription(site.seoDescription, homeT("metadataDescription")) };

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
