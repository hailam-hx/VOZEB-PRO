import { unstable_cache, revalidateTag } from "next/cache";

import { DEFAULT_SITE_SETTINGS, getAuthSettings, type SiteSettings } from "@/lib/auth/store";

export const SITE_SETTINGS_CACHE_TAG = "vozeb-site-settings";

const readCachedSiteSettings = unstable_cache(
    async (): Promise<SiteSettings> => {
        try {
            return (await getAuthSettings()).site;
        } catch {
            return DEFAULT_SITE_SETTINGS;
        }
    },
    [SITE_SETTINGS_CACHE_TAG],
    { revalidate: 60, tags: [SITE_SETTINGS_CACHE_TAG] },
);

export function getPublicSiteSettings() {
    return readCachedSiteSettings();
}

export function invalidatePublicSiteSettings() {
    try {
        revalidateTag(SITE_SETTINGS_CACHE_TAG, "max");
    } catch {}
}

export function siteMetadataBase() {
    return resolveSiteMetadataBase(process.env);
}

export function resolveSiteMetadataBase(environment: Readonly<Record<string, string | undefined>>) {
    const configuredSiteUrl = runtimeEnvironmentValue(environment, "NEXT_PUBLIC_SITE_URL");
    const vercelUrl = runtimeEnvironmentValue(environment, "VERCEL_URL");
    const siteUrl = configuredSiteUrl || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000");
    try {
        return new URL(siteUrl);
    } catch {
        return new URL("http://localhost:3000");
    }
}

function runtimeEnvironmentValue(environment: Readonly<Record<string, string | undefined>>, name: string) {
    // Keep public URLs runtime-configurable in standalone images instead of letting Next inline build-time values.
    const value = Reflect.get(environment, name);
    return typeof value === "string" ? value.trim() : "";
}

export function absoluteSiteUrl(value: string, base = siteMetadataBase()) {
    try {
        return new URL(value, base).toString();
    } catch {
        return value;
    }
}

export function browserIconHref(site: Pick<SiteSettings, "iconUrl" | "logoUrl">) {
    const iconUrl = site.iconUrl.trim();
    const logoUrl = site.logoUrl.trim();
    const directIconUrl = iconUrl === "/favicon.ico" || iconUrl === "/api/site-icon" ? "" : iconUrl;
    if (directIconUrl && (directIconUrl !== DEFAULT_SITE_SETTINGS.iconUrl || logoUrl === DEFAULT_SITE_SETTINGS.logoUrl)) return directIconUrl;
    return logoUrl || directIconUrl || DEFAULT_SITE_SETTINGS.iconUrl;
}
