"use client";

import { ArrowUpRight, CheckCircle2, FileImage, LoaderCircle, Maximize2, Paperclip, RefreshCw, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { AgentMediaPreview } from "@/components/agent/agent-media-preview";
import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import type { CreateOverviewAsset, CreateOverviewMedia, CreateOverviewTask } from "@/lib/create-workbench-overview";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { cn } from "@/lib/utils";

import { useCreateWorkbenchOverview } from "../use-create-workbench-overview";
import { createConversationHref } from "../create-conversation-navigation";

const sectionTitleClass = "text-[15px] font-semibold text-[#20242a] dark:text-[#f3f5f7]";
const sectionHintClass = "mt-1 text-xs text-[#8b949f] dark:text-[#7f8996]";
const panelClass = "rounded-lg border border-[#e2e7eb] bg-white dark:border-[#2b3037] dark:bg-[#181b20]";
const recentAssetVisibilityClasses = ["", "", "hidden sm:block", "hidden lg:block", "hidden xl:block", "hidden 2xl:block"];

export function CreateWorkbenchOverview({ onUseAsset }: { onUseAsset: (asset: CreateOverviewAsset) => Promise<void> }) {
    const t = useTranslations("create");
    const { latestProject, runningTasks, recentAssets, loading, error, reload } = useCreateWorkbenchOverview();
    const [importingAssetId, setImportingAssetId] = useState("");

    const importAsset = async (asset: CreateOverviewAsset) => {
        setImportingAssetId(asset.id);
        try {
            await onUseAsset(asset);
        } finally {
            setImportingAssetId("");
        }
    };

    return (
        <div className="mt-3 w-full space-y-3 pb-3 sm:mt-12 sm:space-y-9 sm:pb-8">
            <section aria-labelledby="create-assets-heading">
                <div className="flex items-end justify-between gap-3 border-b border-[#e8ebef] pb-3 dark:border-[#292d33]">
                    <div>
                        <h2 id="create-assets-heading" className={sectionTitleClass}>
                            {t("recentGeneration")}
                        </h2>
                        <p className={sectionHintClass}>{t("recentGenerationHint")}</p>
                    </div>
                    <Link href="/assets" className="inline-flex shrink-0 items-center gap-1 text-xs text-[#697381] transition hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white">
                        {t("viewAssets")} <ArrowUpRight className="size-3.5" />
                    </Link>
                </div>
                {loading ? <OverviewLoading label={t("readingRecentGeneration")} /> : null}
                {!loading && error ? <OverviewError onRetry={reload} /> : null}
                {!loading && !error && recentAssets.length ? (
                    <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-3 sm:gap-3 sm:pt-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                        {recentAssets.slice(0, recentAssetVisibilityClasses.length).map((asset, index) => (
                            <div key={asset.id} className={recentAssetVisibilityClasses[index]}>
                                <RecentAssetCard asset={asset} importing={importingAssetId === asset.id} onUse={() => void importAsset(asset)} />
                            </div>
                        ))}
                    </div>
                ) : null}
                {!loading && !error && !recentAssets.length ? <OverviewEmpty label={t("noRecentGeneration")} /> : null}
            </section>

            <section aria-labelledby="create-projects-heading">
                <div className="flex items-end justify-between gap-3 border-b border-[#e8ebef] pb-3 dark:border-[#292d33]">
                    <div>
                        <h2 id="create-projects-heading" className={sectionTitleClass}>
                            {t("projectsAndTasks")}
                        </h2>
                        <p className={sectionHintClass}>{t("projectsAndTasksHint")}</p>
                    </div>
                    <Link href="/canvas" className="inline-flex shrink-0 items-center gap-1 text-xs text-[#697381] transition hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white">
                        {t("allProjects")} <ArrowUpRight className="size-3.5" />
                    </Link>
                </div>
                <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.9fr)] sm:mt-3 sm:gap-3">
                    <LatestProjectCard project={latestProject} loading={loading} error={error} onRetry={reload} />
                    <RunningTasksCard tasks={runningTasks} loading={loading} error={error} onRetry={reload} />
                </div>
            </section>

            {loading ? <span className="sr-only">{t("loadingOverview")}</span> : null}
        </div>
    );
}

