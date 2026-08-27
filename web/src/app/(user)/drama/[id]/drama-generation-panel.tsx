"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Progress, Tag } from "antd";
import { ArrowRight, Captions, CircleAlert, CircleCheck, CircleDashed, Download, Film, LoaderCircle, Pause, Play, RefreshCw, ScanSearch, Send, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createAgentPromptHref } from "@/lib/create-agent-prompt";
import { compileDramaShotPrompts } from "@/lib/drama-prompt-compiler";
import { mediaDownloadFileName } from "@/lib/media-file";
import { originalMediaDownloadUrl } from "@/lib/media-image-url";
import { exportDramaJianyingDraft, getDramaProjectCosts, reviewDramaEpisode } from "@/services/api/drama-projects";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useDramaStore } from "../stores/use-drama-store";
import { buildSrt } from "../subtitle";
import type { DramaCostSummary, DramaEpisode, DramaProject, DramaRenderTask, DramaShot } from "../types";
import { cancelDramaAudioTask } from "./use-drama-audio-queue";
import { AudioTag, DramaStageHeader, GenerationTag, StoryboardTag } from "./drama-editor-elements";
import { summarizeDramaGeneration } from "./drama-generation-readiness";
import { DramaMediaPreviewModal, DramaMediaThumbnail, type DramaPreviewMedia } from "./drama-media-preview";
import { DramaJianyingModal, DramaSubtitleModal } from "./drama-project-modals";
import type { DramaProjectStage } from "./drama-project-sections";
import { dramaShotQueuePreflight, estimateEpisodePoints } from "./drama-shot-generation-utils";
import { queueDramaShotsAfterPreflight } from "../drama-generation-capabilities";

const actionButtonClass = "!h-9 !px-3 [&>span:last-child]:whitespace-nowrap";

function compatibleFailure(result: ReturnType<typeof dramaShotQueuePreflight>) {
    return result.compatible ? undefined : result;
}

