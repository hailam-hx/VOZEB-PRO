import type { Metadata } from "next";
import { ArrowUpRight, CalendarDays, DatabaseZap, Eye } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { SiteLogo } from "@/components/layout/site-logo";
import { PublicWorkCommunityActions } from "@/components/works/public-work-community-actions";
import { PublicWorkMediaBrowser } from "@/components/works/public-work-media-browser";
import { createAgentPromptHref } from "@/lib/create-agent-prompt";
import { GalleryThemeToggle } from "@/app/gallery/gallery-theme-toggle";
import { WorkPublicationServiceError, getPublicWorkPublication } from "@/lib/server/work-publication-service";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { absoluteSiteUrl, getPublicSiteSettings, siteMetadataBase } from "@/lib/server/site-metadata";
import { buildCreativeWorkStructuredData, serializeStructuredData } from "@/lib/structured-data";
import { userAvatarFallback } from "@/lib/user-avatar";
import type { SiteSettings } from "@/lib/auth/store";
import { localeMetadata, type AppLocale } from "@/i18n/config";
import { WorkViewTracker } from "./work-view-tracker";
import { WorkGovernanceActions } from "./work-governance-actions";
import { WorkPromptActions } from "./work-prompt-actions";

type SharePageProps = { params: Promise<{ slug: string }> };

const getSharedWork = cache(async (slug: string) => {
    try {
        return await getPublicWorkPublication(slug);
    } catch (error) {
        if (error instanceof WorkPublicationServiceError && error.status === 404) return null;
        if (isPublicationUnavailable(error)) return undefined;
        throw error;
    }
});

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
    const { slug } = await params;
    const [work, site, t, locale] = await Promise.all([getSharedWork(slug), getPublicSiteSettings(), getTranslations("public.share"), getLocale()]);
    if (work === undefined) return { title: t("metadataUnavailable", { site: site.title }), robots: { index: false, follow: false } };
    if (!work) return { title: t("metadataNotFound", { site: site.title }), robots: { index: false, follow: false } };

    const base = siteMetadataBase();
    const canonical = `/share/${encodeURIComponent(work.slug)}`;
    const cover = work.assets.find((asset) => asset.role === "cover" && asset.mediaType === "image") || work.assets.find((asset) => asset.mediaType === "image");
    const imageUrl = absoluteSiteUrl(cover ? imagePreviewUrl(cover.url, 1920) : site.logoUrl || "/logo.svg", base);
    const description = work.description || t("metadataDescription", { author: work.authorName || "", category: work.category });
    const title = `${work.title} | ${site.title}`;
    return {
        metadataBase: base,
        title,
        description,
        keywords: work.tags,
        alternates: { canonical },
        robots: work.visibility === "public" ? { index: true, follow: true } : { index: false, follow: true, noarchive: true },
        openGraph: {
            type: "article",
            title,
            description,
            siteName: site.title,
            url: canonical,
            images: [{ url: imageUrl, alt: work.title }],
            publishedTime: work.publishedAt,
            locale: localeMetadata[locale as AppLocale].openGraphLocale,
        },
        twitter: {
            card: cover ? "summary_large_image" : "summary",
            title,
            description,
            images: [imageUrl],
        },
    };
}

