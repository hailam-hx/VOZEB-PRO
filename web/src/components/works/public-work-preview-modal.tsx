"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Modal, Tooltip } from "antd";
import { CalendarDays, Copy, Eye, ImagePlus, LoaderCircle, Share2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { getPublicWorkPublication, recordPublicWorkPublicationView, type PublicWorkPublication } from "@/services/api/work-publications";
import { createAgentPromptHref } from "@/lib/create-agent-prompt";
import { userAvatarFallback } from "@/lib/user-avatar";
import { PublicWorkCommunityActions } from "./public-work-community-actions";
import { PublicWorkMediaBrowser } from "./public-work-media-browser";
import { PublicWorkReportButton } from "./public-work-report-button";

export function PublicWorkPreviewModal({
    slug,
    onClose,
    onOpenCreator,
    onUsePrompt,
    onUseImage,
    imageImporting = false,
}: {
    slug?: string;
    onClose: () => void;
    onOpenCreator?: (username: string) => void;
    onUsePrompt?: (prompt: string) => void;
    onUseImage?: () => void | Promise<void>;
    imageImporting?: boolean;
}) {
    const t = useTranslations("public.work.preview");
    const format = useFormatter();
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const viewedSlugs = useRef(new Set<string>());
    const query = useQuery({
        queryKey: ["public-work", slug],
        queryFn: () => getPublicWorkPublication(slug!),
        enabled: Boolean(slug),
        staleTime: 30_000,
    });
    const work = query.data;

    useEffect(() => {
        if (!slug || viewedSlugs.current.has(slug)) return;
        viewedSlugs.current.add(slug);
        void recordPublicWorkPublicationView(slug)
            .then((viewCount) => queryClient.setQueryData<PublicWorkPublication>(["public-work", slug], (current) => (current ? { ...current, viewCount } : current)))
            .catch(() => undefined);
    }, [queryClient, slug]);

    const copyPrompt = async () => {
        if (!work?.publicPrompt) return;
        try {
            await navigator.clipboard.writeText(work.publicPrompt);
            message.success(t("promptCopied"));
        } catch {
            message.error(t("promptCopyFailed"));
        }
    };

    const share = async () => {
        if (!work) return;
        const url = new URL(`/share/${encodeURIComponent(work.slug)}`, window.location.origin).toString();
        try {
            await navigator.clipboard.writeText(url);
            message.success(t("linkCopied"));
        } catch {
            message.error(t("linkCopyFailed"));
        }
    };

    const contentAssets = useMemo(() => work?.assets.filter((asset) => asset.role === "content" && (asset.mediaType === "image" || asset.mediaType === "video")).sort((left, right) => left.sortOrder - right.sortOrder) || [], [work]);
    const remixHref = createAgentPromptHref(work?.publicPrompt || "");
    const authorUsername = work?.authorUsername;
    const authorIdentity = work ? (
        <>
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-[11px] font-semibold text-background" aria-hidden="true">
                {work.authorAvatarUrl ? <img src={work.authorAvatarUrl} alt="" className="size-full object-cover" /> : userAvatarFallback(work.authorName || t("anonymous"))}
            </span>
            <span className="flex h-8 min-w-0 flex-1 items-center truncate text-sm font-semibold leading-none">{work.authorName || t("anonymous")}</span>
        </>
    ) : null;

    return (
        <Modal centered open={Boolean(slug)} width="min(1280px, calc(100vw - 16px))" footer={null} closable={false} destroyOnHidden title={null} onCancel={onClose} styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}>
            <div className="max-h-[92dvh] min-w-0 overflow-y-auto bg-background text-foreground lg:h-[min(82dvh,780px)] lg:overflow-hidden">
                {query.isLoading ? (
                    <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" /> {t("loading")}
                    </div>
                ) : query.error || !work ? (
                    <div className="grid min-h-[360px] place-items-center px-5 text-center">
                        <div>
                            <p className="text-sm font-semibold">{t("unavailable")}</p>
                            <p className="mt-2 text-xs text-muted-foreground">{t("notFound")}</p>
                            <Button className="mt-4" onClick={() => void query.refetch()}>
                                {t("reload")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="grid min-w-0 lg:h-full lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div className="min-w-0 border-b border-border bg-muted/20 p-2.5 sm:p-3 lg:h-full lg:border-b-0 lg:border-r">
                            <PublicWorkMediaBrowser assets={contentAssets} title={work.title} compact />
                        </div>
                        <aside className="min-w-0 p-3.5 sm:p-4 lg:h-full lg:overflow-y-auto" aria-label={t("detailsAria")}>
                            <header className="border-b border-border pb-3">
                                <div className="flex min-w-0 items-center gap-2">
                                    {authorUsername && onOpenCreator ? (
                                        <button
                                            type="button"
                                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            aria-label={t("viewCreator", { name: work.authorName || authorUsername })}
                                            aria-haspopup="dialog"
                                            onClick={() => {
                                                onClose();
                                                onOpenCreator(authorUsername);
                                            }}
                                        >
                                            {authorIdentity}
                                        </button>
                                    ) : authorUsername ? (
                                        <Link
                                            href={`/u/${encodeURIComponent(authorUsername)}`}
                                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            onClick={onClose}
                                        >
                                            {authorIdentity}
                                        </Link>
                                    ) : (
                                        <div className="flex min-w-0 flex-1 items-center gap-2.5">{authorIdentity}</div>
                                    )}
                                    <div className="ml-auto flex shrink-0 items-center gap-0.5">
                                        <span className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-muted-foreground" aria-label={t("viewCountAria")} title={t("views")}>
                                            <Eye className="size-3.5" /> <span className="tabular-nums">{work.viewCount}</span>
                                        </span>
                                        <PublicWorkCommunityActions slug={work.slug} compact compactFollowIcon className="flex-nowrap !gap-0.5" />
                                        <Tooltip title={t("share")}>
                                            <Button type="text" size="small" shape="circle" icon={<Share2 className="size-3.5" />} onClick={() => void share()} aria-label={t("share")} />
                                        </Tooltip>
                                        <Button type="text" size="small" shape="circle" className="!-mr-1" icon={<X className="size-4" />} onClick={onClose} aria-label={t("closeDetails")} title={t("close")} />
                                    </div>
                                </div>

                                <h2 className="mt-3.5 break-words text-lg font-semibold leading-7">{work.title}</h2>
                                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                                    <span className="inline-flex shrink-0 items-center gap-1" title={t("publishedAt")}>
                                        <CalendarDays className="size-3" /> {format.dateTime(new Date(work.publishedAt), { month: "2-digit", day: "2-digit" })}
                                    </span>
                                    <span className="min-w-0 truncate">
                                        {t(`sources.${work.sourceType}`)} · {work.category}
                                    </span>
                                    <span>{work.visibility === "public" ? t("publicVisibility") : t("unlistedVisibility")}</span>
                                    <div className="ml-auto shrink-0">
                                        <PublicWorkReportButton slug={work.slug} compact />
                                    </div>
                                </div>
                            </header>

                            {work.description ? (
                                <section className="mt-3.5">
                                    <h3 className="text-xs font-semibold">{t("description")}</h3>
                                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-muted-foreground">{work.description}</p>
                                </section>
                            ) : null}

                            <section className="mt-3.5">
                                <h3 className="text-xs font-semibold">{t("prompt")}</h3>
                                <pre className="mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-sans text-[13px] leading-5 text-foreground">{work.publicPrompt || t("noPrompt")}</pre>
                                {work.publicPrompt ? (
                                    <div className="mt-2.5">
                                        <div className="flex justify-end gap-1">
                                            <Tooltip title={t("copyPrompt")}>
                                                <Button size="small" shape="circle" icon={<Copy className="size-3.5" />} onClick={() => void copyPrompt()} aria-label={t("copyPrompt")} />
                                            </Tooltip>
                                            {onUseImage && contentAssets.some((asset) => asset.mediaType === "image") ? (
                                                <Tooltip title={t("useImage")}>
                                                    <Button
                                                        size="small"
                                                        shape="circle"
                                                        icon={imageImporting ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                                                        disabled={imageImporting}
                                                        onClick={() => void onUseImage()}
                                                        aria-label={t("useImage")}
                                                    />
                                                </Tooltip>
                                            ) : null}
                                            {onUsePrompt ? (
                                                <Tooltip title={t("usePrompt")}>
                                                    <Button
                                                        type="primary"
                                                        size="small"
                                                        shape="circle"
                                                        icon={<Sparkles className="size-3.5" />}
                                                        aria-label={t("usePrompt")}
                                                        onClick={() => {
                                                            onUsePrompt(work.publicPrompt);
                                                            onClose();
                                                        }}
                                                    />
                                                </Tooltip>
                                            ) : null}
                                        </div>
                                        {!onUsePrompt ? (
                                            <Link href={remixHref} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md !bg-foreground px-4 text-sm font-semibold !text-background transition hover:opacity-80">
                                                <Sparkles className="size-4" /> {t("remix")}
                                            </Link>
                                        ) : null}
                                    </div>
                                ) : null}
                            </section>

                            {work.tags.length ? (
                                <div className="mt-4 flex min-w-0 flex-wrap gap-1">
                                    {work.tags.map((tag) => (
                                        <span key={tag} className="max-w-36 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </aside>
                    </div>
                )}
            </div>
        </Modal>
    );
}
