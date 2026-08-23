import type { Metadata } from "next";
import { DatabaseZap } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache } from "react";

import { GalleryThemeToggle } from "@/app/gallery/gallery-theme-toggle";
import { SiteLogo } from "@/components/layout/site-logo";
import { isAppLocale, localeMetadata } from "@/i18n/config";
import { getCurrentUser } from "@/lib/auth/session";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { getPublicCreatorPage, getPublicCreatorProfile, WorkCommunityServiceError } from "@/lib/server/work-community-service";
import type { PublicCreatorPage } from "@/services/api/work-community";
import { PublicCreatorView } from "./public-creator-view";

type CreatorPageProps = { params: Promise<{ username: string }> };

const loadCreatorProfile = cache(async (username: string) => {
    try {
        return await getPublicCreatorProfile(username);
    } catch (error) {
        if (error instanceof WorkCommunityServiceError && error.status === 404) return null;
        if (isCommunityUnavailable(error)) return undefined;
        throw error;
    }
});

const loadCreatorPage = cache(async (username: string, viewerUserId: string) => {
    try {
        return (await getPublicCreatorPage(username, viewerUserId || undefined, { limit: 18 })) as PublicCreatorPage;
    } catch (error) {
        if (error instanceof WorkCommunityServiceError && error.status === 404) return null;
        if (isCommunityUnavailable(error)) return undefined;
        throw error;
    }
});

export async function generateMetadata({ params }: CreatorPageProps): Promise<Metadata> {
    const { username } = await params;
    const [profile, site, t, localeValue] = await Promise.all([loadCreatorProfile(username), getPublicSiteSettings(), getTranslations("public.creatorPage"), getLocale()]);
    const locale = isAppLocale(localeValue) ? localeValue : "vi";
    if (profile === undefined) return { title: t("metadataUnavailable", { site: site.title }), robots: { index: false, follow: false } };
    if (!profile) return { title: t("metadataNotFound", { site: site.title }), robots: { index: false, follow: false } };
    const canonical = `/u/${encodeURIComponent(profile.username)}`;
    const title = `${profile.displayName || profile.username} (@${profile.username}) | ${site.title}`;
    const description = profile.bio || t("metadataDescription", { name: profile.displayName || profile.username });
    const image = absoluteSiteUrl(profile.avatarUrl || site.logoUrl || "/logo.svg", siteMetadataBase());
    return {
        metadataBase: siteMetadataBase(),
        title,
        description,
        alternates: { canonical },
        robots: { index: true, follow: true },
        openGraph: { type: "profile", title, description, siteName: site.title, url: canonical, images: [{ url: image, alt: profile.displayName || profile.username }], locale: localeMetadata[locale].openGraphLocale },
        twitter: { card: "summary", title, description, images: [image] },
    };
}

export default async function CreatorPage({ params }: CreatorPageProps) {
    const { username } = await params;
    const sitePromise = getPublicSiteSettings();
    const viewer = await getCurrentUser();
    const [site, data, t] = await Promise.all([sitePromise, loadCreatorPage(username, viewer?.id || ""), getTranslations("public.creatorPage")]);
    if (data === null) notFound();

    return (
        <main className="app-scroll-page bg-background text-foreground">
            <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-xl">
                <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between gap-3 px-3 sm:h-16 sm:px-6">
                    <Link href="/" className="flex min-w-0 items-center gap-2.5 text-foreground" aria-label={site.title}>
                        <SiteLogo logoUrl={site.logoUrl || "/logo.svg"} className="size-7 sm:size-8" />
                        <span className="truncate text-sm font-semibold sm:text-base">{site.title}</span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                        <Link href="/gallery" className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted">
                            {t("gallery")}
                        </Link>
                        <GalleryThemeToggle />
                    </div>
                </div>
            </header>
            {data ? (
                <PublicCreatorView initialData={data} />
            ) : (
                <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center" aria-labelledby="creator-unavailable-title">
                    <span className="grid size-12 place-items-center rounded-full border border-border bg-muted text-muted-foreground" aria-hidden="true">
                        <DatabaseZap className="size-5" />
                    </span>
                    <h1 id="creator-unavailable-title" className="mt-4 text-xl font-semibold sm:text-2xl">
                        {t("unavailable")}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("databaseUnavailable")}</p>
                    <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-85">
                        {t("backHome")}
                    </Link>
                </section>
            )}
        </main>
    );
}

function isCommunityUnavailable(error: unknown) {
    return error instanceof WorkCommunityServiceError && error.status === 409 && error.message.includes("需要启用 PostgreSQL");
}