export default async function SharePage({ params }: SharePageProps) {
    const { slug } = await params;
    const [work, site, t, format] = await Promise.all([getSharedWork(slug), getPublicSiteSettings(), getTranslations("public.share"), getFormatter()]);
    if (work === null) notFound();
    if (work === undefined) {
        return (
            <main className="app-scroll-page bg-[#f7f8fa] text-[#20242a] dark:bg-[#0f1114] dark:text-[#f3f5f7]">
                <ShareHeader site={site} />
                <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center" aria-labelledby="share-unavailable-title">
                    <span className="grid size-12 place-items-center rounded-full border border-[#dfe3e8] bg-[#eef1f4] text-[#747d89] dark:border-[#2c3036] dark:bg-[#191d22] dark:text-[#939ca8]" aria-hidden="true">
                        <DatabaseZap className="size-5" />
                    </span>
                    <h1 id="share-unavailable-title" className="mt-4 text-xl font-semibold sm:text-2xl">
                        {t("unavailable")}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-[#747d89] dark:text-[#939ca8]">{t("databaseUnavailable")}</p>
                    <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-md bg-[#20242a] px-4 text-sm font-semibold text-white transition hover:opacity-85 dark:bg-[#f3f5f7] dark:text-[#17191d]">
                        {t("backHome")}
                    </Link>
                </section>
            </main>
        );
    }
    const contentAssets = work.assets.filter((asset) => asset.role === "content").sort((left, right) => left.sortOrder - right.sortOrder);
    const createHref = createAgentPromptHref(work.publicPrompt);
    const base = siteMetadataBase();
    const canonicalUrl = absoluteSiteUrl(`/share/${encodeURIComponent(work.slug)}`, base);
    const cover = work.assets.find((asset) => asset.role === "cover" && asset.mediaType === "image") || work.assets.find((asset) => asset.mediaType === "image");
    const structuredData = buildCreativeWorkStructuredData({
        visibility: work.visibility,
        url: canonicalUrl,
        websiteId: `${absoluteSiteUrl("/", base)}#website`,
        title: work.title,
        description: work.description || t("metadataDescription", { author: work.authorName || "", category: work.category }),
        publishedAt: work.publishedAt,
        category: work.category,
        tags: work.tags,
        authorName: work.authorName,
        imageUrl: cover ? absoluteSiteUrl(imagePreviewUrl(cover.url, 1920), base) : undefined,
    });
    const authorIdentity = (
        <>
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-[10px] font-semibold text-background">
                {work.authorAvatarUrl ? <img src={work.authorAvatarUrl} alt="" className="size-full object-cover" /> : userAvatarFallback(work.authorName || t("anonymous"))}
            </span>
            <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t("author")}</div>
                <div className="mt-0.5 truncate text-sm font-semibold">{work.authorName || t("anonymous")}</div>
            </div>
        </>
    );

    return (
        <main className="app-scroll-page bg-[#f7f8fa] text-[#20242a] dark:bg-[#0f1114] dark:text-[#f3f5f7]">
            {structuredData ? <script id="creative-work-json-ld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(structuredData) }} /> : null}
            <WorkViewTracker slug={work.slug} />
            <ShareHeader site={site} />

            <div className="mx-auto w-full max-w-[1600px] px-3 pb-10 pt-3 sm:px-6 sm:pb-16 sm:pt-4">
                <section className="flex min-w-0 flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between sm:pb-4">
                    <div className="min-w-0">
                        <h1 className="break-words text-xl font-semibold leading-tight sm:text-2xl">{work.title}</h1>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{t(`sources.${work.sourceType}`)}</span>
                            <span aria-hidden="true">/</span>
                            <span>{work.category}</span>
                            <span aria-hidden="true">/</span>
                            <span>{work.visibility === "public" ? t("publicVisibility") : t("unlistedVisibility")}</span>
                        </div>
                    </div>
                    <div className="shrink-0">
                        <WorkGovernanceActions slug={work.slug} createHref={work.publicPrompt ? createHref : undefined} />
                    </div>
                </section>

                <div className="grid min-w-0 gap-4 pt-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px]">
                    <PublicWorkMediaBrowser assets={contentAssets} title={work.title} />

                    <aside className="min-w-0 border-t border-border pt-4 lg:rounded-lg lg:border lg:bg-card lg:p-4 lg:pt-4" aria-label={t("infoAria")}>
                        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
                            <div className="flex min-w-0 items-center justify-between gap-3">
                                {work.authorUsername ? (
                                    <Link href={`/u/${encodeURIComponent(work.authorUsername)}`} className="flex min-w-0 items-center gap-2.5 rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        {authorIdentity}
                                    </Link>
                                ) : (
                                    <div className="flex min-w-0 items-center gap-2.5">{authorIdentity}</div>
                                )}
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <CalendarDays className="size-3.5" />
                                    {format.dateTime(new Date(work.publishedAt), { year: "numeric", month: "long", day: "numeric" })}
                                </span>
                            </div>

                            <div className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-3 border-y border-border py-3">
                                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" title={t("views")}>
                                    <Eye className="size-4" />
                                    <span className="tabular-nums text-foreground">{work.viewCount}</span> {t("viewCount", { count: work.viewCount })}
                                </span>
                                <PublicWorkCommunityActions slug={work.slug} />
                            </div>

                            {work.description ? (
                                <section className="mt-5">
                                    <h2 className="text-sm font-semibold">{t("description")}</h2>
                                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{work.description}</p>
                                </section>
                            ) : null}

                            <section className="mt-5">
                                <h2 className="text-sm font-semibold">{t("publicPrompt")}</h2>
                                {work.publicPrompt ? (
                                    <>
                                        <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm leading-6 text-foreground">{work.publicPrompt}</pre>
                                        <WorkPromptActions prompt={work.publicPrompt} createHref={createHref} />
                                    </>
                                ) : (
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("noPrompt")}</p>
                                )}
                            </section>

                            {work.tags.length ? (
                                <div className="mt-5 flex min-w-0 flex-wrap gap-1.5">
                                    {work.tags.map((tag) => (
                                        <span key={tag} className="max-w-40 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </aside>
                </div>

                <footer className="mt-8 flex flex-col gap-4 border-t border-[#dfe3e8] pt-6 dark:border-[#2c3036] sm:mt-12 sm:flex-row sm:items-center sm:justify-between sm:pt-8">
                    <div className="flex min-w-0 items-center gap-3">
                        <SiteLogo logoUrl={site.logoUrl || "/logo.svg"} className="size-9" />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{site.title}</div>
                            <div className="mt-0.5 text-xs text-[#747d89] dark:text-[#939ca8]">{t("footerDescription")}</div>
                        </div>
                    </div>
                    <Link
                        href="/create"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#20242a] px-4 text-sm font-medium text-[#20242a] transition hover:bg-[#20242a] hover:text-white dark:border-[#f3f5f7] dark:text-[#f3f5f7] dark:hover:bg-[#f3f5f7] dark:hover:text-[#17191d]"
                    >
                        {t("createMyWork")}
                        <ArrowUpRight className="size-4" />
                    </Link>
                </footer>
            </div>
        </main>
    );
}

function ShareHeader({ site }: { site: SiteSettings }) {
    return (
        <header className="sticky top-0 z-20 border-b border-[#e3e6ea] bg-white/95 backdrop-blur-xl dark:border-[#292d33] dark:bg-[#0f1114]/95">
            <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between gap-3 px-3 sm:h-16 sm:px-6">
                <Link href="/" className="flex min-w-0 items-center gap-2.5 text-[#20242a] dark:text-[#f3f5f7]" aria-label={site.title}>
                    <SiteLogo logoUrl={site.logoUrl || "/logo.svg"} className="size-7 sm:size-8" />
                    <span className="truncate text-sm font-semibold sm:text-base">{site.title}</span>
                </Link>
                <GalleryThemeToggle />
            </div>
        </header>
    );
}

function isPublicationUnavailable(error: unknown) {
    return error instanceof WorkPublicationServiceError && error.status === 409 && error.message.includes("需要启用 PostgreSQL");
}
