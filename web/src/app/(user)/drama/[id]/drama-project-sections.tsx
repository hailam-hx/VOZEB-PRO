"use client";

import { useEffect, useState } from "react";
import { App, Button, Drawer, Input, Popover, Tooltip } from "antd";
import { ArrowLeft, Bot, Boxes, ChevronDown, ChevronRight, History, PanelLeft, Plus, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import type { DramaEpisode, DramaProject } from "../types";
import { useDramaStore } from "../stores/use-drama-store";
import { DramaScriptWorkspace } from "./drama-script-workspace";
import { DramaEpisodeSettings } from "./drama-episode-settings";
import { DramaStageHeader } from "./drama-editor-elements";
import { DramaSourceImport } from "./drama-source-import";

export type DramaProjectStage = "script" | "review" | "storyboard" | "generate";

const stages = [{ value: "script" }, { value: "review" }, { value: "storyboard" }, { value: "generate" }] as const;

function usePermanentDramaPanels() {
    const [permanent, setPermanent] = useState(false);
    useEffect(() => {
        const media = window.matchMedia("(min-width: 1366px)");
        const update = () => setPermanent(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    return permanent;
}

function DramaEpisodePanel({ project, episode, permanent, onOpenChange, onStageChange }: { project: DramaProject; episode: DramaEpisode; permanent: boolean; onOpenChange: (open: boolean) => void; onStageChange: (stage: DramaProjectStage) => void }) {
    const t = useTranslations("drama.sections");
    const { modal } = App.useApp();
    const addEpisode = useDramaStore((state) => state.addEpisode);
    const deleteEpisode = useDramaStore((state) => state.deleteEpisode);
    const selectEpisode = useDramaStore((state) => state.selectEpisode);
    const [query, setQuery] = useState("");

    const confirmDelete = (episodeId: string) => {
        const removing = project.episodes.find((item) => item.id === episodeId);
        if (!removing) return;
        modal.confirm({
            title: t("deleteEpisodeTitle", { title: removing.title }),
            content: t("deleteEpisodeDescription"),
            okText: t("delete"),
            okButtonProps: { danger: true },
            cancelText: t("cancel"),
            onOk: () => deleteEpisode(project.id, removing.id),
        });
    };

    const filteredEpisodes = project.episodes.filter((item, index) => `${index + 1} ${item.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return (
        <div className="flex h-full min-h-0 flex-col bg-card" data-drama-episode-panel>
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3.5">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="text-sm font-semibold">{t("episodes")}</div>
                    <span className="text-xs tabular-nums text-muted-foreground">{project.episodes.length}</span>
                </div>
                <div className="flex items-center gap-1">
                    <Tooltip title={t("addEpisode")}>
                        <Button
                            type="text"
                            shape="circle"
                            className="!size-8 !min-w-8"
                            icon={<Plus className="size-4" />}
                            onClick={() => {
                                addEpisode(project.id, t("episodeNumber", { number: project.episodes.length + 1 }));
                                onStageChange("script");
                            }}
                            aria-label={t("addEpisode")}
                        />
                    </Tooltip>
                    {!permanent ? (
                        <Tooltip title={t("collapseEpisodeManager")}>
                            <Button type="text" shape="circle" className="!size-8 !min-w-8" icon={<X className="size-4" />} onClick={() => onOpenChange(false)} aria-label={t("collapseEpisodeManager")} />
                        </Tooltip>
                    ) : null}
                </div>
            </div>
            <div className="shrink-0 px-2.5 pt-2.5">
                <Input className="!h-8" allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchEpisodes")} aria-label={t("searchEpisodes")} />
            </div>
            <nav className="hide-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5" aria-label={t("episodeNavigation")}>
                {filteredEpisodes.map((item) => {
                    const index = project.episodes.findIndex((episodeItem) => episodeItem.id === item.id);
                    const active = item.id === episode.id;
                    const progress = episodeProgress(item);
                    return (
                        <div
                            key={item.id}
                            className={`group flex min-w-0 items-center rounded-md border transition ${active ? "border-violet-300 bg-violet-50/70 dark:border-violet-700/70 dark:bg-violet-950/25" : "border-transparent bg-transparent hover:border-border hover:bg-muted/60"}`}
                        >
                            <button
                                type="button"
                                className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                                onClick={() => {
                                    selectEpisode(project.id, item.id);
                                    if (!permanent) onOpenChange(false);
                                }}
                                aria-current={active ? "page" : undefined}
                                aria-label={t("openEpisode", { title: item.title })}
                            >
                                <span
                                    className={`grid size-8 shrink-0 place-items-center rounded text-[11px] font-semibold tabular-nums ${active ? "bg-violet-100 text-violet-700 dark:bg-violet-900/45 dark:text-violet-300" : "border border-border bg-background text-muted-foreground"}`}
                                >
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{t("episodeSummary", { characters: item.script.length, scenes: item.shots.length, progress: t(progress.key, progress.values) })}</span>
                                </span>
                            </button>
                            {project.episodes.length > 1 ? (
                                <Tooltip title={t("deleteEpisode", { title: item.title })}>
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="!mr-1 !size-8 !min-w-8 !text-muted-foreground opacity-60 transition hover:!bg-rose-50 hover:!text-rose-600 group-hover:opacity-100 focus:opacity-100 dark:hover:!bg-rose-950/30 dark:hover:!text-rose-300"
                                        icon={<Trash2 className="size-3.5" />}
                                        onClick={() => confirmDelete(item.id)}
                                        aria-label={t("deleteEpisode", { title: item.title })}
                                    />
                                </Tooltip>
                            ) : null}
                        </div>
                    );
                })}
            </nav>
            <div className="shrink-0 border-t border-border p-2.5">
                <Button
                    block
                    type="text"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                        addEpisode(project.id, t("episodeNumber", { number: project.episodes.length + 1 }));
                        onStageChange("script");
                    }}
                >
                    {t("newEpisode")}
                </Button>
            </div>
        </div>
    );
}

export function DramaEpisodeSidebar({ project, episode, open, onOpenChange, onStageChange }: { project: DramaProject; episode: DramaEpisode; open: boolean; onOpenChange: (open: boolean) => void; onStageChange: (stage: DramaProjectStage) => void }) {
    const t = useTranslations("drama.sections");
    if (!open) return null;
    return (
        <aside className="hidden h-full min-h-0 w-[190px] shrink-0 border-r border-border min-[1366px]:block" aria-label={t("episodeSidebar")} data-drama-episode-sidebar>
            <DramaEpisodePanel project={project} episode={episode} permanent onOpenChange={onOpenChange} onStageChange={onStageChange} />
        </aside>
    );
}

export function DramaEpisodeNavigator({ project, episode, open, onOpenChange, onStageChange }: { project: DramaProject; episode: DramaEpisode; open: boolean; onOpenChange: (open: boolean) => void; onStageChange: (stage: DramaProjectStage) => void }) {
    const t = useTranslations("drama.sections");
    const permanent = usePermanentDramaPanels();

    const episodeIndex = Math.max(
        0,
        project.episodes.findIndex((item) => item.id === episode.id),
    );
    const trigger = (
        <button
            type="button"
            className="mt-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition hover:text-foreground"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            aria-label={open ? t("collapseEpisodeNavigation") : t("openEpisodeNavigation")}
        >
            <PanelLeft className="size-3.5 shrink-0" />
            <span className="shrink-0 tabular-nums">{t("episodeNumber", { number: String(episodeIndex + 1).padStart(2, "0") })}</span>
            <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
    );

    return (
        <>
            {trigger}
            <Drawer title={t("episodeManager")} placement="left" size={300} open={!permanent && open} closable={false} onClose={() => onOpenChange(false)} styles={{ wrapper: { maxWidth: "100vw" }, body: { padding: 0 } }}>
                <DramaEpisodePanel project={project} episode={episode} permanent={false} onOpenChange={onOpenChange} onStageChange={onStageChange} />
            </Drawer>
        </>
    );
}

export function DramaWorkspaceHeader({
    project,
    episode,
    stage,
    assetsOpen,
    episodeNavigatorOpen,
    agentOpen,
    onStageChange,
    onOpenAssets,
    onCloseAssets,
    onEpisodeNavigatorOpenChange,
    onToggleAgent,
    onOpenVersions,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    stage: DramaProjectStage;
    assetsOpen: boolean;
    episodeNavigatorOpen: boolean;
    agentOpen: boolean;
    onStageChange: (stage: DramaProjectStage) => void;
    onOpenAssets: () => void;
    onCloseAssets: () => void;
    onEpisodeNavigatorOpenChange: (open: boolean) => void;
    onToggleAgent: () => void;
    onOpenVersions: () => void;
}) {
    const t = useTranslations("drama.sections");
    const router = useRouter();
    const updateProject = useDramaStore((state) => state.updateProject);
    const stageStatuses = dramaStageStatuses(project, episode);

    return (
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] border-b border-border bg-card/95 min-[1366px]:h-[64px] min-[1366px]:grid-cols-[190px_minmax(0,1fr)_auto]" data-drama-workspace-header>
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 px-2.5 py-2 sm:px-4 min-[1366px]:h-full min-[1366px]:border-r min-[1366px]:border-border min-[1366px]:px-4 min-[1366px]:py-0">
                <Tooltip title={t("backToProjects")}>
                    <Button type="text" shape="circle" className="!size-9 !min-w-9" icon={<ArrowLeft className="size-4" />} onClick={() => router.push("/drama")} aria-label={t("backToProjects")} />
                </Tooltip>
                <div className="min-w-0 flex-1">
                    <Input variant="borderless" className="!h-7 !p-0 !text-base !font-semibold sm:!text-lg" value={project.title} onChange={(event) => updateProject(project.id, { title: event.target.value })} aria-label={t("projectName")} />
                    {assetsOpen ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">{t("projectAssetLibrary")}</div>
                    ) : (
                        <DramaEpisodeNavigator project={project} episode={episode} open={episodeNavigatorOpen} onOpenChange={onEpisodeNavigatorOpenChange} onStageChange={onStageChange} />
                    )}
                </div>
            </div>
            <nav
                className="hide-scrollbar col-span-2 row-start-2 flex min-w-0 items-center justify-start overflow-x-auto border-t border-border/70 px-2 py-1.5 sm:px-4 min-[1366px]:col-span-1 min-[1366px]:col-start-2 min-[1366px]:row-start-1 min-[1366px]:justify-center min-[1366px]:border-t-0 min-[1366px]:px-4 min-[1366px]:py-1.5"
                aria-label={t("productionStages")}
                data-drama-stage-navigation
            >
                {stages.map((item, index) => {
                    const active = !assetsOpen && stage === item.value;
                    return (
                        <div key={item.value} className="flex shrink-0 items-center">
                            <button
                                type="button"
                                onClick={() => onStageChange(item.value)}
                                aria-label={t("switchStage", { stage: t(`stages.${item.value}`) })}
                                aria-current={active ? "step" : undefined}
                                className={`relative flex h-11 min-w-[74px] items-center justify-center gap-2 px-3 text-xs font-medium transition sm:min-w-[96px] ${active ? "bg-violet-50 text-violet-700 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-violet-600 dark:bg-violet-950/30 dark:text-violet-300 dark:after:bg-violet-400" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                            >
                                <span
                                    className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] tabular-nums ${active ? "border-violet-500 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-400 dark:text-violet-950" : "border-border bg-background"}`}
                                >
                                    {index + 1}
                                </span>
                                <span className="block sm:hidden">{t(`shortStages.${item.value}`)}</span>
                                <span className="hidden sm:block">{t(`stages.${item.value}`)}</span>
                                <span className="sr-only">{t(`statuses.${stageStatuses[item.value]}`)}</span>
                            </button>
                            {index < stages.length - 1 ? <ChevronRight className="size-3.5 text-border" aria-hidden="true" /> : null}
                        </div>
                    );
                })}
            </nav>
            <div className="col-start-2 row-start-1 flex min-w-0 shrink-0 items-center justify-end gap-1 px-2.5 py-2 max-[430px]:max-w-[212px] max-[430px]:flex-wrap sm:px-4 min-[1366px]:col-start-3 min-[1366px]:h-full min-[1366px]:py-0">
                <Tooltip title={t("projectAssets")}>
                    <Button
                        className={`!h-9 !px-2.5 ${assetsOpen ? "!border-foreground !bg-foreground !text-background" : "!border-border !bg-background hover:!border-foreground/25 hover:!bg-muted"}`}
                        icon={<Boxes className="size-4" />}
                        onClick={assetsOpen ? onCloseAssets : onOpenAssets}
                        aria-current={assetsOpen ? "page" : undefined}
                        aria-label={t("openProjectAssets")}
                    >
                        <span className="hidden 2xl:inline">{t("projectAssets")}</span>
                    </Button>
                </Tooltip>
                <Tooltip title={t("projectVersions")}>
                    <Button className="!size-9 !min-w-9 !px-0 sm:!w-auto sm:!px-3" icon={<History className="size-4" />} onClick={onOpenVersions} aria-label={t("openProjectVersions")}>
                        <span className="hidden sm:inline">{t("versionHistory")}</span>
                    </Button>
                </Tooltip>
                <Tooltip title={agentOpen ? t("collapseAgent") : t("openAgent")}>
                    <Button
                        className={`!size-9 !min-w-9 !px-0 ${agentOpen ? "!border-violet-300 !bg-violet-50 !text-violet-700 dark:!border-violet-700 dark:!bg-violet-950/35 dark:!text-violet-300" : ""}`}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                        aria-label={agentOpen ? t("collapseAgent") : t("openAgent")}
                        aria-expanded={agentOpen}
                        data-drama-agent-trigger
                    />
                </Tooltip>
                <div className="min-w-0 overflow-visible">
                    <UserStatusActions />
                </div>
            </div>
        </header>
    );
}

type DramaStageStatus = "unedited" | "organized" | "editing" | "confirmed" | "pendingConfirmation" | "pendingReview" | "complete" | "pendingGeneration" | "generating";

function dramaStageStatuses(_project: DramaProject, episode: DramaEpisode): Record<DramaProjectStage, DramaStageStatus> {
    const tasks = episode.shots.flatMap((shot) => [shot.storyboardStatus, shot.generationStatus, shot.audioStatus]);
    return {
        script: !episode.script.trim() ? "unedited" : episode.shots.length ? "organized" : "editing",
        review: episode.reviewStatus === "approved" || episode.reviewStatus === "visual_ready" ? "confirmed" : episode.reviewStatus === "content_review" ? "pendingConfirmation" : "pendingReview",
        storyboard: episode.shots.length && episode.shots.every((shot) => shot.storyboardStatus === "success") ? "complete" : "pendingGeneration",
        generate: tasks.some((status) => status === "queued" || status === "running") ? "generating" : episode.shots.length && episode.shots.every((shot) => shot.generationStatus === "success") ? "complete" : "pendingGeneration",
    };
}

type EpisodeProgressKey =
    "progress.episodeComplete" | "progress.compositing" | "progress.generatingShots" | "progress.readyToGenerate" | "progress.pendingVisualDesign" | "progress.pendingReview" | "progress.pendingScriptAnalysis" | "progress.emptyScript";

function episodeProgress(episode: DramaEpisode): { key: EpisodeProgressKey; values?: { count: number } } {
    if (episode.renderTask?.status === "success") return { key: "progress.episodeComplete" };
    if (episode.renderTask && ["pending", "running"].includes(episode.renderTask.status)) return { key: "progress.compositing" };
    if (episode.shots.some((shot) => shot.generationStatus === "queued" || shot.generationStatus === "running")) return { key: "progress.generatingShots" };
    if (episode.reviewStatus === "visual_ready") return { key: "progress.readyToGenerate", values: { count: episode.shots.length } };
    if (episode.reviewStatus === "approved") return { key: "progress.pendingVisualDesign", values: { count: episode.shots.length } };
    if (episode.reviewStatus === "content_review") return { key: "progress.pendingReview", values: { count: episode.shots.length } };
    return { key: episode.script.trim() ? "progress.pendingScriptAnalysis" : "progress.emptyScript" };
}

export function DramaScriptPanel({
    project,
    episode,
    analyzing,
    onAnalyze,
    onStageChange,
    selectedShotId,
    onSelectedShotChange,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    analyzing: boolean;
    onAnalyze: () => void;
    onStageChange: (stage: DramaProjectStage) => void;
    selectedShotId?: string;
    onSelectedShotChange: (shotId?: string) => void;
}) {
    const t = useTranslations("drama.sections");
    const scriptText = episode.script.trim();

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0" data-drama-script-statusbar>
                <DramaStageHeader
                    step="01"
                    title={t("scriptEditor.title")}
                    description={t("scriptEditor.description")}
                    status={scriptText ? (episode.shots.length ? t("statuses.organized") : t("statuses.pendingOrganization")) : t("statuses.unedited")}
                    tone={scriptText ? (episode.shots.length ? "ready" : "neutral") : "attention"}
                    metrics={[
                        { label: t("scriptEditor.characters"), value: scriptText.length },
                        { label: t("scriptEditor.scenes"), value: episode.shots.length },
                    ]}
                    action={
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <DramaSourceImport project={project} onImported={() => onStageChange("script")} />
                            <Button
                                type="primary"
                                className="!h-8 !px-2.5 enabled:!border-violet-600 enabled:!bg-violet-600 enabled:!text-white enabled:hover:!border-violet-500 enabled:hover:!bg-violet-500 dark:enabled:!border-violet-400 dark:enabled:!bg-violet-400 dark:enabled:!text-violet-950"
                                size="small"
                                icon={<Sparkles className="size-3.5" />}
                                loading={analyzing}
                                disabled={!scriptText}
                                title={scriptText ? undefined : t("scriptEditor.scriptRequired")}
                                onClick={onAnalyze}
                            >
                                {t("scriptEditor.aiOrganize")}
                            </Button>
                            <Popover trigger="click" placement="bottomRight" styles={{ container: { padding: 12, width: 320 } }} content={<DramaEpisodeSettings project={project} episode={episode} embedded />}>
                                <Button className="!h-8 !px-2.5" size="small" icon={<Settings2 className="size-3.5" />} aria-label={t("scriptEditor.openEpisodeSettings")}>
                                    {t("scriptEditor.episodeSettings")}
                                </Button>
                            </Popover>
                        </div>
                    }
                />
            </div>
            <div className="mt-3 flex min-h-0 flex-1 overflow-hidden bg-transparent">
                <DramaScriptWorkspace project={project} episode={episode} selectedShotId={selectedShotId} onSelectedShotChange={onSelectedShotChange} analyzing={analyzing} onAnalyze={onAnalyze} />
            </div>
        </div>
    );
}
