import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { LocaleProvider } from "@/i18n/locale-provider";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AppProviders } from "@/components/layout/app-providers";
import { WebsiteStructuredData } from "@/components/layout/website-structured-data";
import { defaultLocale, isAppLocale } from "@/i18n/config";
import { effectiveLocale, localeMetadata } from "@/i18n/runtime";
import { appStorageKey } from "@/lib/storage-keys";
import { DEFAULT_SITE_LOGO_URL } from "@/lib/site-brand";
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
    const base = siteMetadataBase();
    const { title, description, keywords } = site.seo[locale];
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
    const [site, requestHeaders, requestedLocale, messages, timeZone] = await Promise.all([getPublicSiteSettings(), headers(), getLocale(), getMessages(), getTimeZone()]);
    const nonce = requestHeaders.get("x-nonce") || undefined;
    const selectedLocale = isAppLocale(requestedLocale) ? requestedLocale : defaultLocale;
    const locale = effectiveLocale(selectedLocale, requestHeaders.get("x-vozeb-pathname") || "/");
    const iconHref = browserIconHref(site);
    const base = siteMetadataBase();
    const websiteStructuredData = buildWebsiteStructuredData({
        name: site.title,
        alternateName: ["HOTXAI"],
        locale,
        description: site.seo[locale].description,
        url: absoluteSiteUrl("/", base),
        logoUrl: absoluteSiteUrl(site.logoUrl || DEFAULT_SITE_LOGO_URL, base),
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
                <LocaleProvider locale={selectedLocale} messages={messages} timeZone={timeZone}>
                    <AntdRegistry>
                        <AppProviders>{children}</AppProviders>
                    </AntdRegistry>
                </LocaleProvider>
            </body>
        </html>
    );
}
