import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/components/layout/app-providers";
import { WebsiteStructuredData } from "@/components/layout/website-structured-data";
import { defaultLocale, isAppLocale } from "@/i18n/config";
import { effectiveLocale, localeMetadata } from "@/i18n/runtime";
import { builtInSiteCopy, localizeBuiltInSiteCopy, localizeHomepageSeoDescription } from "@/i18n/site-copy";
import { appStorageKey } from "@/lib/storage-keys";
import { absoluteSiteUrl, browserIconHref, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { buildWebsiteStructuredData, serializeStructuredData } from "@/lib/structured-data";
import "antd/dist/reset.css";
import "./globals.css";
import React from "react";

const themeBootstrapScript = `try{const value=JSON.parse(localStorage.getItem(${JSON.stringify(appStorageKey("theme_store"))})||"{}");const theme=value?.state?.theme==="dark"?"dark":"light";document.documentElement.classList.toggle("dark",theme==="dark");document.documentElement.style.colorScheme=theme}catch{}`;

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
        { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    ],
};

export async function generateMetadata(): Promise<Metadata> {
    const [site, requestedLocale, requestHeaders] = await Promise.all([getPublicSiteSettings(), getLocale(), headers()]);
    const locale = effectiveLocale(isAppLocale(requestedLocale) ? requestedLocale : defaultLocale, requestHeaders.get("x-vozeb-pathname") || "/");
    const homeT = await getTranslations({ locale, namespace: "home" });
    const base = siteMetadataBase();
    const title = site.seoTitle || site.title;
    const description = localizeHomepageSeoDescription(site.seoDescription, homeT("metadataDescription"));
    const keywords = localizeBuiltInSiteCopy(site.seoKeywords, builtInSiteCopy.seoKeywords, homeT("footerDefaultKeywords"));
    return {
        metadataBase: base,
        title,
        description,
        keywords: keywords
            .split(/[,，]/)
            .map((keyword) => keyword.trim())
            .filter(Boolean),
    };
}

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const [site, requestHeaders, requestedLocale, messages] = await Promise.all([getPublicSiteSettings(), headers(), getLocale(), getMessages()]);
    const nonce = requestHeaders.get("x-nonce") || undefined;
    const selectedLocale = isAppLocale(requestedLocale) ? requestedLocale : defaultLocale;
    const locale = effectiveLocale(selectedLocale, requestHeaders.get("x-vozeb-pathname") || "/");
    const iconHref = browserIconHref(site);
    const homeT = await getTranslations({ locale, namespace: "home" });
    const base = siteMetadataBase();
    const websiteStructuredData = buildWebsiteStructuredData({
        name: site.title,
        alternateName: ["HOTXAI"],
        locale,
        description: localizeHomepageSeoDescription(site.seoDescription, homeT("metadataDescription")),
        url: absoluteSiteUrl("/", base),
        logoUrl: absoluteSiteUrl(site.logoUrl || "/logo.svg", base),
    });

    return (
        <html lang={localeMetadata[locale].htmlLang} suppressHydrationWarning className="font-sans">
            <head>
                <script id="theme-bootstrap" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
                <link rel="icon" href={iconHref} />
                <link rel="shortcut icon" href={iconHref} />
                <link rel="apple-touch-icon" href={iconHref} />
            </head>
            <body
                className="bg-background text-foreground antialiased"
                style={{
                    fontFamily: '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
                }}
            >
                <WebsiteStructuredData json={serializeStructuredData(websiteStructuredData)} nonce={nonce} />
                <NextIntlClientProvider locale={selectedLocale} messages={messages}>
                    <AntdRegistry>
                        <AppProviders>{children}</AppProviders>
                    </AntdRegistry>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
