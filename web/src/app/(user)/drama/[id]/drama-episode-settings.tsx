"use client";

import { Input, Select } from "antd";
import { useTranslations } from "next-intl";

import type { DramaEpisode, DramaProject } from "../types";
import { useDramaStore } from "../stores/use-drama-store";

export function DramaEpisodeSettings({ project, episode, embedded = false }: { project: DramaProject; episode: DramaEpisode; embedded?: boolean }) {
    const t = useTranslations("drama.editor.episodeSettings");
    const updateProject = useDramaStore((state) => state.updateProject);
    const updateEpisode = useDramaStore((state) => state.updateEpisode);
    const paragraphCount = episode.script.trim() ? episode.script.split(/\n+/).filter(Boolean).length : 0;
    const characterCount = new Set(episode.shots.flatMap((shot) => shot.characterIds)).size;
    const duration = episode.shots.reduce((total, shot) => total + (Number.isFinite(shot.duration) ? shot.duration : 0), 0);
    return (
        <aside className={`hide-scrollbar min-h-0 min-w-0 overflow-y-auto bg-card ${embedded ? "max-h-[min(620px,calc(100vh-150px))] p-1" : "border-l border-border p-3"}`} data-drama-episode-settings>
            {!embedded ? (
                <>
                    <h3 className="text-sm font-semibold">{t("title")}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("autoSave")}</p>
                </>
            ) : null}
            <div className={`${embedded ? "space-y-3" : "mt-4 space-y-4"}`}>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("episodeName")}</span>
                    <Input className="!h-8" value={episode.title} onChange={(event) => updateEpisode(project.id, episode.id, { title: event.target.value })} />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("storySummary")}</span>
                    <Input.TextArea value={project.summary} onChange={(event) => updateProject(project.id, { summary: event.target.value })} autoSize={{ minRows: 3, maxRows: 6 }} />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("visualStyle")}</span>
                    <Input className="!h-8" value={project.style} placeholder={t("visualStylePlaceholder")} onChange={(event) => updateProject(project.id, { style: event.target.value })} />
                </label>
                <div className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("videoMode")}</span>
                    <div className="min-w-0">
                        <Select
                            className="w-full"
                            value={project.defaultVideoMode}
                            options={[
                                { label: t("videoModes.storyboard"), value: "storyboard" },
                                { label: t("videoModes.direct"), value: "direct" },
                                { label: t("videoModes.reference"), value: "reference" },
                            ]}
                            onChange={(value) => updateProject(project.id, { defaultVideoMode: value as DramaProject["defaultVideoMode"] })}
                        />
                    </div>
                </div>
            </div>
            <div className="mt-4 border-t border-border pt-3" data-drama-episode-overview>
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold">{t("overview")}</h4>
                    <span className="text-[10px] text-muted-foreground">{t("currentData")}</span>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Stat label={t("characters")} value={episode.script.length} />
                    <Stat label={t("paragraphs")} value={paragraphCount} />
                    <Stat label={t("scenesAndShots")} value={episode.shots.length} />
                    <Stat label={t("roles")} value={characterCount} />
                    {duration > 0 ? <Stat label={t("estimatedDuration")} value={t("seconds", { count: duration })} /> : null}
                </dl>
            </div>
        </aside>
    );
}

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</dd>
        </div>
    );
}
