"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CreativeGenerationPreferences, useGenerationPreferenceSummary, type CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import { useCreativeComposerPopoverPlacement, type CreativeComposerPopoverPlacement } from "@/components/creative-composer-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CreativeGenerationPreferences as GenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

import type { CanvasNodeMetadata } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { resolveCanvasGenerationCapability } from "../utils/canvas-generation-capabilities";
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
    const capabilityState = resolveCanvasGenerationCapability(config, "video", config.model);
    const referenceMode = concreteReferenceMode(metadata?.videoReferenceMode);
    const preferences: GenerationPreferences = {
        mode: "video",
        video: {
            ...(concreteText(config.size) ? { size: config.size } : {}),
            ...(concreteText(config.vquality) ? { quality: config.vquality } : {}),
            ...(positiveNumber(config.videoSeconds) ? { seconds: positiveNumber(config.videoSeconds) } : {}),
            ...(concreteBoolean(config.videoGenerateAudio) !== undefined ? { generateAudio: concreteBoolean(config.videoGenerateAudio) } : {}),
            ...(concreteBoolean(config.videoWatermark) !== undefined ? { watermark: concreteBoolean(config.videoWatermark) } : {}),
            ...(referenceMode ? { referenceMode } : {}),
        },
    };
    const summary = canvasVideoPreferenceSummary(preferences, { autoSize: createT("smartRatio"), autoQuality: createT("smartClarity") });
    const fullSummary = useGenerationPreferenceSummary("video", preferences);
    const referenceLabel = referenceMode ? t(`videoReferences.modes.${referenceMode}.label`) : createT("smart");

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
            generationParameters={capabilityState.parameters}
            capabilityReason={capabilityState.reason}
            videoReferenceContent={<CanvasVideoReferenceSettings metadata={metadata} references={references} generationParameters={capabilityState.parameters} capabilityReason={capabilityState.reason} theme={theme} compact onChange={onMetadataChange} />}
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
    if ("size" in patch) onChange("size", patch.size || "auto");
    if ("quality" in patch) onChange("vquality", patch.quality || "auto");
    if ("seconds" in patch) onChange("videoSeconds", patch.seconds === undefined ? "auto" : String(patch.seconds));
    if ("generateAudio" in patch) onChange("videoGenerateAudio", patch.generateAudio === undefined ? "auto" : String(patch.generateAudio));
    if ("watermark" in patch) onChange("videoWatermark", patch.watermark === undefined ? "auto" : String(patch.watermark));
}

function positiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function concreteText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim()) && value.trim().toLowerCase() !== "auto";
}

function concreteBoolean(value: unknown) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return undefined;
}

function concreteReferenceMode(value: unknown) {
    return value === "reference" || value === "first_frame" || value === "first_last" ? value : undefined;
}
