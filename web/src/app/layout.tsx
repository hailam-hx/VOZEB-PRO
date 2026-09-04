import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/components/layout/app-providers";
import { defaultLocale, isAppLocale } from "@/i18n/config";
import { effectiveLocale, localeMetadata } from "@/i18n/runtime";
import { builtInSiteCopy, localizeBuiltInSiteCopy } from "@/i18n/site-copy";
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
    const logoUrl = absoluteSiteUrl(site.logoUrl || "/logo.svg", base);
    const title = site.seoTitle || site.title;
    const description = localizeBuiltInSiteCopy(site.seoDescription, builtInSiteCopy.seoDescription, homeT("footerDefaultDescription"));
    const keywords = localizeBuiltInSiteCopy(site.seoKeywords, builtInSiteCopy.seoKeywords, homeT("footerDefaultKeywords"));
    return {
        metadataBase: base,
        title,
        description,
        alternates: { canonical: "/" },
        keywords: keywords
            .split(/[,，]/)
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        openGraph: {
            type: "website",
            title,
            description,
            siteName: site.title,
            images: logoUrl ? [{ url: logoUrl }] : undefined,
            locale: localeMetadata[locale].openGraphLocale,
        },
        twitter: {
            card: "summary",
            title,
            description,
            images: logoUrl ? [logoUrl] : undefined,
        },
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
    const homeT = await getTranslations({ locale, namespace: "home" });
    const base = siteMetadataBase();
    const iconHref = browserIconHref(site);
    const websiteUrl = absoluteSiteUrl("/", base);
    const websiteStructuredData = buildWebsiteStructuredData({
        name: site.title,
        alternateName: ["HOTXAI"],
        description: localizeBuiltInSiteCopy(site.seoDescription, builtInSiteCopy.seoDescription, homeT("footerDefaultDescription")),
        url: websiteUrl,
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
                <script id="website-json-ld" nonce={nonce} suppressHydrationWarning type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(websiteStructuredData) }} />
                <NextIntlClientProvider locale={selectedLocale} messages={messages}>
                    <AntdRegistry>
                        <AppProviders>{children}</AppProviders>
                    </AntdRegistry>
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
