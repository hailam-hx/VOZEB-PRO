"use client";

import { App, Button, Popconfirm, Tag, Tooltip } from "antd";
import { ArrowUpRight, Clapperboard, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import type { DramaProjectSummary } from "../types";
import { useDramaStore } from "../stores/use-drama-store";

export function DramaProjectCard({ project }: { project: DramaProjectSummary }) {
    const t = useTranslations("drama.card");
    const router = useRouter();
    const { message } = App.useApp();
    const deleteProject = useDramaStore((state) => state.deleteProject);
    const pendingCount = project.pendingTaskCount;
    const failedCount = project.failedTaskCount;
    return (
        <article className="group relative rounded-lg border border-border bg-card p-3 text-card-foreground transition hover:-translate-y-px hover:border-foreground/25 hover:shadow-sm focus-within:border-foreground/35 focus-within:ring-2 focus-within:ring-ring/20 sm:p-3.5">
            <Link href={`/drama/${project.id}`} className="absolute inset-0 z-0 rounded-lg outline-none" aria-label={t("openNamed", { title: project.title })}>
                <span className="sr-only">{t("openNamed", { title: project.title })}</span>
            </Link>
            <div className="pointer-events-none relative z-[1] flex min-w-0 items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-background">
                    <Clapperboard className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold sm:text-base">{project.title}</h2>
                    <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">{project.summary || t("noSummary")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {pendingCount ? (
                        <span className="inline-flex h-6 items-center rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-300">
                            {t("running", { count: pendingCount })}
                        </span>
                    ) : null}
                    {failedCount ? (
                        <Tag color="error" className="m-0">
                            {t("failed", { count: failedCount })}
                        </Tag>
                    ) : null}
                    <Tag className="m-0">{project.ratio}</Tag>
                    <ArrowUpRight className="size-3.5 text-muted-foreground transition group-hover:text-foreground" />
                </div>
            </div>
            <div className="relative z-10 mt-2.5 flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2.5">
                <div className="pointer-events-none min-w-0 truncate text-xs leading-5 text-muted-foreground">{t("counts", { episodes: project.episodeCount, characters: project.characterCount, scenes: project.sceneCount, shots: project.shotCount })}</div>
                <div className="flex shrink-0 justify-end gap-1.5">
                    <Popconfirm title={t("deleteConfirm")} onConfirm={() => deleteProject(project.id).catch(() => message.error(t("deleteFailed")))}>
                        <Tooltip title={t("delete")}>
                            <Button
                                type="text"
                                shape="circle"
                                className="!size-8 !text-muted-foreground hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-950/30 dark:hover:!text-rose-300"
                                icon={<Trash2 className="size-3.5" />}
                                aria-label={t("delete")}
                            />
                        </Tooltip>
                    </Popconfirm>
                    <Button className="!h-8 !px-2.5" icon={<Share2 className="size-3.5" />} onClick={() => router.push(`/works?sourceType=drama&sourceId=${encodeURIComponent(project.id)}`)}>
                        {t("publish")}
                    </Button>
                </div>
            </div>
        </article>
    );
}
