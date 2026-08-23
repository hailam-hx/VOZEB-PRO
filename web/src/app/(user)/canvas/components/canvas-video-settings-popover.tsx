"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CreativeGenerationPreferences, useGenerationPreferenceSummary, type CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import { useCreativeComposerPopoverPlacement, type CreativeComposerPopoverPlacement } from "@/components/creative-composer-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CreativeGenerationPreferences as GenerationPreferences } from "@/lib/creative-runtime-contract";
import { boolConfig } from "@/lib/seedance-video";
import type { AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

import type { CanvasNodeMetadata } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { normalizeCanvasVideoReferenceMode } from "../utils/canvas-video-references";
import { CanvasVideoReferenceSettings } from "./canvas-video-reference-settings";

type CanvasVideoSettingsPopoverProps = {
    config: AiConfig;
    metadata?: CanvasNodeMetadata;
    references: CanvasResourceReference[];
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMetadataChange: (patch: Partial<CanvasNodeMetadata>) => void;
    buttonClassName?: string;
    placement?: CreativeComposerPopoverPlacement;
};

export function CanvasVideoSettingsPopover({ config, metadata, references, onConfigChange, onMetadataChange, buttonClassName, placement = "topLeft" }: CanvasVideoSettingsPopoverProps) {
    const t = useTranslations("canvas");
    const createT = useTranslations("create");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const responsivePlacement = useCreativeComposerPopoverPlacement(placement);
    const preferences: GenerationPreferences = {
        mode: "video",
        video: {
            size: config.size || "auto",
            quality: config.vquality || "auto",
            seconds: positiveInteger(config.videoSeconds, 5),
            generateAudio: boolConfig(config.videoGenerateAudio, true),
            watermark: boolConfig(config.videoWatermark, false),
            referenceMode: normalizeCanvasVideoReferenceMode(metadata?.videoReferenceMode),
        },
    };
    const summary = canvasVideoPreferenceSummary(preferences, { autoSize: createT("smartRatio"), autoQuality: createT("smartClarity") });
    const fullSummary = useGenerationPreferenceSummary("video", preferences);
    const referenceLabel = t(`videoReferences.modes.${normalizeCanvasVideoReferenceMode(metadata?.videoReferenceMode)}.label`);

    return (
        <CreativeGenerationPreferences
            capability="video"
            preferences={preferences}
            triggerLabel={summary}
            triggerAriaLabel={t("videoSettingsAria", { summary: `${referenceLabel} · ${fullSummary}` })}
            triggerIcon={<SlidersHorizontal className="size-4" />}
            triggerClassName={buttonClassName}
            triggerLabelClassName="whitespace-nowrap text-left !overflow-visible !text-clip"
            placement={responsivePlacement}
            autoAdjustOverflow
            showCount={false}
            videoReferenceContent={<CanvasVideoReferenceSettings metadata={metadata} references={references} theme={theme} compact onChange={onMetadataChange} />}
            onChange={(patch) => applyVideoPreferencePatch(patch, onConfigChange)}
        />
    );
}

export function canvasVideoPreferenceSummary(preferences: GenerationPreferences, labels: { autoSize: string; autoQuality: string }) {
    const video = preferences.video;
    const size = !video?.size || video.size === "auto" ? labels.autoSize : video.size.replace("x", "×");
    if (/^\d+x\d+$/i.test(video?.size || "")) return size;
    const quality = !video?.quality || video.quality === "auto" ? labels.autoQuality : `${video.quality.replace(/p$/i, "")}P`;
    return `${size} · ${quality}`;
}

function applyVideoPreferencePatch(patch: CreativeGenerationPreferencePatch, onChange: (key: keyof AiConfig, value: string) => void) {
    if (patch.size !== undefined) onChange("size", patch.size);
    if (patch.quality !== undefined) onChange("vquality", patch.quality);
    if (patch.seconds !== undefined) onChange("videoSeconds", String(patch.seconds));
    if (patch.generateAudio !== undefined) onChange("videoGenerateAudio", String(patch.generateAudio));
    if (patch.watermark !== undefined) onChange("videoWatermark", String(patch.watermark));
}

function positiveInteger(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
