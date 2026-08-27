"use client";

import { Button, Input, Modal } from "antd";
import { ArrowLeft, Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useEffectiveConfig } from "@/stores/use-config-store";

import type { DramaEpisode, DramaProject } from "@/lib/drama-project-contract";
import { useDramaStore } from "../stores/use-drama-store";
import { DramaStageHeader } from "./drama-editor-elements";
import type { DramaProjectStage } from "./drama-project-sections";
import { DramaShotDialogueEditor } from "./drama-shot-dialogue-editor";
import { DramaDurationField } from "./drama-duration-field";
import { resolveDramaGenerationCapabilities } from "../drama-generation-capabilities";

export function DramaReviewPanel({ project, episode, onDesignVisuals, designing, onStageChange }: { project: DramaProject; episode: DramaEpisode; onDesignVisuals: () => void; designing: boolean; onStageChange: (stage: DramaProjectStage) => void }) {
    const t = useTranslations("drama.editor.review");
    const updateEpisode = useDramaStore((state) => state.updateEpisode);
    const updateShot = useDramaStore((state) => state.updateShot);
    const config = useEffectiveConfig();
    const videoParameters = resolveDramaGenerationCapabilities(config).videoParameters;
    const [episodeInfoOpen, setEpisodeInfoOpen] = useState(false);
    const [expandedShotIds, setExpandedShotIds] = useState<Set<string>>(() => new Set(episode.shots.slice(0, 1).map((shot) => shot.id)));
    useEffect(() => {
        setExpandedShotIds(new Set(episode.shots.slice(0, 1).map((shot) => shot.id)));
    }, [episode.id]);
    const updateContentShot = (shotId: string, patch: Parameters<typeof updateShot>[3]) => {
        updateShot(project.id, episode.id, shotId, patch);
        if (episode.reviewStatus !== "content_review") updateEpisode(project.id, episode.id, { reviewStatus: "content_review" });
    };
    const toggleShot = (shotId: string) => {
        setExpandedShotIds((current) => {
            const next = new Set(current);
            if (next.has(shotId)) next.delete(shotId);
            else next.add(shotId);
            return next;
        });
    };
    const totalDuration = episode.shots.reduce((total, shot) => total + shot.duration, 0);
    const dialogueCount = episode.shots.reduce((total, shot) => total + (shot.utterances.filter((item) => item.type === "dialogue").length || shot.dialogue.split(/\n+/).filter((line) => line.trim()).length), 0);
    return (
        <div>
            <DramaStageHeader
                step="02"
                title={t("title")}
                description={t("description")}
                status={!episode.shots.length ? t("waitingStructure") : episode.reviewStatus === "visual_ready" ? t("visualPlanReady") : t("pendingConfirmation")}
                tone={!episode.shots.length ? "attention" : episode.reviewStatus === "visual_ready" ? "ready" : "neutral"}
                metrics={
                    episode.shots.length
                        ? [
                              { label: t("shots"), value: episode.shots.length },
                              { label: t("duration"), value: t("seconds", { count: totalDuration }) },
                              { label: t("dialogue"), value: t("lines", { count: dialogueCount }) },
                          ]
                        : []
                }
                secondaryAction={
                    <Button className="!h-8" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setEpisodeInfoOpen(true)}>
                        {t("episodeInfo")}
                    </Button>
                }
                action={
                    <Button
                        type="primary"
                        className="!h-9 !w-full sm:!w-auto"
                        icon={episode.shots.length ? <Check className="size-4" /> : <ArrowLeft className="size-4" />}
                        loading={designing}
                        onClick={episode.shots.length ? onDesignVisuals : () => onStageChange("script")}
                    >
                        {!episode.shots.length ? t("returnAndExtract") : episode.reviewStatus === "visual_ready" ? t("updateVisualPlan") : t("confirmAndGenerate")}
                    </Button>
                }
            />
            {episode.shots.length ? (
                <div className="mt-2.5 space-y-2.5">
                    {episode.shots.map((shot) => {
                        const expanded = expandedShotIds.has(shot.id);
                        const dialogueCount = shot.utterances.filter((item) => item.type === "dialogue").length || shot.dialogue.split(/\n+/).filter((line) => line.trim()).length;
                        const sourcePreview = compactReviewText(shot.sourceText || shot.description || t("noSource"));
                        return (
                            <article key={shot.id} className="rounded-lg border border-border bg-background p-3">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="grid size-8 place-items-center rounded-md bg-muted text-xs font-semibold">{String(shot.order).padStart(2, "0")}</span>
                                    <Input variant="borderless" className="!min-w-0 !flex-1 !p-0 !font-semibold" value={shot.title} onChange={(event) => updateContentShot(shot.id, { title: event.target.value })} />
                                    <span className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/45 px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
                                        <span className="size-1.5 rounded-full bg-foreground/60" />
                                        {t("editableContent")}
                                    </span>
                                    <Button
                                        size="small"
                                        className="!h-8 !shrink-0 !rounded-md !border-border/80 !px-2 !text-xs"
                                        icon={<ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />}
                                        iconPosition="end"
                                        aria-expanded={expanded}
                                        onClick={() => toggleShot(shot.id)}
                                    >
                                        {expanded ? t("collapse") : t("expand")}
                                    </Button>
                                </div>
                                {expanded ? (
                                    <>
                                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
                                            <label className="block space-y-1.5 xl:col-span-2">
                                                <span className="text-xs font-medium text-muted-foreground">{t("source")}</span>
                                                <Input.TextArea value={shot.sourceText} onChange={(event) => updateContentShot(shot.id, { sourceText: event.target.value })} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={t("sourcePlaceholder")} />
                                            </label>
                                            <label className="block space-y-1.5">
                                                <span className="text-xs font-medium text-muted-foreground">{t("shotFacts")}</span>
                                                <Input.TextArea value={shot.description} onChange={(event) => updateContentShot(shot.id, { description: event.target.value })} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("shotFactsPlaceholder")} />
                                            </label>
                                            <label className="block space-y-1.5">
                                                <span className="text-xs font-medium text-muted-foreground">{t("shotBoundary")}</span>
                                                <Input.TextArea
                                                    value={shot.shotBoundary}
                                                    onChange={(event) => updateContentShot(shot.id, { shotBoundary: event.target.value })}
                                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                                    placeholder={t("shotBoundaryPlaceholder")}
                                                />
                                            </label>
                                            <div className="min-w-0">
                                                <DramaShotDialogueEditor projectId={project.id} episodeId={episode.id} shot={shot} />
                                            </div>
                                            <label className="block space-y-1.5">
                                                <span className="text-xs font-medium text-muted-foreground">{t("narration")}</span>
                                                <Input.TextArea
                                                    value={shot.narration}
                                                    onChange={(event) => updateContentShot(shot.id, { narration: event.target.value, subtitle: [shot.dialogue, event.target.value].filter(Boolean).join("\n") })}
                                                    autoSize={{ minRows: 2, maxRows: 5 }}
                                                    placeholder={t("narrationPlaceholder")}
                                                />
                                            </label>
                                        </div>
                                        <div className="mt-3 grid grid-cols-[auto_72px_auto] items-center gap-2 text-sm text-muted-foreground sm:grid-cols-[auto_88px_auto_minmax(0,1fr)]">
                                            <span className="whitespace-nowrap">{t("shotDuration")}</span>
                                            <DramaDurationField className="w-[72px] sm:w-[88px]" ariaLabel={t("shotDuration")} value={shot.duration} parameters={videoParameters} onChange={(duration) => updateContentShot(shot.id, { duration })} />
                                            <span>{t("secondUnit")}</span>
                                            <span className="hidden min-w-0 text-right text-xs sm:block">{t("visualPromptNotice")}</span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                                        <span className="min-w-0 max-w-full truncate">{t("sourcePreview", { source: sourcePreview })}</span>
                                        <span>{dialogueCount ? t("dialogueLines", { count: dialogueCount }) : t("noDialogue")}</span>
                                        <span>{t("seconds", { count: shot.duration })}</span>
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="mt-2.5 flex min-h-14 items-center rounded-lg border border-dashed border-border bg-card/25 px-3 py-2.5">
                    <div className="min-w-0">
                        <h3 className="text-sm font-medium">{t("emptyTitle")}</h3>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t("emptyDescription")}</p>
                    </div>
                </div>
            )}
            <Modal title={t("episodeInfo")} open={episodeInfoOpen} width={620} centered destroyOnHidden footer={null} onCancel={() => setEpisodeInfoOpen(false)} styles={{ container: { maxWidth: "calc(100vw - 24px)" } }}>
                <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    {[
                        [t("info.outline"), "outline", t("info.outlinePlaceholder")],
                        [t("info.sourceRange"), "sourceRange", t("info.sourceRangePlaceholder")],
                        [t("info.hook"), "hook", t("info.hookPlaceholder")],
                        [t("info.nextPreview"), "nextPreview", t("info.nextPreviewPlaceholder")],
                    ].map(([label, key, placeholder]) => (
                        <label key={key} className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">{label}</span>
                            <Input.TextArea
                                value={episode[key as "outline" | "sourceRange" | "hook" | "nextPreview"]}
                                onChange={(event) => updateEpisode(project.id, episode.id, { [key]: event.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                placeholder={placeholder}
                            />
                        </label>
                    ))}
                </div>
            </Modal>
        </div>
    );
}

function compactReviewText(value: string) {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}
