"use client";

import { useEffect, useRef, useState } from "react";
import { App, Button, Empty } from "antd";
import { ArrowRight, History } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import { createServerVideoGenerationTask } from "@/services/api/video";
import { syncUserPointsFromHeaders } from "@/services/api/points";
import { compileDramaShotPrompts } from "@/lib/drama-prompt-compiler";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { useDramaStore } from "../stores/use-drama-store";
import type { DramaContentAnalysis, DramaProject, DramaProjectVersion, DramaVisualAnalysis } from "../types";
import { useDramaAudioQueue } from "./use-drama-audio-queue";
import { DramaAgentPanel } from "./drama-agent-panel";
import { DramaAssetsPanel } from "./drama-assets-panel";
import { DramaStageHeader, stableTaskUrl } from "./drama-editor-elements";
import { DramaGenerationPanel } from "./drama-generation-panel";
import { DramaReviewPanel } from "./drama-review-panel";
import { DramaStoryboardShotCard } from "./drama-storyboard-shot-card";
import { DramaVersionModal } from "./drama-project-modals";
import { dramaGenerationSize, estimateTaskPoints, referenceImage, shotReferenceImages, storyboardReferenceImages } from "./drama-shot-generation-utils";
import { useGenerationCapacityRetry } from "./use-generation-capacity-retry";
import { DramaEpisodeSidebar, DramaScriptPanel, DramaWorkspaceHeader, type DramaProjectStage } from "./drama-project-sections";

