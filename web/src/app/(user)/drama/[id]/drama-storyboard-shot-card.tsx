"use client";

import { Button, Input, Tag } from "antd";
import { ChevronDown, MessageSquareText, Volume1 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { CapabilityControlTooltip } from "@/components/creative-generation-preference-fields";

import { useDramaStore } from "../stores/use-drama-store";
import type { DramaProject, DramaShot } from "../types";
import { StoryboardTag } from "./drama-editor-elements";
import { DramaShotAudioModeEditor } from "./drama-shot-audio-mode-editor";
import { DramaShotContinuityEditor } from "./drama-shot-continuity-editor";
import { DramaShotDialogueEditor } from "./drama-shot-dialogue-editor";
import { DramaShotFrameEditor } from "./drama-shot-frame-editor";
import { DramaDurationField } from "./drama-duration-field";
import { checkDramaVideoReferenceMode, resolveDramaGenerationCapabilities } from "../drama-generation-capabilities";

const shotFieldClass = "!shadow-none hover:!border-foreground/25 focus:!border-foreground/35 focus:!shadow-none";

export function DramaStoryboardShotCard({ project, episodeId, shot, expanded, onToggle }: { project: DramaProject; episodeId: string; shot: DramaShot; expanded: boolean; onToggle: () => void }) {
    const t = useTranslations("drama.editor.storyboardCard");
    const updateShot = useDramaStore((state) => state.updateShot);
    const config = useEffectiveConfig();
    const generationCapabilities = resolveDramaGenerationCapabilities(config);
    const videoParameters = generationCapabilities.videoParameters;
    const dialogueLines = shot.dialogue
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const dialoguePreview = shot.utterances
        .filter((item) => item.type === "dialogue" && item.text.trim())
        .map((item) => `${item.speaker.trim() ? `${item.speaker.trim()}：` : ""}${item.text.trim()}`)
        .join(" / ");
    const speakers = [
        ...new Set(
            shot.utterances
                .filter((item) => item.type === "dialogue")
                .map((item) => item.speaker.trim())
                .filter(Boolean),
        ),
    ];

    return (
        <article
            className={`min-w-0 self-start overflow-hidden rounded-lg border border-border/80 bg-background/65 p-3 transition hover:border-foreground/15 hover:shadow-sm sm:p-4 [content-visibility:visible] sm:[content-visibility:auto] ${expanded ? "xl:col-span-2" : ""}`}
        >
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Input variant="borderless" className="!min-w-0 !w-full !p-0 !font-semibold" value={shot.title} onChange={(event) => updateShot(project.id, episodeId, shot.id, { title: event.target.value })} />
                <div className="flex shrink-0 items-center gap-1.5">
                    <StoryboardTag status={shot.storyboardStatus} />
                    <Tag className="!m-0">#{shot.order}</Tag>
                    <Button size="small" className="!h-8 !px-2.5" icon={<ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />} iconPosition="end" aria-expanded={expanded} onClick={onToggle}>
                        {expanded ? t("collapse") : t("expand")}
                    </Button>
                </div>
            </div>
            {expanded ? (
                <div className="mt-4">
                    <div className="rounded-md border border-border/75 bg-muted/20 p-2.5 sm:p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium">{t("shotContent")}</span>
                            {dialogueLines.length ? (
                                <span className="text-xs text-muted-foreground">{t("dialoguePreserved", { speakers: speakers.length ? `${speakers.join(", ")} · ` : "", count: dialogueLines.length })}</span>
                            ) : (
                                <span className="text-xs text-muted-foreground">{t("noExplicitDialogue")}</span>
                            )}
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <label className="block space-y-1.5 lg:col-span-2">
                                <span className="text-xs font-medium text-muted-foreground">{t("shotFacts")}</span>
                                <Input.TextArea
                                    className={shotFieldClass}
                                    value={shot.description}
                                    onChange={(event) => updateShot(project.id, episodeId, shot.id, { description: event.target.value })}
                                    autoSize={{ minRows: 1, maxRows: 3 }}
                                    placeholder={t("shotFactsPlaceholder")}
                                />
                            </label>
                            <div className="min-w-0">
                                <DramaShotDialogueEditor projectId={project.id} episodeId={episodeId} shot={shot} />
                            </div>
                            <label className="block space-y-1.5">
                                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <Volume1 className="size-3.5" />
                                    {t("narration")}
                                </span>
                                <Input.TextArea
                                    className={shotFieldClass}
                                    value={shot.narration}
                                    onChange={(event) => updateShot(project.id, episodeId, shot.id, { narration: event.target.value, subtitle: [shot.dialogue, event.target.value].filter(Boolean).join("\n") })}
                                    autoSize={{ minRows: 1, maxRows: 4 }}
                                    placeholder={t("narrationPlaceholder")}
                                />
                            </label>
                            <details className="rounded-md border border-border/60 bg-background/55 px-2.5 py-2 lg:col-span-2">
                                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t("viewSource")}</summary>
                                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{shot.sourceText || t("noSource")}</p>
                            </details>
                        </div>
                    </div>
                    <div className="mt-4 border-t border-border/70 pt-4">
                        <div className="grid gap-3.5 lg:grid-cols-2">
                            <label className="block space-y-1.5">
                                <span className="grid gap-0.5 text-sm font-medium sm:flex sm:items-baseline sm:gap-x-2">
                                    {t("imagePrompt")}
                                    <span className="text-xs font-normal text-muted-foreground">{t("imagePromptDescription")}</span>
                                </span>
                                <Input.TextArea
                                    className={shotFieldClass}
                                    value={shot.imagePrompt}
                                    onChange={(event) => updateShot(project.id, episodeId, shot.id, { imagePrompt: event.target.value })}
                                    autoSize={{ minRows: 2, maxRows: 5 }}
                                    placeholder={t("imagePromptPlaceholder")}
                                />
                            </label>
                            <label className="block space-y-1.5">
                                <span className="grid gap-0.5 text-sm font-medium sm:flex sm:items-baseline sm:gap-x-2">
                                    {t("videoPrompt")}
                                    <span className="text-xs font-normal text-muted-foreground">{t("videoPromptDescription")}</span>
                                </span>
                                <Input.TextArea
                                    className={shotFieldClass}
                                    value={shot.videoPrompt}
                                    onChange={(event) => updateShot(project.id, episodeId, shot.id, { videoPrompt: event.target.value })}
                                    autoSize={{ minRows: 2, maxRows: 5 }}
                                    placeholder={t("videoPromptPlaceholder")}
                                />
                            </label>
                            <label className="block space-y-1.5">
                                <span className="grid gap-0.5 text-sm font-medium sm:flex sm:items-baseline sm:gap-x-2">
                                    {t("cameraMotion")}
                                    <span className="text-xs font-normal text-muted-foreground">{t("cameraMotionDescription")}</span>
                                </span>
                                <Input className={shotFieldClass} value={shot.cameraMotion} onChange={(event) => updateShot(project.id, episodeId, shot.id, { cameraMotion: event.target.value })} placeholder={t("cameraMotionPlaceholder")} />
                            </label>
                            <label className="block space-y-1.5">
                                <span className="text-sm font-medium">{t("videoMode")}</span>
                                <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("videoMode")}>
                                    {(
                                        [
                                            { label: t("videoModes.storyboard"), value: "storyboard", capabilityMode: shot.storyboardFrameMode === "first_last" ? "first_last" : "first_frame" },
                                            { label: t("videoModes.direct"), value: "direct", capabilityMode: undefined },
                                            { label: t("videoModes.reference"), value: "reference", capabilityMode: "reference" },
                                        ] as const
                                    ).map((option) => {
                                        const compatibility = option.capabilityMode ? checkDramaVideoReferenceMode(generationCapabilities, option.capabilityMode) : ({ compatible: true } as const);
                                        const disabled = !compatibility.compatible;
                                        return (
                                            <CapabilityControlTooltip key={option.value} reason={disabled ? compatibility.reason : undefined} className="w-full">
                                                <button
                                                    type="button"
                                                    className={`h-8 w-full min-w-0 truncate rounded-md px-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${(shot.videoMode || project.defaultVideoMode) === option.value ? "bg-muted font-medium" : "hover:bg-muted/50"}`}
                                                    disabled={disabled}
                                                    aria-disabled={disabled}
                                                    aria-pressed={(shot.videoMode || project.defaultVideoMode) === option.value}
                                                    onClick={() => updateShot(project.id, episodeId, shot.id, { videoMode: option.value as DramaProject["defaultVideoMode"] })}
                                                >
                                                    {option.label}
                                                </button>
                                            </CapabilityControlTooltip>
                                        );
                                    })}
                                </div>
                            </label>
                        </div>
                        {(shot.videoMode || project.defaultVideoMode) === "storyboard" ? <DramaShotFrameEditor projectId={project.id} episodeId={episodeId} shot={shot} /> : null}
                        <DramaShotContinuityEditor projectId={project.id} episodeId={episodeId} shot={shot} />
                        {shot.storyboardError ? <p className="mt-2 text-xs text-red-500">{shot.storyboardError}</p> : null}
                        {shot.storyboardEndError ? <p className="mt-2 text-xs text-red-500">{shot.storyboardEndError}</p> : null}
                        <DramaShotAudioModeEditor projectId={project.id} episodeId={episodeId} shot={shot} />
                        <div className="mt-3.5 flex min-h-9 items-center gap-2.5 text-sm">
                            <span className="whitespace-nowrap">{t("duration")}</span>
                            <DramaDurationField className="w-24" ariaLabel={t("duration")} value={shot.duration} parameters={videoParameters} onChange={(duration) => updateShot(project.id, episodeId, shot.id, { duration })} />
                            <span>{t("seconds")}</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mt-2 space-y-1.5">
                    <p className="truncate text-xs leading-5 text-muted-foreground">{shot.description || shot.imagePrompt || shot.videoPrompt || t("noVisualPrompt")}</p>
                    {shot.dialogue ? (
                        <p className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-foreground/75">
                            <MessageSquareText className="mt-1 size-3.5 shrink-0" />
                            <span className="line-clamp-2 min-w-0">{t("dialoguePreview", { dialogue: dialoguePreview || shot.dialogue })}</span>
                        </p>
                    ) : null}
                    {shot.narration ? (
                        <p className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                            <Volume1 className="mt-1 size-3.5 shrink-0" />
                            <span className="line-clamp-2 min-w-0">{t("narrationPreview", { narration: shot.narration })}</span>
                        </p>
                    ) : null}
                </div>
            )}
        </article>
    );
}
