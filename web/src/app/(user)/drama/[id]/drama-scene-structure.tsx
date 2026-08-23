"use client";

import { Button } from "antd";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DramaEpisode, DramaProject, DramaShot } from "../types";

export function DramaSceneStructure({
    project,
    episode,
    selectedShotId,
    onSelect,
    analyzing = false,
    onAnalyze,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    selectedShotId?: string;
    onSelect: (shot: DramaShot) => void;
    analyzing?: boolean;
    onAnalyze?: () => void;
}) {
    const t = useTranslations("drama.editor.sceneStructure");
    const sceneNames = new Map(project.scenes.map((scene) => [scene.id, scene.name]));
    return (
        <aside className="flex h-full min-h-0 min-w-0 flex-col bg-card" data-drama-scene-structure>
            <div className="shrink-0 border-b border-border px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-semibold">{t("title")}</h3>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{t("count", { count: episode.shots.length })}</p>
                    </div>
                </div>
            </div>
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                {episode.shots.length ? (
                    <div className="space-y-1">
                        {episode.shots.map((shot) => {
                            const active = shot.id === selectedShotId;
                            return (
                                <button
                                    key={shot.id}
                                    type="button"
                                    className={`w-full rounded-md border px-2.5 py-2 text-left transition ${active ? "border-violet-300 bg-violet-50/70 dark:border-violet-700/70 dark:bg-violet-950/25" : "border-transparent hover:border-border hover:bg-background"}`}
                                    onClick={() => onSelect(shot)}
                                    aria-current={active ? "true" : undefined}
                                >
                                    <span className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                                        <span className="tabular-nums">{t("sceneNumber", { number: String(shot.order).padStart(2, "0") })}</span>
                                        <span className="truncate">{sceneNames.get(shot.sceneId || "") || t("unassignedScene")}</span>
                                    </span>
                                    <span className="mt-1 block truncate text-xs font-medium text-foreground">{shot.title || t("untitledShot")}</span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-md bg-muted/25 p-3">
                        <div className="text-xs font-medium text-foreground">{t("emptyTitle")}</div>
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("emptyDescription")}</p>
                        {onAnalyze ? (
                            <Button className="!mt-2.5 !h-7 !px-2.5 !text-xs" size="small" icon={<Sparkles className="size-3" />} loading={analyzing} disabled={!episode.script.trim()} onClick={onAnalyze}>
                                {t("aiOrganize")}
                            </Button>
                        ) : null}
                    </div>
                )}
            </div>
        </aside>
    );
}