export default function DramaProjectPage() {
    const t = useTranslations("drama.workspace");
    const router = useRouter();
    const projectId = String(useParams<{ id: string }>().id || "");
    const loadProject = useDramaStore((state) => state.loadProject);
    const project = useDramaStore((state) => state.projects.find((item) => item.id === projectId));
    const userId = useUserStore((state) => state.user?.id || "");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    useEffect(() => {
        let active = true;
        setLoading(true);
        setLoadError("");
        void loadProject(projectId)
            .catch(() => active && setLoadError(t("errors.loadFailed")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [loadProject, projectId, t, userId]);
    if (loading && !project) return <main className="grid h-full place-items-center bg-background text-sm text-muted-foreground">{t("loading")}</main>;
    if (!project)
        return (
            <main className="grid h-full place-items-center bg-background">
                <Empty description={loadError || t("notFound")}>
                    <Button onClick={() => router.push("/drama")}>{t("backToProjects")}</Button>
                </Empty>
            </main>
        );
    return <DramaProjectEditor project={project} />;
}

function DramaProjectEditor({ project }: { project: DramaProject }) {
    const t = useTranslations("drama.workspace");
    const { message } = App.useApp();
    const router = useRouter();
    const updateProject = useDramaStore((state) => state.updateProject);
    const updateEpisode = useDramaStore((state) => state.updateEpisode);
    const updateShot = useDramaStore((state) => state.updateShot);
    const applyContentAnalysis = useDramaStore((state) => state.applyContentAnalysis);
    const applyVisualAnalysis = useDramaStore((state) => state.applyVisualAnalysis);
    const createVersion = useDramaStore((state) => state.createVersion);
    const listVersions = useDramaStore((state) => state.listVersions);
    const restoreVersion = useDramaStore((state) => state.restoreVersion);
    const config = useEffectiveConfig();
    const startingShotRef = useRef("");
    const storyboardTaskRef = useRef("");
    const [stage, setStage] = useState<DramaProjectStage>("script");
    const [assetsOpen, setAssetsOpen] = useState(false);
    const [episodeNavigatorOpen, setEpisodeNavigatorOpen] = useState(false);
    const [agentOpen, setAgentOpen] = useState(false);
    const [selectedShotId, setSelectedShotId] = useState<string>();
    const [analyzing, setAnalyzing] = useState(false);
    const [designing, setDesigning] = useState(false);
    const [versionsOpen, setVersionsOpen] = useState(false);
    const [versions, setVersions] = useState<DramaProjectVersion[]>([]);
    const [versionsLoading, setVersionsLoading] = useState(false);
    const [expandedStoryboardShotId, setExpandedStoryboardShotId] = useState("");
    const { isWaiting: isCapacityWaiting, schedule: scheduleCapacityRetry } = useGenerationCapacityRetry();
    const audioReady = Boolean(config.audioModel.trim());
    const changeStage = (nextStage: DramaProjectStage) => {
        setStage(nextStage);
        setAssetsOpen(false);
    };

    const episode = project.episodes.find((item) => item.id === project.activeEpisodeId) || project.episodes[0];
    useEffect(() => {
        const media = window.matchMedia("(min-width: 1366px)");
        const update = () => {
            setEpisodeNavigatorOpen(media.matches);
        };
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    useEffect(() => {
        setSelectedShotId(undefined);
    }, [episode.id]);
    useDramaAudioQueue(project, episode, config, updateShot);
    const analyzeScript = async () => {
        if (!episode.script.trim()) return message.warning(t("errors.scriptRequired"));
        setAnalyzing(true);
        try {
            const response = await fetch("/api/drama/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: "content", script: episode.script, summary: project.summary, style: project.style }) });
            syncUserPointsFromHeaders(response.headers, "system");
            const payload = (await response.json().catch(() => ({}))) as { data?: DramaContentAnalysis; msg?: string };
            if (!response.ok || !payload.data) throw new Error("content analysis failed");
            await createVersion(project, t("versions.beforeContentAnalysis"));
            applyContentAnalysis(project.id, episode.id, payload.data);
            setStage("review");
            message.success(t("contentAnalysisSuccess", { characters: payload.data.characters.length, scenes: payload.data.scenes.length, shots: payload.data.shots.length }));
        } catch {
            message.error(t("errors.contentAnalysisFailed"));
        } finally {
            setAnalyzing(false);
        }
    };
    const designVisuals = async () => {
        if (!episode.shots.length) return message.warning(t("errors.analyzeFirst"));
        updateEpisode(project.id, episode.id, { reviewStatus: "approved" });
        setDesigning(true);
        try {
            const response = await fetch("/api/drama/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phase: "visual", summary: project.summary, style: project.style, episode, characters: project.characters, scenes: project.scenes, props: project.props, clues: project.clues, shots: episode.shots }),
            });
            syncUserPointsFromHeaders(response.headers, "system");
            const payload = (await response.json().catch(() => ({}))) as { data?: DramaVisualAnalysis; msg?: string };
            if (!response.ok || !payload.data) throw new Error("visual analysis failed");
            await createVersion(project, t("versions.beforeVisualDesign"));
            applyVisualAnalysis(project.id, episode.id, payload.data);
            setStage("storyboard");
            message.success(t("visualDesignSuccess"));
        } catch {
            message.error(t("errors.visualDesignFailed"));
        } finally {
            setDesigning(false);
        }
    };
    const openVersions = async () => {
        setVersionsOpen(true);
        setVersionsLoading(true);
        try {
            setVersions(await listVersions(project.id));
        } catch {
            message.error(t("errors.versionsLoadFailed"));
        } finally {
            setVersionsLoading(false);
        }
    };
    const restore = async (version: DramaProjectVersion) => {
        try {
            await restoreVersion(project.id, version.id);
            setVersionsOpen(false);
            setStage("review");
            message.success(t("versionRestored", { version: version.version }));
        } catch {
            message.error(t("errors.versionRestoreFailed"));
        }
    };
    useEffect(() => {
        const runningEnd = episode.shots.find((shot) => shot.storyboardEndStatus === "running" && shot.storyboardEndTaskId);
        if (runningEnd) {
            const key = `${episode.id}:${runningEnd.id}:${runningEnd.storyboardEndTaskId}`;
            if (storyboardTaskRef.current === key) return;
            storyboardTaskRef.current = key;
            const imageConfig = { ...config, model: config.imageModel || config.model, imageModel: config.imageModel || config.model, size: project.ratio, count: "1" };
            void waitForImageGenerationTask(imageConfig, { id: runningEnd.storyboardEndTaskId!, kind: "generation", model: imageConfig.model })
                .then((result) => {
                    const imageUrl = stableTaskUrl(result.remoteUrl, result.serverUrl, result.dataUrl);
                    if (!imageUrl) throw new Error("end frame URL unavailable");
                    updateShot(project.id, episode.id, runningEnd.id, {
                        storyboardEndStatus: "success",
                        storyboardEndImageUrl: imageUrl,
                        storyboardEndImageWidth: result.width,
                        storyboardEndImageHeight: result.height,
                        storyboardEndError: undefined,
                        generationStatus: "queued",
                    });
                })
                .catch(() => updateShot(project.id, episode.id, runningEnd.id, { storyboardEndStatus: "error", storyboardEndError: t("errors.endFrameFailed") }))
                .finally(() => {
                    storyboardTaskRef.current = "";
                });
            return;
        }
        const running = episode.shots.find((shot) => shot.storyboardStatus === "running" && shot.storyboardTaskId);
        if (running) {
            const key = `${episode.id}:${running.id}:${running.storyboardTaskId}`;
            if (storyboardTaskRef.current === key) return;
            storyboardTaskRef.current = key;
            const imageConfig = { ...config, model: config.imageModel || config.model, imageModel: config.imageModel || config.model, size: project.ratio, count: "1" };
            void waitForImageGenerationTask(imageConfig, { id: running.storyboardTaskId!, kind: "generation", model: imageConfig.model })
                .then((result) => {
                    const imageUrl = stableTaskUrl(result.remoteUrl, result.serverUrl, result.dataUrl);
                    if (!imageUrl) throw new Error("storyboard URL unavailable");
                    const hasEndFrame = running.storyboardFrameMode === "first_last" && running.storyboardEndStatus === "success" && Boolean(running.storyboardEndImageUrl);
                    updateShot(project.id, episode.id, running.id, {
                        storyboardStatus: "success",
                        storyboardImageUrl: imageUrl,
                        storyboardImageWidth: result.width,
                        storyboardImageHeight: result.height,
                        storyboardError: undefined,
                        storyboardEndStatus: running.storyboardFrameMode === "first_last" ? (hasEndFrame ? "success" : "queued") : "idle",
                        generationStatus: running.storyboardFrameMode === "first_last" && !hasEndFrame ? "idle" : "queued",
                    });
                })
                .catch(() => updateShot(project.id, episode.id, running.id, { storyboardStatus: "error", storyboardError: t("errors.storyboardFailed") }))
                .finally(() => {
                    storyboardTaskRef.current = "";
                });
            return;
        }
        const nextEnd = episode.shots.find((shot) => shot.storyboardEndStatus === "queued" && shot.storyboardImageUrl);
        if (nextEnd && !storyboardTaskRef.current) {
            const retryKey = `storyboard-end:${nextEnd.id}`;
            if (isCapacityWaiting(retryKey)) return;
            storyboardTaskRef.current = `${episode.id}:${nextEnd.id}:creating-end`;
            const prompt = compileDramaShotPrompts(project, episode, nextEnd).endFramePrompt;
            const references = [referenceImage(`storyboard-start-${nextEnd.id}`, t("startFrameFile", { title: nextEnd.title }), nextEnd.storyboardImageUrl!, "image/png", nextEnd.storyboardImageWidth, nextEnd.storyboardImageHeight)];
            const imageConfig = { ...config, model: config.imageModel || config.model, imageModel: config.imageModel || config.model, size: dramaGenerationSize(project, prompt, references), count: "1" };
            void createImageGenerationTask(imageConfig, prompt, references, undefined, {
                logSource: "drama",
                logTitle: t("endFrameLog", { project: project.title, shot: nextEnd.title }),
                conversationId: project.creativeConversationId,
                surface: "drama",
                projectId: project.id,
                episodeId: episode.id,
                shotId: nextEnd.id,
                estimatedPoints: estimateTaskPoints(config, "image"),
                attemptNo: nextEnd.storyboardEndAttempt || 1,
                clientRequestId: `drama-storyboard-end:${project.id}:${episode.id}:${nextEnd.id}:attempt-${nextEnd.storyboardEndAttempt || 1}`,
            })
                .then((task) => updateShot(project.id, episode.id, nextEnd.id, { storyboardEndStatus: "running", storyboardEndTaskId: task.id, storyboardEndError: undefined }))
                .catch((error) =>
                    scheduleCapacityRetry(retryKey, error)
                        ? updateShot(project.id, episode.id, nextEnd.id, { storyboardEndStatus: "queued", storyboardEndError: undefined })
                        : updateShot(project.id, episode.id, nextEnd.id, { storyboardEndStatus: "error", storyboardEndError: t("errors.endFrameTaskFailed") }),
                )
                .finally(() => {
                    storyboardTaskRef.current = "";
                });
            return;
        }
        const next = episode.shots.find((shot) => shot.storyboardStatus === "queued");
        if (!next || storyboardTaskRef.current) return;
        const retryKey = `storyboard:${next.id}`;
        if (isCapacityWaiting(retryKey)) return;
        storyboardTaskRef.current = `${episode.id}:${next.id}:creating`;
        const prompts = compileDramaShotPrompts(project, episode, next);
        const references = shotReferenceImages(project, next);
        const imageConfig = { ...config, model: config.imageModel || config.model, imageModel: config.imageModel || config.model, size: dramaGenerationSize(project, prompts.imagePrompt, references), count: "1" };
        void createImageGenerationTask(imageConfig, prompts.imagePrompt, references, undefined, {
            logSource: "drama",
            logTitle: `${project.title} · ${next.title}`,
            conversationId: project.creativeConversationId,
            surface: "drama",
            projectId: project.id,
            episodeId: episode.id,
            shotId: next.id,
            estimatedPoints: estimateTaskPoints(config, "image"),
            attemptNo: next.storyboardAttempt || 1,
            clientRequestId: `drama-storyboard:${project.id}:${episode.id}:${next.id}:attempt-${next.storyboardAttempt || 1}`,
        })
            .then((task) => updateShot(project.id, episode.id, next.id, { storyboardStatus: "running", storyboardTaskId: task.id, storyboardError: undefined }))
            .catch((error) =>
                scheduleCapacityRetry(retryKey, error)
                    ? updateShot(project.id, episode.id, next.id, { storyboardStatus: "queued", storyboardError: undefined })
                    : updateShot(project.id, episode.id, next.id, { storyboardStatus: "error", storyboardError: t("errors.storyboardTaskFailed") }),
            )
            .finally(() => {
                storyboardTaskRef.current = "";
            });
    }, [config, episode.id, episode.shots, isCapacityWaiting, project.id, project.ratio, project.title, scheduleCapacityRetry, t, updateShot]);

    useEffect(() => {
        const running = episode.shots.find((shot) => shot.generationStatus === "running" && shot.generationTaskId);
        if (!running) return;
        const timer = window.setInterval(async () => {
            const response = await fetch(`/api/video-tasks/${encodeURIComponent(running.generationTaskId!)}`, { cache: "no-store" });
            syncUserPointsFromHeaders(response.headers, "system");
            const payload = (await response.json().catch(() => ({}))) as { task?: { status?: string; result?: { url?: string }; error?: string }; error?: string };
            if (!response.ok) return updateShot(project.id, episode.id, running.id, { generationStatus: "error", generationError: t("errors.videoQueryFailed") });
            if (payload.task?.status === "success")
                updateShot(project.id, episode.id, running.id, {
                    generationStatus: "success",
                    videoUrl: payload.task.result?.url,
                    generationError: undefined,
                    ...(running.audioMode === "voiceover" && (running.subtitle || running.dialogue).trim() && audioReady ? { audioStatus: "queued" as const, audioError: undefined } : {}),
                });
            if (payload.task?.status === "error" || payload.task?.status === "cancelled") updateShot(project.id, episode.id, running.id, { generationStatus: payload.task.status, generationError: payload.task.error });
        }, 2500);
        return () => window.clearInterval(timer);
    }, [audioReady, episode.id, episode.shots, project.id, t, updateShot]);

    useEffect(() => {
        if (episode.shots.some((shot) => shot.generationStatus === "running")) return;
        const next = episode.shots.find((shot) => shot.generationStatus === "queued");
        if (!next || startingShotRef.current === next.id) return;
        const retryKey = `video:${next.id}`;
        if (isCapacityWaiting(retryKey)) return;
        startingShotRef.current = next.id;
        const mode = next.videoMode || project.defaultVideoMode;
        const references = mode === "reference" ? shotReferenceImages(project, next) : storyboardReferenceImages(next);
        const prompts = compileDramaShotPrompts(project, episode, next);
        if (mode === "reference" && !references.length) {
            updateShot(project.id, episode.id, next.id, { generationStatus: "error", generationError: t("errors.referenceRequired") });
            startingShotRef.current = "";
            return;
        }
        if (mode === "storyboard" && !next.storyboardImageUrl) {
            updateShot(project.id, episode.id, next.id, { generationStatus: "error", generationError: t("errors.startFrameRequired") });
            startingShotRef.current = "";
            return;
        }
        if (mode === "storyboard" && next.storyboardFrameMode === "first_last" && !next.storyboardEndImageUrl) {
            updateShot(project.id, episode.id, next.id, { generationStatus: "error", generationError: t("errors.endFrameRequired") });
            startingShotRef.current = "";
            return;
        }
        void createServerVideoGenerationTask(
            { ...config, model: config.videoModel || config.model, size: dramaGenerationSize(project, prompts.videoPrompt, references), videoSeconds: String(next.duration), videoGenerateAudio: String((next.audioMode || "source") === "source") },
            prompts.videoPrompt,
            references,
            [],
            [],
            {
                conversationId: project.creativeConversationId,
                surface: "drama",
                projectId: project.id,
                episodeId: episode.id,
                shotId: next.id,
                estimatedPoints: estimateTaskPoints(config, "video", next.duration),
                parentTaskId: next.storyboardTaskId,
                attemptNo: next.generationAttempt || 1,
                clientRequestId: `drama-video:${project.id}:${episode.id}:${next.id}:attempt-${next.generationAttempt || 1}`,
            },
        )
            .then((task) => updateShot(project.id, episode.id, next.id, { generationStatus: "running", generationTaskId: task.serverTaskId || task.id, generationError: undefined }))
            .catch((error) =>
                scheduleCapacityRetry(retryKey, error)
                    ? updateShot(project.id, episode.id, next.id, { generationStatus: "queued", generationError: undefined })
                    : updateShot(project.id, episode.id, next.id, { generationStatus: "error", generationError: t("errors.videoTaskFailed") }),
            )
            .finally(() => {
                startingShotRef.current = "";
            });
    }, [config, episode.id, episode.shots, isCapacityWaiting, project, scheduleCapacityRetry, t, updateShot]);

    return (
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground" data-drama-workspace aria-label={t("aria")}>
            <DramaWorkspaceHeader
                project={project}
                episode={episode}
                stage={stage}
                assetsOpen={assetsOpen}
                episodeNavigatorOpen={episodeNavigatorOpen}
                agentOpen={agentOpen}
                onStageChange={changeStage}
                onOpenAssets={() => {
                    setAssetsOpen(true);
                    setAgentOpen(false);
                    setEpisodeNavigatorOpen(false);
                }}
                onCloseAssets={() => setAssetsOpen(false)}
                onEpisodeNavigatorOpenChange={setEpisodeNavigatorOpen}
                onToggleAgent={() => setAgentOpen((open) => !open)}
                onOpenVersions={() => void openVersions()}
            />
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-drama-workspace-body>
                <DramaEpisodeSidebar project={project} episode={episode} open={episodeNavigatorOpen && !assetsOpen} onOpenChange={setEpisodeNavigatorOpen} onStageChange={changeStage} />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-drama-production-surface>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-drama-production-scroll>
                        <section
                            className={`mx-auto flex min-h-full min-w-0 flex-col px-3 py-3 ${stage === "script" ? "max-w-none min-[1366px]:px-3 min-[1366px]:pb-3 min-[1366px]:pt-3" : "max-w-[1440px] sm:px-5 sm:py-4"}`}
                            data-drama-stage={assetsOpen ? "assets" : stage}
                        >
                            {assetsOpen ? <DramaAssetsPanel project={project} episode={episode} /> : null}

                            {!assetsOpen && stage === "script" ? (
                                <DramaScriptPanel project={project} episode={episode} analyzing={analyzing} onAnalyze={() => void analyzeScript()} onStageChange={changeStage} selectedShotId={selectedShotId} onSelectedShotChange={setSelectedShotId} />
                            ) : null}

                            {!assetsOpen && stage === "review" ? <DramaReviewPanel project={project} episode={episode} designing={designing} onDesignVisuals={() => void designVisuals()} onStageChange={changeStage} /> : null}

                            {!assetsOpen && stage === "storyboard" ? (
                                <div>
                                    <DramaStageHeader
                                        step="03"
                                        title={t("storyboard.title")}
                                        description={t("storyboard.description")}
                                        status={
                                            !episode.shots.length
                                                ? t("storyboard.waiting")
                                                : episode.shots.every((shot) => shot.videoPrompt.trim() && ((shot.videoMode || project.defaultVideoMode) !== "storyboard" || shot.imagePrompt.trim()))
                                                  ? t("storyboard.ready")
                                                  : t("storyboard.needsInput")
                                        }
                                        tone={
                                            !episode.shots.length ? "attention" : episode.shots.every((shot) => shot.videoPrompt.trim() && ((shot.videoMode || project.defaultVideoMode) !== "storyboard" || shot.imagePrompt.trim())) ? "ready" : "attention"
                                        }
                                        metrics={
                                            episode.shots.length
                                                ? [
                                                      { label: t("storyboard.shots"), value: episode.shots.length },
                                                      { label: t("storyboard.duration"), value: t("seconds", { count: episode.shots.reduce((total, shot) => total + shot.duration, 0) }) },
                                                      { label: t("storyboard.referenceMode"), value: episode.shots.filter((shot) => (shot.videoMode || project.defaultVideoMode) === "reference").length },
                                                  ]
                                                : []
                                        }
                                        action={
                                            <Button
                                                type="primary"
                                                className="!h-9 !w-full sm:!w-auto"
                                                icon={<ArrowRight className="size-4" />}
                                                disabled={!episode.shots.length || episode.reviewStatus !== "visual_ready"}
                                                onClick={() => setStage("generate")}
                                            >
                                                {t("storyboard.enterGeneration")}
                                            </Button>
                                        }
                                    />
                                    {episode.shots.length ? (
                                        <div className="mt-3 grid min-w-0 items-start gap-3 xl:grid-cols-2">
                                            {episode.shots.map((shot) => (
                                                <DramaStoryboardShotCard
                                                    key={shot.id}
                                                    project={project}
                                                    episodeId={episode.id}
                                                    shot={shot}
                                                    expanded={expandedStoryboardShotId === shot.id}
                                                    onToggle={() => setExpandedStoryboardShotId((current) => (current === shot.id ? "" : shot.id))}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="mt-2.5 flex min-h-14 items-center rounded-lg border border-dashed border-border bg-card/25 px-3 py-2.5">
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-medium">{t("storyboard.emptyTitle")}</h3>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{t("storyboard.emptyDescription")}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : null}

                            {!assetsOpen && stage === "generate" ? <DramaGenerationPanel project={project} episode={episode} onStageChange={changeStage} onOpenAssets={() => setAssetsOpen(true)} /> : null}
                        </section>
                    </div>
                </div>
                <DramaAgentPanel
                    project={project}
                    episode={episode}
                    stage={stage}
                    selectedShotId={selectedShotId}
                    open={agentOpen}
                    onOpenChange={setAgentOpen}
                    onConversationChange={(creativeConversationId) => updateProject(project.id, { creativeConversationId })}
                />
            </div>
            {stage === "script" ? (
                <DramaScriptGlobalBar
                    project={project}
                    episode={episode}
                    onSave={() => createVersion(project, t("versions.manual"))}
                    onContinue={() => {
                        if (!episode.shots.length) return void analyzeScript();
                        if (episode.reviewStatus === "draft") updateEpisode(project.id, episode.id, { reviewStatus: "content_review" });
                        setStage("review");
                    }}
                    analyzing={analyzing}
                    episodeNavigatorOpen={episodeNavigatorOpen}
                />
            ) : null}
            <DramaVersionModal
                open={versionsOpen}
                loading={versionsLoading}
                versions={versions}
                onClose={() => setVersionsOpen(false)}
                onSave={() => void createVersion(project, t("versions.manual")).then(() => openVersions())}
                onRestore={(version) => void restore(version)}
            />
        </main>
    );
}

function DramaScriptGlobalBar({
    project,
    episode,
    onSave,
    onContinue,
    analyzing,
    episodeNavigatorOpen,
}: {
    project: DramaProject;
    episode: DramaProject["episodes"][number];
    onSave: () => Promise<void>;
    onContinue: () => void;
    analyzing: boolean;
    episodeNavigatorOpen: boolean;
}) {
    const t = useTranslations("drama.workspace");
    const format = useFormatter();
    const { message } = App.useApp();
    const saveState = useDramaStore((state) => state.saveStateByProject[project.id]);
    const [savingVersion, setSavingVersion] = useState(false);
    const savedLabel =
        saveState?.status === "saving"
            ? t("save.saving")
            : saveState?.status === "error"
              ? t("save.failed")
              : saveState?.savedAt
                ? t("save.lastSaved", { time: format.dateTime(new Date(saveState.savedAt), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })
                : t("save.lastSaved", { time: format.dateTime(new Date(project.updatedAt), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });
    return (
        <footer className={`flex h-[60px] shrink-0 items-center justify-between gap-2 border-t border-border bg-card px-3 sm:gap-3 sm:px-5 ${episodeNavigatorOpen ? "min-[1366px]:!pl-[210px]" : ""}`} data-drama-script-global-bar>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className={`size-2 shrink-0 rounded-full ${saveState?.status === "error" ? "bg-rose-500" : saveState?.status === "saving" ? "bg-amber-500" : "bg-emerald-500"}`} />
                <span className="hidden sm:inline" title={savedLabel}>
                    {saveState?.status === "saving" ? t("save.autoSaving") : saveState?.status === "error" ? t("save.autoSaveFailed") : t("save.autoSaveOn")}
                </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                <Button
                    className="!h-10 !px-3 sm:!px-5"
                    loading={savingVersion}
                    onClick={() => {
                        setSavingVersion(true);
                        void onSave()
                            .then(() => message.success(t("save.draftSaved")))
                            .catch(() => message.error(t("save.draftFailed")))
                            .finally(() => setSavingVersion(false));
                    }}
                >
                    <span className="sm:hidden">{t("save.save")}</span>
                    <span className="hidden sm:inline">{t("save.saveDraft")}</span>
                </Button>
                <Button
                    type="primary"
                    className="!h-10 !px-3 enabled:!border-violet-600 enabled:!bg-violet-600 enabled:!text-white enabled:hover:!border-violet-500 enabled:hover:!bg-violet-500 dark:enabled:!border-violet-400 dark:enabled:!bg-violet-400 dark:enabled:!text-violet-950 sm:!px-6"
                    icon={<ArrowRight className="size-4" />}
                    disabled={!episode.script.trim()}
                    loading={analyzing}
                    onClick={onContinue}
                >
                    <span className="sm:hidden">{t("save.enterReview")}</span>
                    <span className="hidden sm:inline">{t("save.finishAndReview")}</span>
                </Button>
            </div>
        </footer>
    );
}
