"use client";

import { Segmented } from "antd";
import { useTranslations } from "next-intl";

import { useDramaStore } from "../stores/use-drama-store";
import type { DramaShot, DramaShotAudioMode } from "../types";

export function DramaShotAudioModeEditor({ projectId, episodeId, shot }: { projectId: string; episodeId: string; shot: DramaShot }) {
    const t = useTranslations("drama.editor.audioMode");
    const updateShot = useDramaStore((state) => state.updateShot);
    const audioMode = shot.audioMode || "source";
    const audioActive = shot.audioStatus === "queued" || shot.audioStatus === "running";
    const changeMode = (value: string | number) => {
        const next = value as DramaShotAudioMode;
        updateShot(projectId, episodeId, shot.id, {
            audioMode: next,
            audioStatus: "idle",
            audioTaskId: undefined,
            audioError: undefined,
            audioUrl: undefined,
            generationStatus: shot.videoUrl ? shot.generationStatus : "idle",
        });
    };

    return (
        <div className="mt-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                <span className="text-sm font-medium">{t("title")}</span>
                <span className="text-xs text-muted-foreground">{t("description")}</span>
            </div>
            <div className="mt-2">
                <Segmented
                    block
                    disabled={audioActive}
                    aria-disabled={audioActive}
                    className="!min-w-0 !w-full [&_.ant-segmented-item]:!min-w-0 [&_.ant-segmented-item-label]:!truncate [&_.ant-segmented-item-label]:!px-1.5 sm:[&_.ant-segmented-item-label]:!px-3"
                    value={audioMode}
                    options={[
                        { label: t("source"), value: "source" },
                        { label: t("voiceover"), value: "voiceover" },
                        { label: t("mute"), value: "mute" },
                    ]}
                    onChange={changeMode}
                />
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t(`descriptions.${audioMode}`)}</p>
        </div>
    );
}