export function DramaGenerationPanel({ project, episode, onStageChange, onOpenAssets }: { project: DramaProject; episode: DramaEpisode; onStageChange: (stage: DramaProjectStage) => void; onOpenAssets: () => void }) {
    const t = useTranslations("drama.generation");
    const { message } = App.useApp();
    const router = useRouter();
    const config = useEffectiveConfig();
    const updateEpisode = useDramaStore((state) => state.updateEpisode);
    const updateShot = useDramaStore((state) => state.updateShot);
    const queueShots = useDramaStore((state) => state.queueShots);
    const queueAudio = useDramaStore((state) => state.queueAudio);
    const [costSummary, setCostSummary] = useState<DramaCostSummary | null>(null);
    const [renderReady, setRenderReady] = useState<boolean | null>(null);
    const [reviewingVisuals, setReviewingVisuals] = useState(false);
    const [jianyingOpen, setJianyingOpen] = useState(false);
    const [jianyingPath, setJianyingPath] = useState("");
    const [jianyingVersion, setJianyingVersion] = useState<"5" | "6">("6");
    const [jianyingExporting, setJianyingExporting] = useState(false);
    const [subtitleOpen, setSubtitleOpen] = useState(false);
    const [previewMedia, setPreviewMedia] = useState<DramaPreviewMedia>();
    const readiness = useMemo(() => summarizeDramaGeneration(project, episode), [episode, project]);
    const renderTask = episode.renderTask || null;
    const audioReady = Boolean(config.audioModel.trim());
    const assetCount = project.characters.length + project.scenes.length + project.props.length + project.clues.length;
    const audioCandidateShotIds = episode.shots.filter((shot) => shot.videoUrl && (shot.subtitle || shot.dialogue).trim() && shot.audioStatus !== "success").map((shot) => shot.id);
    const queueCompatibleShots = (shotIds: string[]) => {
        const result = queueDramaShotsAfterPreflight(
            shotIds.flatMap((id) => {
                const shot = episode.shots.find((item) => item.id === id);
                return shot ? [{ id, failure: compatibleFailure(dramaShotQueuePreflight(config, project, episode, shot)) }] : [];
            }),
            () => queueShots(project.id, episode.id, shotIds),
        );
        if (!result.queued) message.warning(`${episode.shots.find((shot) => shot.id === result.shotId)?.title || result.shotId}：${result.failure.reason}`);
    };

    useEffect(() => {
        let active = true;
        setRenderReady(null);
        void fetch("/api/drama/render-capability", { cache: "no-store" })
            .then((response) => response.json())
            .then((payload: { data?: { available?: boolean } }) => active && setRenderReady(Boolean(payload.data?.available)))
            .catch(() => active && setRenderReady(false));
        return () => {
            active = false;
        };
    }, [episode.id, project.id]);

    useEffect(() => {
        let active = true;
        const load = () =>
            void getDramaProjectCosts(project.id)
                .then((value) => active && setCostSummary(value))
                .catch(() => active && setCostSummary(null));
        load();
        const timer = window.setInterval(load, 5000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [project.id]);

    useEffect(() => {
        if (!renderTask?.id || !["pending", "running"].includes(renderTask.status)) return;
        let active = true;
        const load = async () => {
            const response = await fetch(`/api/drama/render/${encodeURIComponent(renderTask.id)}`, { cache: "no-store" });
            const payload = (await response.json().catch(() => ({}))) as { data?: DramaRenderTask };
            if (active && response.ok && payload.data) updateEpisode(project.id, episode.id, { renderTask: payload.data });
        };
        void load();
        const timer = window.setInterval(() => void load(), 2500);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [episode.id, project.id, renderTask?.id, renderTask?.status, updateEpisode]);

    const cancelShot = async (shot: DramaShot) => {
        const requests = [
            shot.storyboardTaskId ? fetch(`/api/image-tasks/${encodeURIComponent(shot.storyboardTaskId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }) : undefined,
            shot.storyboardEndTaskId ? fetch(`/api/image-tasks/${encodeURIComponent(shot.storyboardEndTaskId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }) : undefined,
            shot.generationTaskId ? fetch(`/api/video-tasks/${encodeURIComponent(shot.generationTaskId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }) : undefined,
        ].filter(Boolean) as Promise<Response>[];
        await Promise.all(requests.map((request) => request.catch(() => undefined)));
        updateShot(project.id, episode.id, shot.id, shot.storyboardTaskId || shot.storyboardEndTaskId ? { storyboardStatus: "cancelled", storyboardEndStatus: "cancelled", generationStatus: "cancelled" } : { generationStatus: "cancelled" });
    };

    const sendToAgent = (shot: DramaShot) => {
        const prompt = compileDramaShotPrompts(project, episode, shot).videoPrompt;
        router.push(createAgentPromptHref(`${prompt}\n${t("aspectRatio", { ratio: project.ratio })}`));
    };

    const downloadSubtitles = () => {
        const content = buildSrt(episode.shots);
        if (!content) return message.warning(t("subtitleRequired"));
        const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "application/x-subrip;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${project.title.trim().replace(/[\\/:*?"<>|]/g, "-") || t("subtitleFileName")}.srt`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        message.success(t("subtitleExported"));
    };

    const exportJianying = async () => {
        if (!jianyingPath.trim()) return message.warning(t("jianyingPathRequired"));
        setJianyingExporting(true);
        try {
            const result = await exportDramaJianyingDraft(project.id, { episodeId: episode.id, draftPath: jianyingPath.trim(), version: jianyingVersion });
            const url = URL.createObjectURL(result.blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = result.fileName;
            anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setJianyingOpen(false);
            message.success(t("jianyingExported"));
        } catch {
            message.error(t("jianyingExportFailed"));
        } finally {
            setJianyingExporting(false);
        }
    };

    const createRender = async () => {
        try {
            const response = await fetch("/api/drama/render", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId: project.id,
                    conversationId: project.creativeConversationId,
                    title: project.title,
                    ratio: project.ratio,
                    shots: episode.shots.map((shot) => ({ videoUrl: shot.videoUrl, audioMode: shot.audioMode || "source", audioUrl: shot.audioUrl, subtitle: shot.subtitle || shot.dialogue, duration: shot.duration })),
                }),
            });
            const payload = (await response.json().catch(() => ({}))) as { data?: DramaRenderTask; msg?: string };
            if (!response.ok || !payload.data) throw new Error("render-create-failed");
            updateEpisode(project.id, episode.id, { renderTask: payload.data });
            message.success(t("renderCreated"));
        } catch {
            message.error(t("renderCreateFailed"));
        }
    };

    const cancelRender = async () => {
        if (!renderTask?.id) return;
        try {
            const response = await fetch(`/api/drama/render/${encodeURIComponent(renderTask.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
            if (!response.ok) throw new Error("render-cancel-failed");
            updateEpisode(project.id, episode.id, { renderTask: { ...renderTask, status: "cancelled" } });
        } catch {
            message.error(t("renderCancelFailed"));
        }
    };

    const reviewVisuals = async () => {
        if (!episode.shots.some((shot) => shot.storyboardImageUrl)) return message.warning(t("storyboardRequired"));
        setReviewingVisuals(true);
        try {
            const review = await reviewDramaEpisode(project, episode);
            updateEpisode(project.id, episode.id, { visualReview: review });
            if (review.status === "passed") message.success(t("visualReviewPassed"));
            else if (review.status === "needs_revision") message.warning(t("visualReviewNeedsRevision"));
            else message.info(review.summary);
        } catch {
            message.error(t("visualReviewFailed"));
        } finally {
            setReviewingVisuals(false);
        }
    };

    const primaryAction = buildPrimaryAction({
        episode,
        readiness,
        renderReady,
        audioReady,
        renderTask,
        onStageChange,
        onQueueShots: queueCompatibleShots,
        onQueueAudio: (shotIds) => queueAudio(project.id, episode.id, shotIds),
        onCreateRender: () => void createRender(),
        translate: (key, values) => t(key, values),
    });
    const status = generationStageStatus(readiness, renderTask, (key, values) => t(key, values));
    const checklist = [
        {
            id: "review",
            title: t("checklist.reviewTitle"),
            detail: episode.reviewStatus === "visual_ready" ? t("checklist.reviewReady", { count: readiness.totalShots }) : readiness.totalShots ? t("checklist.reviewPending") : t("checklist.reviewEmpty"),
            tone: episode.reviewStatus === "visual_ready" ? ("done" as const) : ("blocked" as const),
            action: () => onStageChange(readiness.totalShots ? "review" : "script"),
            actionLabel: readiness.totalShots ? t("checklist.goReview") : t("checklist.goScript"),
        },
        {
            id: "assets",
            title: t("checklist.assetsTitle"),
            detail: readiness.missingReferenceShotIds.length ? t("checklist.assetsMissing", { count: readiness.missingReferenceShotIds.length }) : assetCount ? t("checklist.assetsReady", { count: assetCount }) : t("checklist.assetsOptional"),
            tone: readiness.missingReferenceShotIds.length ? ("blocked" as const) : assetCount ? ("done" as const) : ("optional" as const),
            action: readiness.missingReferenceShotIds.length ? () => onStageChange("storyboard") : onOpenAssets,
            actionLabel: readiness.missingReferenceShotIds.length ? t("checklist.fixReferences") : t("checklist.viewAssets"),
        },
        {
            id: "storyboard",
            title: t("checklist.storyboardTitle"),
            detail: readiness.missingPromptShotIds.length
                ? t("checklist.storyboardMissing", { count: readiness.missingPromptShotIds.length })
                : readiness.totalShots
                  ? t("checklist.storyboardReady", { count: readiness.totalShots })
                  : t("checklist.storyboardEmpty"),
            tone: readiness.missingPromptShotIds.length || !readiness.totalShots ? ("blocked" as const) : ("done" as const),
            action: () => onStageChange("storyboard"),
            actionLabel: t("checklist.openStoryboard"),
        },
        {
            id: "audio",
            title: t("checklist.audioTitle"),
            detail: !readiness.voiceoverShotIds.length ? t("checklist.audioOptional") : audioReady ? t("checklist.audioReady", { count: readiness.voiceoverShotIds.length }) : t("checklist.audioMissing", { count: readiness.voiceoverShotIds.length }),
            tone: !readiness.voiceoverShotIds.length ? ("optional" as const) : audioReady ? ("done" as const) : ("blocked" as const),
            action: () => onStageChange("storyboard"),
            actionLabel: t("checklist.checkAudio"),
        },
    ];

    return (
        <div className="min-w-0" data-drama-generation-panel>
            <DramaStageHeader
                step="04"
                title={t("title")}
                description={status.description}
                status={status.label}
                tone={status.tone}
                metrics={
                    readiness.totalShots
                        ? [
                              { label: t("metrics.shots"), value: `${readiness.completedVideoCount}/${readiness.totalShots}` },
                              { label: t("metrics.voiceover"), value: readiness.voiceoverShotIds.length ? `${readiness.completedAudioCount}/${readiness.voiceoverShotIds.length}` : t("metrics.notNeeded") },
                              { label: t("metrics.estimated"), value: t("points", { count: estimateEpisodePoints(config, project, episode.shots) }) },
                              { label: t("metrics.actual"), value: t("points", { count: costSummary?.actualPoints || 0 }) },
                              { label: t("metrics.tasks"), value: costSummary?.taskCount || 0 },
                          ]
                        : []
                }
                action={primaryAction}
            />

            {readiness.totalShots ? (
                <div className="mt-3 flex items-center gap-3" aria-label={t("progressAria")}>
                    <Progress className="!m-0 min-w-0 flex-1" percent={readiness.progressPercent} showInfo={false} />
                    <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{readiness.progressPercent}%</span>
                </div>
            ) : null}

            <section className="mt-2.5" aria-labelledby="drama-preflight-title" data-drama-generation-readiness>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <h3 id="drama-preflight-title" className="shrink-0 text-sm font-semibold">
                            {t("preflight.title")}
                        </h3>
                        <p className="truncate text-xs text-muted-foreground">{t("preflight.description")}</p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("preflight.ready", { ready: checklist.filter((item) => item.tone === "done" || item.tone === "optional").length, total: 4 })}</span>
                </div>
                <div className={`mt-2 grid gap-1.5 ${readiness.totalShots ? "sm:grid-cols-2 xl:grid-cols-4" : "max-w-xl"}`}>
                    {(readiness.totalShots ? checklist : checklist.slice(0, 1)).map(({ id, ...item }) => (
                        <ReadinessItem key={id} {...item} />
                    ))}
                </div>
            </section>

            {readiness.totalShots ? (
                <section className="mt-3 border-y border-border" aria-labelledby="drama-production-tools" data-drama-generation-tools>
                    <h3 id="drama-production-tools" className="sr-only">
                        {t("tools.aria")}
                    </h3>
                    <div className="grid lg:grid-cols-3 lg:divide-x lg:divide-border">
                        <ToolGroup title={t("tools.primary")} description={t("tools.primaryDescription")}>
                            <Button className={actionButtonClass} icon={<ScanSearch className="size-4" />} loading={reviewingVisuals} disabled={!episode.shots.some((shot) => shot.storyboardImageUrl)} onClick={() => void reviewVisuals()}>
                                {t("tools.visualReview")}
                            </Button>
                        </ToolGroup>
                        <ToolGroup title={t("tools.postProduction")} description={audioReady ? t("tools.postProductionReady") : t("tools.postProductionMissingAudio")}>
                            <Button
                                className={actionButtonClass}
                                icon={<Volume2 className="size-4" />}
                                disabled={!audioReady || !audioCandidateShotIds.length}
                                title={audioReady ? undefined : t("audioModelRequired")}
                                onClick={() => queueAudio(project.id, episode.id, audioCandidateShotIds)}
                            >
                                {t("tools.batchVoiceover")}
                            </Button>
                            <Button className={actionButtonClass} icon={<Captions className="size-4" />} disabled={!episode.shots.some((shot) => (shot.subtitle || shot.dialogue).trim())} onClick={() => setSubtitleOpen(true)}>
                                {t("tools.subtitleTimeline")}
                            </Button>
                        </ToolGroup>
                        <ToolGroup title={t("tools.delivery")} description={t("tools.deliveryDescription")}>
                            <Button className={actionButtonClass} icon={<Download className="size-4" />} disabled={!episode.shots.some((shot) => (shot.subtitle || shot.dialogue).trim())} onClick={downloadSubtitles}>
                                {t("tools.exportSrt")}
                            </Button>
                            <Button className={actionButtonClass} icon={<Download className="size-4" />} disabled={!episode.shots.some((shot) => shot.videoUrl)} onClick={() => setJianyingOpen(true)}>
                                {t("tools.jianyingDraft")}
                            </Button>
                        </ToolGroup>
                    </div>
                </section>
            ) : null}

            {episode.visualReview ? <VisualReview episode={episode} onRetry={queueCompatibleShots} /> : null}
            {renderTask ? <RenderTaskCard task={renderTask} onCancel={() => void cancelRender()} /> : null}

            {episode.shots.length ? (
                <section className="mt-3" aria-labelledby="drama-shot-task-title">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                        <div>
                            <h3 id="drama-shot-task-title" className="text-sm font-semibold">
                                {t("tasks.title")}
                            </h3>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("tasks.description")}</p>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                            <span>{t("tasks.complete", { count: readiness.completedVideoCount })}</span>
                            <span>{t("tasks.active", { count: readiness.activeShotIds.length })}</span>
                            <span>{t("tasks.failed", { count: readiness.failedShotIds.length })}</span>
                        </div>
                    </div>

                    <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-card" data-drama-shot-task-list>
                        {episode.shots.map((shot) => (
                            <ShotTaskRow
                                key={shot.id}
                                project={project}
                                episode={episode}
                                shot={shot}
                                audioReady={audioReady}
                                onPreview={setPreviewMedia}
                                onCancel={() => void cancelShot(shot)}
                                onQueue={() => queueCompatibleShots([shot.id])}
                                onSendToAgent={() => sendToAgent(shot)}
                            />
                        ))}
                    </div>
                </section>
            ) : null}

            <DramaJianyingModal
                open={jianyingOpen}
                path={jianyingPath}
                version={jianyingVersion}
                exporting={jianyingExporting}
                onClose={() => setJianyingOpen(false)}
                onExport={() => void exportJianying()}
                onPathChange={setJianyingPath}
                onVersionChange={setJianyingVersion}
            />
            <DramaSubtitleModal open={subtitleOpen} shots={episode.shots} onClose={() => setSubtitleOpen(false)} />
            <DramaMediaPreviewModal media={previewMedia} onClose={() => setPreviewMedia(undefined)} />
        </div>
    );
}

type ReadinessTone = "done" | "blocked" | "optional";

function ReadinessItem({ title, detail, tone, action, actionLabel }: { title: string; detail: string; tone: ReadinessTone; action: () => void; actionLabel: string }) {
    const Icon = tone === "done" ? CircleCheck : tone === "blocked" ? CircleAlert : CircleDashed;
    const iconClass = tone === "done" ? "text-emerald-600 dark:text-emerald-300" : tone === "blocked" ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground";
    return (
        <button
            type="button"
            className="group flex h-12 min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left transition hover:border-foreground/20 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/35"
            onClick={action}
            title={`${title}：${detail}`}
            aria-label={`${title}，${actionLabel}`}
        >
            <Icon className={`size-4 shrink-0 ${iconClass}`} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{detail}</span>
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground transition group-hover:text-foreground">{actionLabel}</span>
        </button>
    );
}

function ToolGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <div className="min-w-0 border-b border-border py-3 last:border-b-0 lg:border-b-0 lg:px-4 lg:first:pl-0 lg:last:pr-0">
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            <div className="mt-2 flex min-w-0 flex-wrap gap-2">{children}</div>
        </div>
    );
}

function VisualReview({ episode, onRetry }: { episode: DramaEpisode; onRetry: (shotIds: string[]) => void }) {
    const t = useTranslations("drama.generation");
    const review = episode.visualReview!;
    return (
        <section className="mt-6 border-b border-border pb-5" aria-label={t("visualReview.title")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{t("visualReview.title")}</h3>
                        <Tag color={review.status === "passed" ? "success" : review.status === "needs_revision" ? "warning" : "default"}>
                            {review.status === "passed" ? t("visualReview.passed") : review.status === "needs_revision" ? t("visualReview.needsRevision") : t("visualReview.incomplete")}
                        </Tag>
                        {typeof review.score === "number" ? <span className="text-xs tabular-nums text-muted-foreground">{t("visualReview.score", { score: review.score })}</span> : null}
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{review.summary}</p>
                </div>
                {review.retryTaskIds.length ? (
                    <Button className="!h-9 shrink-0" icon={<RefreshCw className="size-4" />} onClick={() => onRetry(review.retryTaskIds)}>
                        {t("visualReview.retry", { count: review.retryTaskIds.length })}
                    </Button>
                ) : null}
            </div>
            {review.issues.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {review.issues.map((issue, index) => {
                        const shot = episode.shots.find((item) => item.id === issue.taskId);
                        return (
                            <div key={`${issue.taskId || "general"}-${index}`} className="border-l-2 border-amber-400 pl-3 text-sm">
                                <div className="font-medium">{shot?.title || issue.category}</div>
                                <p className="mt-1 leading-5 text-muted-foreground">{issue.message}</p>
                                {issue.correction ? <p className="mt-1 leading-5">{t("visualReview.suggestion", { suggestion: issue.correction })}</p> : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </section>
    );
}

function RenderTaskCard({ task, onCancel }: { task: DramaRenderTask; onCancel: () => void }) {
    const t = useTranslations("drama.generation");
    const active = task.status === "pending" || task.status === "running";
    return (
        <section className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label={t("render.taskAria")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                        {active ? <LoaderCircle className="size-4 animate-spin text-sky-600 dark:text-sky-300" /> : <Film className="size-4" />}
                        {t("render.title")}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {task.status === "success" ? t("render.complete") : task.status === "error" ? t("render.failed") : task.status === "cancelled" ? t("render.cancelled") : t("render.running")}
                    </p>
                </div>
                {active ? (
                    <Button danger className="!h-9 shrink-0" onClick={onCancel}>
                        {t("render.cancel")}
                    </Button>
                ) : null}
            </div>
            {task.result?.url ? (
                <div className="mt-4">
                    <video className="max-h-[520px] w-full rounded-xl bg-black" src={task.result.url} controls preload="metadata" />
                    <a className="mt-3 inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-cyan-300" href={originalMediaDownloadUrl(task.result.url)} download={mediaDownloadFileName(task.id, "video/mp4", task.result.url)}>
                        {t("render.download")}
                    </a>
                </div>
            ) : null}
        </section>
    );
}

function ShotTaskRow({
    project,
    episode,
    shot,
    audioReady,
    onPreview,
    onCancel,
    onQueue,
    onSendToAgent,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    shot: DramaShot;
    audioReady: boolean;
    onPreview: (media: DramaPreviewMedia) => void;
    onCancel: () => void;
    onQueue: () => void;
    onSendToAgent: () => void;
}) {
    const t = useTranslations("drama.generation");
    const updateShot = useDramaStore((state) => state.updateShot);
    const queueAudio = useDramaStore((state) => state.queueAudio);
    const generating = [shot.storyboardStatus, shot.storyboardEndStatus, shot.generationStatus].some((status) => status === "queued" || status === "running");
    const failed = [shot.storyboardStatus, shot.storyboardEndStatus, shot.generationStatus].some((status) => status === "error");
    const dialogue = (shot.subtitle || shot.dialogue || shot.narration).trim();

    return (
        <article
            className="grid min-w-0 gap-4 overflow-hidden border-b border-border p-3.5 last:border-b-0 hover:bg-muted/20 [content-visibility:visible] sm:p-4 sm:[content-visibility:auto] lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start"
            data-drama-shot-task
        >
            <div className="min-w-0">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums">{String(shot.order).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                            <h4 className="min-w-0 truncate font-semibold">{shot.title || t("shot.shotNumber", { number: String(shot.order).padStart(2, "0") })}</h4>
                            <div className="flex flex-wrap items-center gap-1.5">
                                <StoryboardTag status={shot.storyboardStatus} />
                                {shot.storyboardFrameMode === "first_last" ? (
                                    <Tag className="!m-0 !h-6 !rounded-md !leading-6">
                                        {t("shot.endFrameStatus", { status: shot.storyboardEndStatus === "success" ? t("shot.complete") : shot.storyboardEndStatus === "error" ? t("shot.failed") : t("shot.pending") })}
                                    </Tag>
                                ) : null}
                                <GenerationTag status={shot.generationStatus} />
                                {shot.audioMode === "voiceover" ? <AudioTag status={shot.audioStatus} /> : <Tag className="!m-0">{shot.audioMode === "mute" ? t("shot.mute") : t("shot.sourceAudio")}</Tag>}
                            </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{shot.videoPrompt || t("shot.missingVideoPrompt")}</p>
                    </div>
                </div>

                <ShotErrors shot={shot} />

                {shot.storyboardImageUrl || shot.videoUrl ? (
                    <div className="ml-11 mt-3 flex max-w-2xl flex-wrap gap-2">
                        {shot.storyboardImageUrl ? <DramaMediaThumbnail media={{ type: "image", url: shot.storyboardImageUrl, title: t("shot.startFrame", { title: shot.title }) }} onOpen={onPreview} /> : null}
                        {shot.storyboardEndImageUrl ? <DramaMediaThumbnail media={{ type: "image", url: shot.storyboardEndImageUrl, title: t("shot.endFrame", { title: shot.title }) }} onOpen={onPreview} /> : null}
                        {shot.videoUrl ? <DramaMediaThumbnail media={{ type: "video", url: shot.videoUrl, title: t("shot.generatedVideo", { title: shot.title }) }} onOpen={onPreview} /> : null}
                    </div>
                ) : null}
                {dialogue ? <p className="ml-11 mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">{t("shot.subtitle", { subtitle: dialogue })}</p> : null}
                {shot.audioUrl ? <audio className="ml-11 mt-3 h-10 w-[calc(100%_-_2.75rem)] max-w-sm" src={shot.audioUrl} controls preload="metadata" /> : null}
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1">
                {shot.audioStatus === "running" || shot.audioStatus === "queued" ? (
                    <Button className={actionButtonClass} icon={<Pause className="size-4" />} onClick={() => void cancelDramaAudioTask(shot.audioTaskId).finally(() => updateShot(project.id, episode.id, shot.id, { audioStatus: "cancelled" }))}>
                        {t("shot.cancelVoiceover")}
                    </Button>
                ) : dialogue ? (
                    <Button className={actionButtonClass} disabled={!audioReady} title={audioReady ? undefined : t("audioModelRequired")} icon={<Volume2 className="size-4" />} onClick={() => queueAudio(project.id, episode.id, [shot.id])}>
                        {shot.audioStatus === "error" ? t("shot.retryVoiceover") : shot.audioMode === "voiceover" ? t("shot.generateVoiceover") : t("shot.useAiVoiceover")}
                    </Button>
                ) : null}
                {generating ? (
                    <Button className={`${dialogue ? "" : "col-span-2 lg:col-span-1"} ${actionButtonClass}`} icon={<Pause className="size-4" />} onClick={onCancel}>
                        {t("shot.cancelGeneration")}
                    </Button>
                ) : (
                    <Button
                        className={`${dialogue ? "" : "col-span-2 lg:col-span-1"} ${actionButtonClass}`}
                        disabled={episode.reviewStatus !== "visual_ready"}
                        icon={failed ? <RefreshCw className="size-4" /> : <Play className="size-4" />}
                        onClick={onQueue}
                    >
                        {failed ? t("shot.retryShot") : shot.videoUrl ? t("shot.regenerate") : t("shot.generateShot")}
                    </Button>
                )}
                <Button type="text" disabled={!shot.videoPrompt} className={`col-span-2 !bg-muted/60 hover:!bg-muted lg:col-span-1 ${actionButtonClass}`} icon={<Send className="size-4" />} onClick={onSendToAgent}>
                    {t("shot.sendToAgent")}
                </Button>
            </div>
        </article>
    );
}

function ShotErrors({ shot }: { shot: DramaShot }) {
    const t = useTranslations("drama.generation");
    const errors = [
        shot.storyboardError ? `${t("shot.errors.storyboard")}：${shot.storyboardError}` : "",
        shot.storyboardEndError ? `${t("shot.errors.endFrame")}：${shot.storyboardEndError}` : "",
        shot.generationError ? `${t("shot.errors.video")}：${shot.generationError}` : "",
        shot.audioError ? `${t("shot.errors.voiceover")}：${shot.audioError}` : "",
    ].filter(Boolean);
    return errors.length ? (
        <div className="ml-11 mt-2 space-y-1 border-l-2 border-rose-300 pl-3 text-xs leading-5 text-rose-600 dark:border-rose-800 dark:text-rose-300">
            {errors.map((error) => (
                <p key={error}>{error}</p>
            ))}
        </div>
    ) : null;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function generationStageStatus(readiness: ReturnType<typeof summarizeDramaGeneration>, renderTask: DramaRenderTask | null, t: Translate): { label: string; description: string; tone: "neutral" | "ready" | "attention" | "running" } {
    if (!readiness.totalShots) return { label: t("status.waiting"), description: t("status.waitingDescription"), tone: "attention" };
    if (renderTask?.status === "success") return { label: t("status.complete"), description: t("status.completeDescription"), tone: "ready" };
    if (renderTask && ["pending", "running"].includes(renderTask.status)) return { label: t("status.compositing"), description: t("status.compositingDescription"), tone: "running" };
    if (readiness.activeShotIds.length) return { label: t("status.running"), description: t("status.runningDescription", { count: readiness.activeShotIds.length }), tone: "running" };
    if (readiness.failedShotIds.length) return { label: t("status.attention"), description: t("status.attentionDescription", { count: readiness.failedShotIds.length }), tone: "attention" };
    if (readiness.completedVideoCount === readiness.totalShots && !readiness.missingAudioShotIds.length) return { label: t("status.readyToRender"), description: t("status.readyToRenderDescription"), tone: "ready" };
    return { label: t("status.ready"), description: t("status.readyDescription"), tone: "neutral" };
}

function buildPrimaryAction({
    episode,
    readiness,
    renderReady,
    audioReady,
    renderTask,
    onStageChange,
    onQueueShots,
    onQueueAudio,
    onCreateRender,
    translate: t,
}: {
    episode: DramaEpisode;
    readiness: ReturnType<typeof summarizeDramaGeneration>;
    renderReady: boolean | null;
    audioReady: boolean;
    renderTask: DramaRenderTask | null;
    onStageChange: (stage: DramaProjectStage) => void;
    onQueueShots: (shotIds: string[]) => void;
    onQueueAudio: (shotIds: string[]) => void;
    onCreateRender: () => void;
    translate: Translate;
}) {
    const primaryClass = "!h-11 !w-full !px-4 sm:!h-9 sm:!w-auto";
    if (!readiness.totalShots)
        return (
            <Button type="primary" className={primaryClass} icon={<ArrowRight className="size-4" />} onClick={() => onStageChange("script")}>
                {t("primary.returnToScript")}
            </Button>
        );
    if (episode.reviewStatus !== "visual_ready")
        return (
            <Button type="primary" className={primaryClass} icon={<ArrowRight className="size-4" />} onClick={() => onStageChange("review")}>
                {t("primary.completeReview")}
            </Button>
        );
    if (readiness.activeShotIds.length)
        return (
            <Button type="primary" className={primaryClass} loading disabled>
                {t("primary.processing", { count: readiness.activeShotIds.length })}
            </Button>
        );
    if (readiness.queueableShotIds.length)
        return (
            <Button type="primary" className={primaryClass} icon={<Play className="size-4" />} onClick={() => onQueueShots(readiness.queueableShotIds)}>
                {readiness.failedShotIds.length ? t("primary.retryReady", { count: readiness.queueableShotIds.length }) : t("primary.generateReady", { count: readiness.queueableShotIds.length })}
            </Button>
        );
    if (readiness.missingPromptShotIds.length || readiness.missingReferenceShotIds.length)
        return (
            <Button type="primary" className={primaryClass} icon={<ArrowRight className="size-4" />} onClick={() => onStageChange("storyboard")}>
                {t("primary.fixBlocked", { count: new Set([...readiness.missingPromptShotIds, ...readiness.missingReferenceShotIds]).size })}
            </Button>
        );
    if (readiness.missingAudioShotIds.length)
        return (
            <Button type="primary" className={primaryClass} icon={<Volume2 className="size-4" />} disabled={!audioReady} title={audioReady ? undefined : t("audioModelRequired")} onClick={() => onQueueAudio(readiness.missingAudioShotIds)}>
                {audioReady ? t("primary.generateVoiceovers", { count: readiness.missingAudioShotIds.length }) : t("primary.waitingAudioModel")}
            </Button>
        );
    if (renderTask && ["pending", "running"].includes(renderTask.status))
        return (
            <Button type="primary" className={primaryClass} loading disabled>
                {t("primary.compositing")}
            </Button>
        );
    if (renderTask?.result?.url)
        return (
            <Button type="primary" className={primaryClass} icon={<Download className="size-4" />} href={originalMediaDownloadUrl(renderTask.result.url)} download={mediaDownloadFileName(renderTask.id, "video/mp4", renderTask.result.url)}>
                {t("primary.download")}
            </Button>
        );
    if (renderReady === null)
        return (
            <Button type="primary" className={primaryClass} loading disabled>
                {t("primary.checkEnvironment")}
            </Button>
        );
    if (!renderReady)
        return (
            <Button type="primary" className={primaryClass} disabled title={t("primary.ffmpegMissing")}>
                {t("primary.ffmpegUnavailable")}
            </Button>
        );
    return (
        <Button type="primary" className={primaryClass} icon={<Film className="size-4" />} onClick={onCreateRender}>
            {renderTask?.status === "error" || renderTask?.status === "cancelled" ? t("primary.rerender") : t("primary.render")}
        </Button>
    );
}