function LatestProjectCard({ project, loading, error, onRetry }: { project?: ReturnType<typeof useCreateWorkbenchOverview>["latestProject"]; loading: boolean; error?: string; onRetry: () => void }) {
    const t = useTranslations("create");
    const updatedAt = useLocalizedRecentTime(project?.updatedAt || "");
    if (loading)
        return (
            <div className={cn(panelClass, "h-32 p-2.5 sm:h-44 sm:p-4")}>
                <OverviewLoading label={t("readingCanvasProject")} compact />
            </div>
        );
    if (error)
        return (
            <div className={cn(panelClass, "h-32 p-2.5 sm:h-44 sm:p-4")}>
                <OverviewError onRetry={onRetry} compact />
            </div>
        );
    if (!project)
        return (
            <div className={cn(panelClass, "flex h-32 items-center p-2.5 sm:h-44 sm:p-4")}>
                <OverviewEmpty label={t("noCanvasProject")} compact />
            </div>
        );

    return (
        <Link
            href={`/canvas/${project.id}`}
            className={cn(
                panelClass,
                "group grid h-32 grid-cols-[minmax(100px,34%)_minmax(0,1fr)] overflow-hidden transition hover:border-[#cbd2d9] hover:shadow-[0_8px_20px_rgba(32,36,42,0.08)] dark:hover:border-[#3b424c] dark:hover:shadow-black/25 sm:h-44 sm:grid-cols-[minmax(150px,34%)_minmax(0,1fr)]",
            )}
        >
            <div className="relative h-full min-h-0 overflow-hidden bg-[#eef1f4] dark:bg-[#252a31]">
                <CanvasProjectCover previews={project.previews} />
                <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                    <Maximize2 className="size-3" /> {t("canvasProject")}
                </span>
            </div>
            <div className="flex min-w-0 flex-col justify-between gap-1.5 p-2.5 sm:p-4">
                <div className="min-w-0">
                    <p className="text-[11px] text-[#8b949f] dark:text-[#7f8996]">{t("recentlyEdited", { time: updatedAt })}</p>
                    <h3 className="mt-1.5 truncate text-sm font-semibold text-[#20242a] sm:text-base dark:text-[#f3f5f7]">{project.title || t("untitledProject")}</h3>
                    <p className="mt-1.5 text-[11px] text-[#697381] sm:text-xs dark:text-[#9aa3af]">{t("projectCounts", { nodes: project.nodeCount, connections: project.connectionCount })}</p>
                </div>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[#20242a] px-2.5 py-1.5 text-xs font-semibold text-white transition group-hover:bg-[#343b44] dark:bg-[#f3f5f7] dark:text-[#20242a] dark:group-hover:bg-white">
                    {t("continueEditing")} <ArrowUpRight className="size-3.5" />
                </span>
            </div>
        </Link>
    );
}

function CanvasProjectCover({ previews }: { previews: CreateOverviewMedia[] }) {
    const [previewIndex, setPreviewIndex] = useState(0);
    const previewKey = previews.map((item) => `${item.kind}:${item.url}`).join("|");
    const preview = previews[previewIndex];

    useEffect(() => setPreviewIndex(0), [previewKey]);

    if (!preview)
        return (
            <div className="grid size-full place-items-center text-[#8b949f] dark:text-[#737d89]">
                <Maximize2 className="size-8" />
            </div>
        );

    const mediaClass = "size-full object-cover transition duration-300 group-hover:scale-[1.02]";
    return preview.kind === "image" ? (
        <img src={imagePreviewUrl(preview.url, 960)} alt="" loading="lazy" className={mediaClass} onError={() => setPreviewIndex((index) => index + 1)} />
    ) : (
        <video src={browserReadableMediaUrl(preview.url)} muted preload="metadata" playsInline className={mediaClass} onError={() => setPreviewIndex((index) => index + 1)} />
    );
}

function RecentAssetCard({ asset, importing, onUse }: { asset: CreateOverviewAsset; importing: boolean; onUse: () => void }) {
    const t = useTranslations("create");
    const createdAt = useLocalizedRecentTime(asset.createdAt);
    return (
        <div className="group min-w-0 overflow-hidden rounded-lg border border-[#e2e7eb] bg-white transition hover:border-[#cbd2d9] hover:shadow-[0_8px_20px_rgba(32,36,42,0.08)] dark:border-[#2b3037] dark:bg-[#181b20] dark:hover:border-[#3b424c] dark:hover:shadow-black/25">
            <div className="relative overflow-hidden bg-[#eef1f4] dark:bg-[#252a31]">
                <AgentMediaPreview type={asset.kind} url={browserReadableMediaUrl(asset.url)} title={asset.title} className="aspect-[4/3] max-h-52" />
                <span className="pointer-events-none absolute left-2 top-2 inline-flex size-7 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm" aria-hidden="true">
                    {asset.kind === "image" ? <FileImage className="size-3.5" /> : <Video className="size-3.5" />}
                </span>
            </div>
            <div className="min-w-0 px-2.5 py-2">
                <p className="truncate text-xs font-medium text-[#343b44] dark:text-[#dce1e7]">{asset.title}</p>
                <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] text-[#9aa2ad] dark:text-[#737d89]">{createdAt}</p>
                    <button
                        type="button"
                        disabled={importing}
                        className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-[#596470] transition hover:bg-[#eef1f4] hover:text-[#20242a] disabled:cursor-wait disabled:opacity-60 dark:text-[#aab2bd] dark:hover:bg-[#252a31] dark:hover:text-white"
                        onClick={onUse}
                        aria-label={t("referenceToAgent")}
                        title={t("referenceToAgent")}
                    >
                        {importing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                    </button>
                </div>
            </div>
        </div>
    );
}

function RunningTasksCard({ tasks, loading, error, onRetry }: { tasks: CreateOverviewTask[]; loading: boolean; error?: string; onRetry: () => void }) {
    const t = useTranslations("create");
    return (
        <div className={cn(panelClass, "flex h-32 min-h-0 flex-col p-3 sm:h-44 sm:p-4")}>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">{t("runningTasks")}</h3>
                {tasks.length ? <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#edf2ff] px-2 py-1 text-[11px] font-semibold text-[#5471c8] dark:bg-[#29344f] dark:text-[#b8c7ff]">{tasks.length}</span> : null}
            </div>
            {loading ? <OverviewLoading label={t("readingRunningTasks")} compact /> : null}
            {!loading && error ? <OverviewError onRetry={onRetry} compact /> : null}
            {!loading && !error && tasks.length ? (
                <div className="hide-scrollbar mt-2 min-h-0 flex-1 divide-y divide-[#edf0f2] overflow-y-auto dark:divide-[#292d33]">
                    {tasks.map((task) => (
                        <TaskRow key={task.id} task={task} />
                    ))}
                </div>
            ) : null}
            {!loading && !error && !tasks.length ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 text-center text-xs text-[#9aa2ad] dark:text-[#737d89]">
                    <CheckCircle2 className="size-6 text-[#94a3b8] dark:text-[#64748b]" />
                    <span>{t("noRunningTasks")}</span>
                </div>
            ) : null}
        </div>
    );
}

function TaskRow({ task }: { task: CreateOverviewTask }) {
    const t = useTranslations("create");
    const createdAt = useLocalizedRecentTime(task.createdAt);
    const isImage = task.kind === "image";
    const href = task.conversationId ? createConversationHref(task.conversationId) : task.source === "canvas" ? "/canvas" : "/create";
    const Icon = task.kind === "agent" ? Sparkles : isImage ? FileImage : Video;
    const status = task.status === "paused" ? t("statusPaused") : task.status === "planning" ? t("statusPlanning") : t("statusRunning");
    return (
        <Link href={href} className="group flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f1f3f5] text-[#697381] dark:bg-[#252a31] dark:text-[#aab2bd]">
                <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-[#343b44] group-hover:text-[#20242a] dark:text-[#dce1e7] dark:group-hover:text-white">{task.title || (isImage ? t("imageGeneration") : t("videoGeneration"))}</span>
                <span className="mt-1 block truncate text-[11px] text-[#9aa2ad] dark:text-[#737d89]">
                    {createdAt} · {status}
                </span>
            </span>
            <LoaderCircle className="size-4 shrink-0 animate-spin text-[#6e87db]" />
        </Link>
    );
}

function OverviewLoading({ label, compact = false }: { label: string; compact?: boolean }) {
    return (
        <div className={cn("flex items-center justify-center gap-2 text-xs text-[#9aa2ad] dark:text-[#737d89]", compact ? "min-h-20 sm:min-h-32" : "min-h-20 pt-2 sm:min-h-36 sm:pt-3")}>
            <LoaderCircle className="size-4 animate-spin" />
            {label}
        </div>
    );
}

function OverviewEmpty({ label, compact = false }: { label: string; compact?: boolean }) {
    return <div className={cn("flex items-center justify-center text-center text-xs text-[#9aa2ad] dark:text-[#737d89]", compact ? "min-h-20 sm:min-h-36" : "min-h-20 pt-2 sm:min-h-32 sm:pt-3")}>{label}</div>;
}

function OverviewError({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
    const t = useTranslations("create");
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "min-h-20 sm:min-h-32" : "min-h-20 pt-2 sm:min-h-36 sm:pt-3")}>
            <p className="max-w-md text-xs text-[#9a5b5b] dark:text-[#d49a9a]">{t("generationFailed")}</p>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#697381] transition hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white">
                <RefreshCw className="size-3.5" />
                {t("reloadOverview")}
            </button>
        </div>
    );
}

function useLocalizedRecentTime(value: string) {
    const t = useTranslations("create");
    const format = useFormatter();
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return t("justNow");
    return format.dateTime(new Date(time), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
