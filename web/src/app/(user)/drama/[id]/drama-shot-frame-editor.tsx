"use client";

import { App, Button, Image } from "antd";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CapabilityControlTooltip } from "@/components/creative-generation-preference-fields";
import { useEffectiveConfig } from "@/stores/use-config-store";

import { imagePreviewUrl } from "@/lib/media-image-url";
import { uploadImage } from "@/services/image-storage";
import { useDramaStore } from "../stores/use-drama-store";
import type { DramaShot } from "../types";
import { checkDramaVideoReferenceMode, resolveDramaGenerationCapabilities } from "../drama-generation-capabilities";

type FrameKind = "start" | "end";

export function DramaShotFrameEditor({ projectId, episodeId, shot }: { projectId: string; episodeId: string; shot: DramaShot }) {
    const t = useTranslations("drama.editor.frames");
    const { message } = App.useApp();
    const updateShot = useDramaStore((state) => state.updateShot);
    const generationCapabilities = resolveDramaGenerationCapabilities(useEffectiveConfig());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadTarget, setUploadTarget] = useState<FrameKind>("start");
    const [uploading, setUploading] = useState<FrameKind | "">("");
    const frameMode = shot.storyboardFrameMode || "single";
    const generationActive = [shot.storyboardStatus, shot.storyboardEndStatus, shot.generationStatus].some((status) => status === "queued" || status === "running");
    const firstLastCapability = checkDramaVideoReferenceMode(generationCapabilities, "first_last");
    const frameControlsDisabled = generationActive || (frameMode === "first_last" && !firstLastCapability.compatible);

    const chooseFile = (kind: FrameKind) => {
        setUploadTarget(kind);
        fileInputRef.current?.click();
    };
    const uploadFrame = async (file?: File) => {
        if (!file) return;
        setUploading(uploadTarget);
        try {
            const stored = await uploadImage(file);
            const url = stored.serverUrl || stored.url;
            updateShot(projectId, episodeId, shot.id, {
                ...(uploadTarget === "start"
                    ? { storyboardStatus: "success" as const, storyboardTaskId: undefined, storyboardError: undefined, storyboardImageUrl: url, storyboardImageWidth: stored.width, storyboardImageHeight: stored.height }
                    : {
                          storyboardFrameMode: "first_last" as const,
                          storyboardEndStatus: "success" as const,
                          storyboardEndTaskId: undefined,
                          storyboardEndError: undefined,
                          storyboardEndImageUrl: url,
                          storyboardEndImageWidth: stored.width,
                          storyboardEndImageHeight: stored.height,
                      }),
                ...clearedGeneratedMedia,
            });
            message.success(t("uploaded", { frame: t(uploadTarget) }));
        } catch {
            message.error(t("uploadFailed"));
        } finally {
            setUploading("");
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };
    const removeFrame = (kind: FrameKind) => {
        updateShot(projectId, episodeId, shot.id, {
            ...(kind === "start"
                ? { storyboardStatus: "idle" as const, storyboardImageUrl: undefined, storyboardImageWidth: undefined, storyboardImageHeight: undefined }
                : { storyboardEndStatus: "idle" as const, storyboardEndImageUrl: undefined, storyboardEndImageWidth: undefined, storyboardEndImageHeight: undefined }),
            ...clearedGeneratedMedia,
        });
    };

    return (
        <div className="mt-3.5 border-t border-border/70 pt-3.5">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-baseline gap-2">
                    <div className="shrink-0 text-sm font-semibold">{t("title")}</div>
                    <p className="min-w-0 truncate text-xs leading-5 text-muted-foreground">{t("description")}</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1" role="group" aria-label={t("title")}>
                    <button
                        type="button"
                        className={`h-7 rounded-md px-2 text-xs ${frameMode === "single" ? "bg-background font-medium" : "hover:bg-background/60"}`}
                        disabled={generationActive}
                        aria-pressed={frameMode === "single"}
                        onClick={() => updateShot(projectId, episodeId, shot.id, { storyboardFrameMode: "single", ...clearedGeneratedMedia })}
                    >
                        {t("single")}
                    </button>
                    <CapabilityControlTooltip reason={!firstLastCapability.compatible ? firstLastCapability.reason : undefined}>
                        <button
                            type="button"
                            className={`h-7 rounded-md px-2 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${frameMode === "first_last" ? "bg-background font-medium" : "hover:bg-background/60"}`}
                            disabled={generationActive || !firstLastCapability.compatible}
                            aria-disabled={generationActive || !firstLastCapability.compatible}
                            aria-pressed={frameMode === "first_last"}
                            onClick={() => updateShot(projectId, episodeId, shot.id, { storyboardFrameMode: "first_last", ...clearedGeneratedMedia })}
                        >
                            {t("firstLast")}
                        </button>
                    </CapabilityControlTooltip>
                </div>
            </div>
            <div className="mt-3 grid min-w-0 gap-2.5 sm:grid-cols-2">
                <FrameSlot title={t("start")} url={shot.storyboardImageUrl} loading={uploading === "start"} disabled={frameControlsDisabled} onUpload={() => chooseFile("start")} onRemove={() => removeFrame("start")} />
                {frameMode === "first_last" ? <FrameSlot title={t("end")} url={shot.storyboardEndImageUrl} loading={uploading === "end"} disabled={frameControlsDisabled} onUpload={() => chooseFile("end")} onRemove={() => removeFrame("end")} /> : null}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadFrame(event.target.files?.[0])} />
        </div>
    );
}

function FrameSlot({ title, url, loading, disabled, onUpload, onRemove }: { title: string; url?: string; loading: boolean; disabled: boolean; onUpload: () => void; onRemove: () => void }) {
    const t = useTranslations("drama.editor.frames");
    return (
        <div className="flex min-w-0 items-center gap-2.5 rounded-md border border-border/80 bg-muted/15 p-2">
            <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded border border-border/70 bg-background">
                {url ? (
                    <Image className="!size-full !object-cover" src={imagePreviewUrl(url, 640)} alt={title} preview={{ mask: t("view"), src: imagePreviewUrl(url, 1920) }} />
                ) : (
                    <button
                        type="button"
                        disabled={disabled}
                        className="grid size-full place-items-center text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={onUpload}
                        aria-label={t("uploadNamed", { title })}
                    >
                        <ImagePlus className="size-4.5" />
                    </button>
                )}
            </div>
            <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{title}</span>
                <div className="mt-1 flex items-center gap-0.5">
                    <Button type="text" size="small" className="!h-7 !px-1.5" loading={loading} disabled={disabled} icon={<Upload className="size-3.5" />} onClick={onUpload}>
                        {url ? t("replace") : t("upload")}
                    </Button>
                    {url ? <Button type="text" size="small" danger disabled={disabled} className="!size-7 !min-w-0 !p-0" aria-label={t("removeNamed", { title })} icon={<Trash2 className="size-3.5" />} onClick={onRemove} /> : null}
                </div>
            </div>
        </div>
    );
}

const clearedGeneratedMedia = {
    generationStatus: "idle" as const,
    generationTaskId: undefined,
    generationError: undefined,
    videoUrl: undefined,
    audioStatus: "idle" as const,
    audioTaskId: undefined,
    audioError: undefined,
    audioUrl: undefined,
};
