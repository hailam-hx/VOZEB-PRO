"use client";

import { Eye, GalleryVerticalEnd, Star, Video } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { LazyMediaImage } from "@/components/media/lazy-media-image";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { userAvatarFallback } from "@/lib/user-avatar";
import type { PublicGalleryItem } from "@/services/api/work-governance";
import { PublicWorkCardTitle } from "./public-work-card-title";
import { PublicWorkLikeButton } from "./public-work-like-button";

export function PublicWorkGalleryCard({ item, nextPath, onOpen, onOpenAuthor }: { item: PublicGalleryItem; nextPath: string; onOpen: () => void; onOpenAuthor?: (username: string) => void }) {
    const t = useTranslations("public.work.card");
    const authorUsername = item.authorUsername;
    const author = (
        <>
            <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-[8px] font-semibold text-background">
                {item.authorAvatarUrl ? <img src={item.authorAvatarUrl} alt="" className="size-full object-cover" loading="lazy" /> : userAvatarFallback(item.authorName || t("anonymous"))}
            </span>
            <span className="truncate">{item.authorName || t("anonymous")}</span>
        </>
    );

    return (
        <article className="group w-full min-w-0 overflow-hidden text-left text-foreground">
            <button
                type="button"
                className="relative block w-full overflow-hidden rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onOpen}
                aria-label={t("viewWork", { title: item.title })}
                aria-haspopup="dialog"
            >
                {item.preview?.mediaType === "image" ? (
                    <LazyMediaImage src={imagePreviewUrl(item.preview.url, 640)} alt={item.title} containerClassName="w-full rounded-lg" imageClassName="block h-auto w-full group-hover:scale-[1.015]" />
                ) : item.preview?.mediaType === "video" ? (
                    <>
                        <video src={item.preview.url} muted playsInline preload="metadata" className="aspect-video w-full object-cover transition duration-300 group-hover:scale-[1.015]" />
                        <span className="absolute right-2 top-2 grid size-7 place-items-center rounded bg-black/65 text-white" title={t("videoWork")}>
                            <Video className="size-3.5" />
                        </span>
                    </>
                ) : (
                    <div className="grid aspect-[4/3] place-items-center text-muted-foreground">
                        <div className="flex flex-col items-center gap-2 text-xs">
                            <GalleryVerticalEnd className="size-7" />
                            {t("publicWork")}
                        </div>
                    </div>
                )}
                {item.isFeatured ? (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-foreground px-2 py-1 text-[11px] font-medium text-background">
                        <Star className="size-3 fill-current" />
                        {t("featured")}
                    </span>
                ) : null}
                <PublicWorkCardTitle title={item.title} />
            </button>
            <div className="min-w-0 px-0.5 pb-1 pt-2">
                <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    {authorUsername && onOpenAuthor ? (
                        <button
                            type="button"
                            className="flex min-w-0 items-center gap-1.5 rounded-sm text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={t("viewCreator", { name: item.authorName || authorUsername })}
                            aria-haspopup="dialog"
                            onClick={() => onOpenAuthor(authorUsername)}
                        >
                            {author}
                        </button>
                    ) : authorUsername ? (
                        <Link
                            href={`/u/${encodeURIComponent(authorUsername)}`}
                            className="flex min-w-0 items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={t("viewCreator", { name: item.authorName || authorUsername })}
                        >
                            {author}
                        </Link>
                    ) : (
                        <span className="flex min-w-0 items-center gap-1.5">{author}</span>
                    )}
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span className="inline-flex items-center gap-1" title={t("views")}>
                            <Eye className="size-3" /> {item.viewCount}
                        </span>
                        <PublicWorkLikeButton slug={item.slug} initialCount={item.likeCount} compact nextPath={nextPath} />
                    </span>
                </div>
            </div>
        </article>
    );
}
