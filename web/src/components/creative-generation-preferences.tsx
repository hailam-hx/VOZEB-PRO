"use client";

import { Button, Popover, Select } from "antd";
import { AudioLines, ChevronDown, ImageIcon, Lightbulb, Maximize2, Sparkles, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { audioFormatOptions, audioVoiceOptions } from "@/lib/audio-generation";
import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import { configuredCreativeGenerationOptions, creativeGenerationValueSupported, type CreativeGenerationCapabilityReason } from "@/lib/creative-generation-capabilities";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import { VOZEB_GENERATION_BATCH_OPTIONS, VOZEB_IMAGE_ASPECT_RATIOS, VOZEB_IMAGE_QUALITIES, VOZEB_VIDEO_ASPECT_RATIOS, VOZEB_VIDEO_DURATION_OPTIONS, VOZEB_VIDEO_REFERENCE_MODES, VOZEB_VIDEO_RESOLUTIONS } from "@/lib/generation-parameters";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";

import { creativeComposerPopoverOverflow, creativeComposerPopoverPanelMaxHeight, type CreativeComposerPopoverPlacement } from "./creative-composer-popover";
import { creativeComposerToolButtonClass } from "./creative-composer-styles";
import { CapabilityControlTooltip, PositiveNumberField, SuggestedPositiveIntegerField, SwitchPreference, VideoQualityField } from "./creative-generation-preference-fields";

export type MediaCapability = "image" | "video" | "audio";

export type CreativeGenerationPreferencePatch = {
    size?: string;
    quality?: string;
    count?: number;
    seconds?: number;
    generateAudio?: boolean;
    watermark?: boolean;
    referenceMode?: NonNullable<CreativeGenerationPreferences["video"]>["referenceMode"];
    firstFrameAssetId?: string;
    lastFrameAssetId?: string;
    voice?: string;
    format?: string;
    speed?: number;
};

const ratioDimensions = {
    "21:9": { width: 26, height: 11 },
    "16:9": { width: 24, height: 14 },
    "4:3": { width: 21, height: 16 },
    "3:2": { width: 23, height: 15 },
    "2:3": { width: 15, height: 23 },
    "1:1": { width: 18, height: 18 },
    "3:4": { width: 16, height: 21 },
    "9:16": { width: 14, height: 24 },
} as const;
const imageRatios = [{ value: "auto", label: "auto", width: 18, height: 18 }, ...VOZEB_IMAGE_ASPECT_RATIOS.map((value) => ({ value, label: value, ...ratioDimensions[value] }))] as const;
const videoRatios = [{ value: "auto", label: "auto", width: 18, height: 18 }, ...VOZEB_VIDEO_ASPECT_RATIOS.map((value) => ({ value, label: value, ...ratioDimensions[value] }))] as const;
const imageQualityOptions = [{ value: "auto", label: "auto", shortLabel: "auto" }, ...VOZEB_IMAGE_QUALITIES.map((value) => ({ value, label: value, shortLabel: value }))] as const;
const videoResolutionLabels = { "480": "480P", "720": "720P", "1080": "1080P", "2k": "2K", "4k": "4K" } as const;
const videoQualityOptions = [{ value: "auto", label: "auto", shortLabel: "auto" }, ...VOZEB_VIDEO_RESOLUTIONS.map((value) => ({ value, label: videoResolutionLabels[value], shortLabel: videoResolutionLabels[value] }))] as const;
const generationOptionValues = VOZEB_GENERATION_BATCH_OPTIONS;
const videoDurationValues = VOZEB_VIDEO_DURATION_OPTIONS;
const videoReferenceModeValues = VOZEB_VIDEO_REFERENCE_MODES;

export function CreativeGenerationPreferences({
    capability,
    capabilities = [capability],
    preferences,
    triggerLabel,
    triggerIcon,
    triggerAriaLabel,
    triggerClassName,
    triggerLabelClassName,
    panelClassName,
    placement = "topLeft",
    autoAdjustOverflow,
    fixedSizeLabel,
    compact = false,
    showCount = true,
    videoReferenceContent,
    extraContent,
    generationParameters,
    capabilityReason = "unconfigured",
    showCustomVideoResolution = true,
    onOpenChange,
    onCapabilityChange,
    onChange,
}: {
    capability: MediaCapability;
    capabilities?: readonly MediaCapability[];
    preferences: CreativeGenerationPreferences;
    triggerLabel?: string;
    triggerIcon?: ReactNode;
    triggerAriaLabel?: string;
    triggerClassName?: string | ((open: boolean) => string);
    triggerLabelClassName?: string;
    panelClassName?: string;
    placement?: CreativeComposerPopoverPlacement;
    autoAdjustOverflow?: boolean;
    fixedSizeLabel?: string;
    compact?: boolean;
    showCount?: boolean;
    videoReferenceContent?: ReactNode;
    extraContent?: ReactNode;
    generationParameters?: LogicalModelGenerationParameters;
    capabilityReason?: CreativeGenerationCapabilityReason;
    showCustomVideoResolution?: boolean;
    onOpenChange?: (open: boolean) => void;
    onCapabilityChange?: (capability: MediaCapability) => void;
    onChange: (patch: CreativeGenerationPreferencePatch) => void;
}) {
    const t = useTranslations("create");
    const [open, setOpen] = useState(false);
    const [panelMaxHeight, setPanelMaxHeight] = useState<number>();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const availableCapabilities = capabilities.length ? capabilities : [capability];
    const activeCapability = availableCapabilities.includes(capability) ? capability : availableCapabilities[0];
    const localizedSummary = useGenerationPreferenceSummary(activeCapability, preferences);
    const summary = triggerLabel || localizedSummary;
    const maximumPanelHeight = compact ? 440 : 520;

    const measurePanelHeight = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const visualViewport = window.visualViewport;
        const viewportTop = visualViewport?.offsetTop || 0;
        const viewportBottom = viewportTop + (visualViewport?.height || window.innerHeight);
        setPanelMaxHeight(creativeComposerPopoverPanelMaxHeight(placement, trigger.getBoundingClientRect(), { top: viewportTop, bottom: viewportBottom }, maximumPanelHeight));
    }, [maximumPanelHeight, placement]);

    useEffect(() => {
        if (!open) return;
        const visualViewport = window.visualViewport;
        window.addEventListener("resize", measurePanelHeight);
        visualViewport?.addEventListener("resize", measurePanelHeight);
        return () => {
            window.removeEventListener("resize", measurePanelHeight);
            visualViewport?.removeEventListener("resize", measurePanelHeight);
        };
    }, [measurePanelHeight, open]);

    return (
        <Popover
            trigger="click"
            placement={placement}
            autoAdjustOverflow={autoAdjustOverflow ?? creativeComposerPopoverOverflow(placement)}
            arrow={false}
            open={open}
            onOpenChange={(nextOpen) => {
                if (nextOpen) measurePanelHeight();
                setOpen(nextOpen);
                onOpenChange?.(nextOpen);
            }}
            styles={{ container: { padding: compact ? 6 : 8, borderRadius: compact ? 14 : 16 } }}
            content={
                <div
                    data-canvas-no-drag
                    data-creative-generation-preferences
                    className={cn("hide-scrollbar min-w-0 max-w-[calc(100vw-32px)] overflow-x-hidden overflow-y-auto overscroll-contain", compact ? "w-[316px]" : "w-[360px]", panelClassName)}
                    style={{ maxHeight: panelMaxHeight === undefined ? `min(${maximumPanelHeight}px, calc(100dvh - 96px))` : panelMaxHeight }}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                >
                    {availableCapabilities.length > 1 ? (
                        <div
                            className={cn(
                                compact ? "mb-1.5 grid gap-1 rounded-lg bg-[#f1f3f5] p-0.5 dark:bg-[#252a31]" : "mb-2 grid gap-1 rounded-lg bg-[#f1f3f5] p-0.5 dark:bg-[#252a31]",
                                availableCapabilities.length === 2 ? "grid-cols-2" : "grid-cols-3",
                            )}
                        >
                            {availableCapabilities.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    className={cn(
                                        "inline-flex items-center justify-center gap-1.5 rounded-[7px] text-[11px] font-medium transition",
                                        compact ? "h-7" : "h-8",
                                        activeCapability === item
                                            ? "bg-white text-[#20242a] shadow-sm dark:bg-[#343b44] dark:text-white"
                                            : "text-[#7b8591] hover:bg-white/60 hover:text-[#20242a] dark:text-[#8f99a5] dark:hover:bg-[#30363e] dark:hover:text-white",
                                    )}
                                    onClick={() => onCapabilityChange?.(item)}
                                    aria-pressed={activeCapability === item}
                                >
                                    <CreativeModeIcon mode={item} />
                                    {t(capabilityMessageKeys[item])}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <PreferencePanel
                        capability={activeCapability}
                        preferences={preferences}
                        fixedSizeLabel={fixedSizeLabel}
                        compact={compact}
                        showCount={showCount}
                        videoReferenceContent={videoReferenceContent}
                        extraContent={extraContent}
                        generationParameters={generationParameters}
                        capabilityReason={capabilityReason}
                        showCustomVideoResolution={showCustomVideoResolution}
                        onChange={onChange}
                    />
                </div>
            }
        >
            <Button
                ref={triggerRef}
                type="text"
                className={typeof triggerClassName === "function" ? triggerClassName(open) : triggerClassName || creativeComposerToolButtonClass(open)}
                icon={triggerIcon || <PreferenceSummaryIcon capability={activeCapability} preferences={preferences} />}
                aria-label={triggerAriaLabel || t("generationParametersSummary", { summary })}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <span className={cn("max-w-[132px] truncate text-xs font-medium sm:max-w-[176px]", triggerLabelClassName)}>{summary}</span>
                <ChevronDown className="size-3.5 shrink-0" />
            </Button>
        </Popover>
    );
}

function PreferencePanel({
    capability,
    preferences,
    fixedSizeLabel,
    compact,
    showCount,
    videoReferenceContent,
    extraContent,
    generationParameters,
    capabilityReason,
    showCustomVideoResolution,
    onChange,
}: {
    capability: MediaCapability;
    preferences: CreativeGenerationPreferences;
    fixedSizeLabel?: string;
    compact: boolean;
    showCount: boolean;
    videoReferenceContent?: ReactNode;
    extraContent?: ReactNode;
    generationParameters?: LogicalModelGenerationParameters;
    capabilityReason: CreativeGenerationCapabilityReason;
    showCustomVideoResolution: boolean;
    onChange: (patch: CreativeGenerationPreferencePatch) => void;
}) {
    const t = useTranslations("create");
    const configuredVideoSeconds = useConfigStore((state) => Number(state.config.videoSeconds));
    const disabledReason = t(capabilityReasonMessageKeys[capabilityReason]);
    const ratios = capability === "image" ? imageRatios : videoRatios;
    const sizeValues = configuredCreativeGenerationOptions(
        ratios.map((ratio) => ratio.value),
        [...(generationParameters?.aspectRatios || []), ...(generationParameters?.pixelSizes || [])],
    );
    const localizedRatios = sizeValues.map((value) => {
        const known = ratios.find((ratio) => ratio.value === value);
        const dimensions = parseSizeShape(value);
        return { value, label: value === "auto" ? t("smart") : formatSizeLabel(value), width: known?.width || dimensions.width, height: known?.height || dimensions.height };
    });
    const imageQualityValues = configuredCreativeGenerationOptions(
        imageQualityOptions.map((option) => option.value),
        generationParameters?.qualities,
    );
    const localizedImageQualityOptions = imageQualityValues.map((value) => {
        const known = imageQualityOptions.find((option) => option.value === value);
        return {
            value,
            label: known ? t(imageQualityMessageKeys[known.value].label) : value,
            shortLabel: known ? t(imageQualityMessageKeys[known.value].shortLabel) : value,
            supported: creativeGenerationValueSupported(generationParameters, "imageQuality", value),
        };
    });
    const videoQualityValues = configuredCreativeGenerationOptions(
        videoQualityOptions.map((option) => option.value),
        generationParameters?.resolutions,
    );
    const localizedVideoQualityOptions = videoQualityValues.map((value) => {
        const known = videoQualityOptions.find((option) => option.value === value);
        return {
            value,
            label: value === "auto" ? t("smartClarity") : known?.label || (/^\d+$/.test(value) ? `${value}P` : value),
            shortLabel: value === "auto" ? t("smart") : known?.shortLabel || value,
            supported: creativeGenerationValueSupported(generationParameters, "videoResolution", value),
        };
    });
    const presetVideoQualityOptions = localizedVideoQualityOptions.filter((option) => videoQualityOptions.some((preset) => preset.value === option.value));
    const customVideoQualityValues = localizedVideoQualityOptions.filter((option) => !videoQualityOptions.some((preset) => preset.value === option.value)).map((option) => option.value);
    const videoReferenceModeOptions = videoReferenceModeValues.map((value) => ({ value, label: t(videoReferenceModeMessageKeys[value]) }));
    const durationValues = configuredCreativeGenerationOptions(videoDurationValues.map(String), generationParameters?.durationMode === "discrete" ? generationParameters.durationSeconds.map(String) : undefined).map(Number);
    const videoDurationOptions = durationValues.map((value) => ({ value, label: t("secondsValue", { value }), supported: creativeGenerationValueSupported(generationParameters, "videoDuration", value) }));
    const selectedSize = capability === "image" ? preferences.image?.size || "auto" : preferences.video?.size || "auto";
    const selectedQuality = capability === "image" ? preferences.image?.quality || "auto" : preferences.video?.quality || "auto";
    const selectedCount = capability === "image" ? preferences.image?.count : preferences.video?.count;
    const defaultVideoSeconds = configuredVideoSeconds > 0 && creativeGenerationValueSupported(generationParameters, "videoDuration", configuredVideoSeconds) ? configuredVideoSeconds : undefined;
    const isCustomSizeSelected = Boolean(generationParameters?.supportsCustomSize && parseCustomDimensions(selectedSize) && !generationParameters.pixelSizes.includes(selectedSize));
    const [customEditorOpen, setCustomEditorOpen] = useState(isCustomSizeSelected);
    const [section, setSection] = useState<"canvas" | "output">("canvas");

    useEffect(() => {
        setCustomEditorOpen(isCustomSizeSelected);
    }, [capability, isCustomSizeSelected]);

    useEffect(() => {
        setSection("canvas");
    }, [capability]);

    if (capability === "audio") {
        const voiceValues = configuredCreativeGenerationOptions(["auto", ...audioVoiceOptions.map((option) => option.value)], generationParameters?.voices);
        const formatValues = configuredCreativeGenerationOptions(["auto", ...audioFormatOptions.map((option) => option.value)], generationParameters?.formats);
        return (
            <div className="grid grid-cols-2 gap-1.5">
                <PreferenceSelect
                    label={t("voice")}
                    ariaLabel={t("selectVoice")}
                    value={preferences.audio?.voice || "auto"}
                    options={voiceValues.map((value) => ({
                        value,
                        label: value === "auto" ? t("smart") : audioVoiceOptions.find((option) => option.value === value)?.label || value,
                        supported: creativeGenerationValueSupported(generationParameters, "audioVoice", value),
                    }))}
                    disabledReason={disabledReason}
                    onChange={(voice) => onChange({ voice: voice === "auto" ? undefined : voice })}
                />
                <PreferenceSelect
                    label={t("format")}
                    ariaLabel={t("selectAudioFormat")}
                    value={preferences.audio?.format || "auto"}
                    options={formatValues.map((value) => ({
                        value,
                        label: value === "auto" ? t("smart") : audioFormatOptions.find((option) => option.value === value)?.label || value,
                        supported: creativeGenerationValueSupported(generationParameters, "audioFormat", value),
                    }))}
                    disabledReason={disabledReason}
                    onChange={(format) => onChange({ format: format === "auto" ? undefined : format })}
                />
                <PositiveNumberField
                    className="col-span-2"
                    label={t("speechSpeed")}
                    ariaLabel={t("enterSpeechSpeed")}
                    value={preferences.audio?.speed}
                    suffix="x"
                    min={generationParameters?.speedRange?.min}
                    max={generationParameters?.speedRange?.max}
                    enabled={Boolean(generationParameters?.speedRange)}
                    disabledReason={disabledReason}
                    onChange={(speed) => onChange({ speed })}
                />
                {extraContent}
            </div>
        );
    }

    return (
        <div className={cn("grid min-w-0", compact ? "gap-2" : "gap-2.5")}>
            <div className={cn("grid grid-cols-2 gap-1 bg-[#f1f3f5] dark:bg-[#252a31]", compact ? "rounded-lg p-0.5" : "rounded-xl p-1")} role="tablist" aria-label={t("generationParameterGroups")}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={section === "canvas"}
                    className={cn(
                        compact ? "h-7 rounded-[7px] text-[11px] font-medium transition" : "h-8 rounded-lg text-[11px] font-medium transition",
                        section === "canvas" ? "bg-white text-[#20242a] shadow-sm dark:bg-[#343b44] dark:text-white" : "text-[#7b8591] hover:text-[#20242a] dark:text-[#8f99a5] dark:hover:text-white",
                    )}
                    onClick={() => setSection("canvas")}
                >
                    {t("visual")}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={section === "output"}
                    className={cn(
                        compact ? "h-7 rounded-[7px] text-[11px] font-medium transition" : "h-8 rounded-lg text-[11px] font-medium transition",
                        section === "output" ? "bg-white text-[#20242a] shadow-sm dark:bg-[#343b44] dark:text-white" : "text-[#7b8591] hover:text-[#20242a] dark:text-[#8f99a5] dark:hover:text-white",
                    )}
                    onClick={() => setSection("output")}
                >
                    {t("output")}
                </button>
            </div>

            {section === "canvas" ? (
                <div className={cn("grid min-w-0", compact ? "gap-2" : "gap-2.5")}>
                    {capability === "video" && videoReferenceContent ? (
                        videoReferenceContent
                    ) : capability === "video" ? (
                        <CompactOptionGroup
                            label={t("referenceMethod")}
                            ariaLabel={t("selectVideoReferenceMethod")}
                            value={preferences.video?.referenceMode || videoReferenceModeValues[0]}
                            options={videoReferenceModeOptions}
                            columns={3}
                            isSupported={(referenceMode) => creativeGenerationValueSupported(generationParameters, "videoReferenceMode", referenceMode)}
                            disabledReason={disabledReason}
                            onChange={(referenceMode) => onChange({ referenceMode })}
                        />
                    ) : null}
                    {fixedSizeLabel ? (
                        <div className="flex h-9 items-center justify-between rounded-lg bg-[#f5f6f7] px-3 text-[11px] dark:bg-[#24282e]">
                            <span className="font-medium text-[#7b8591] dark:text-[#98a2ae]">{t("size")}</span>
                            <span className="text-[#20242a] dark:text-white">{fixedSizeLabel}</span>
                        </div>
                    ) : (
                        <div className="grid min-w-0 gap-1.5">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{t("ratio")}</p>
                                <span className="text-[10px] text-[#a0a8b2] dark:text-[#707b88]">{selectedSize === "auto" ? t("smart") : formatSizeLabel(selectedSize)}</span>
                            </div>
                            <div className="grid min-w-0 grid-cols-4 gap-1">
                                {localizedRatios.map((ratio) => (
                                    <CapabilityControlTooltip
                                        key={ratio.value}
                                        reason={ratio.value !== "auto" && !creativeGenerationValueSupported(generationParameters, capability === "image" ? "imageSize" : "videoSize", ratio.value) ? disabledReason : undefined}
                                        className="w-full"
                                    >
                                        <button
                                            type="button"
                                            className={cn(
                                                "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40",
                                                compact ? "h-8" : "h-9",
                                                selectedSize === ratio.value
                                                    ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                                                    : "bg-[#f5f6f7] text-[#687481] hover:bg-[#edf0f2] hover:text-[#20242a] dark:bg-[#24282e] dark:text-[#a6afb9] dark:hover:bg-[#30363e] dark:hover:text-white",
                                            )}
                                            disabled={ratio.value !== "auto" && !creativeGenerationValueSupported(generationParameters, capability === "image" ? "imageSize" : "videoSize", ratio.value)}
                                            aria-disabled={ratio.value !== "auto" && !creativeGenerationValueSupported(generationParameters, capability === "image" ? "imageSize" : "videoSize", ratio.value)}
                                            onClick={() => onChange({ size: ratio.value === "auto" ? undefined : ratio.value })}
                                            aria-label={t("selectMediaRatio", { media: t(capabilityMessageKeys[capability]), ratio: ratio.label })}
                                            aria-pressed={selectedSize === ratio.value}
                                        >
                                            <span className="grid h-4 w-5 shrink-0 place-items-center">
                                                {ratio.value === "auto" ? <Sparkles className="size-3.5" /> : <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: ratio.width * 0.64, height: ratio.height * 0.64 }} />}
                                            </span>
                                            <span className="truncate">{ratio.label}</span>
                                        </button>
                                    </CapabilityControlTooltip>
                                ))}
                            </div>
                            <CapabilityControlTooltip reason={generationParameters?.supportsCustomSize ? undefined : disabledReason} className="w-full">
                                <button
                                    type="button"
                                    className={cn(
                                        "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40",
                                        customEditorOpen || isCustomSizeSelected
                                            ? "border-[#9bbdce] bg-[#f2f8fb] font-medium text-[#315d78] dark:border-[#557f96] dark:bg-[#20333d] dark:text-[#a8c8dc]"
                                            : "border-[#d8dde2] text-[#687481] hover:border-[#b8c3cc] hover:bg-[#f7f8f9] hover:text-[#20242a] dark:border-[#414953] dark:text-[#a6afb9] dark:hover:bg-[#24282e] dark:hover:text-white",
                                    )}
                                    disabled={!generationParameters?.supportsCustomSize}
                                    aria-disabled={!generationParameters?.supportsCustomSize}
                                    onClick={() => setCustomEditorOpen(true)}
                                    aria-label={t("openCustomPixelSize", { media: t(capabilityMessageKeys[capability]) })}
                                    aria-pressed={customEditorOpen || isCustomSizeSelected}
                                >
                                    <Maximize2 className="size-3.5" />
                                    {t("customPixelSize")}
                                </button>
                            </CapabilityControlTooltip>
                            {customEditorOpen ? <CustomMediaSizeEditor capability={capability} size={selectedSize} onChange={onChange} /> : null}
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid gap-2.5">
                    {capability === "video" ? (
                        <VideoQualityField
                            value={preferences.video?.quality}
                            options={presetVideoQualityOptions}
                            customOptions={customVideoQualityValues}
                            showCustom={showCustomVideoResolution}
                            disabledReason={disabledReason}
                            onChange={(quality) => onChange({ quality })}
                        />
                    ) : (
                        <CompactOptionGroup
                            label={t("imageQuality")}
                            ariaLabel={t("selectImageQuality")}
                            value={selectedQuality}
                            options={localizedImageQualityOptions}
                            isSupported={(quality) => quality === "auto" || creativeGenerationValueSupported(generationParameters, "imageQuality", quality)}
                            disabledReason={disabledReason}
                            onChange={(quality) => onChange({ quality: quality === "auto" ? undefined : quality })}
                        />
                    )}
                    {showCount ? (
                        <GenerationCountGroup
                            key={capability}
                            capability={capability}
                            value={selectedCount}
                            maxBatchSize={generationParameters?.maxBatchSize}
                            supportsCustomBatchSize={generationParameters?.supportsCustomBatchSize === true}
                            customBatchSizeRange={generationParameters?.customBatchSizeRange}
                            disabledReason={disabledReason}
                            onChange={(count) => onChange({ count })}
                        />
                    ) : null}
                    {capability === "video" ? (
                        <>
                            <SuggestedPositiveIntegerField
                                label={t("duration")}
                                ariaLabel={t("enterVideoDuration")}
                                value={preferences.video?.seconds ?? defaultVideoSeconds}
                                suffix={t("secondsUnit")}
                                options={videoDurationOptions}
                                min={generationParameters?.supportsCustomDuration ? generationParameters.customDurationRange?.min : generationParameters?.durationMode === "range" ? generationParameters.durationRange?.min : undefined}
                                max={generationParameters?.supportsCustomDuration ? generationParameters.customDurationRange?.max : generationParameters?.durationMode === "range" ? generationParameters.durationRange?.max : undefined}
                                customEnabled={generationParameters?.supportsCustomDuration === true || generationParameters?.durationMode === "range"}
                                disabledReason={disabledReason}
                                onChange={(seconds) => onChange({ seconds })}
                            />
                            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#e3e8ec] bg-[#fafbfc] p-2 dark:border-[#343b44] dark:bg-[#1f242a]">
                                <SwitchPreference label={t("generateAudio")} checked={preferences.video?.generateAudio ?? true} onChange={(generateAudio) => onChange({ generateAudio })} />
                                <SwitchPreference label={t("addWatermark")} checked={preferences.video?.watermark ?? false} onChange={(watermark) => onChange({ watermark })} />
                            </div>
                        </>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function CustomMediaSizeEditor({ capability, size, onChange }: { capability: Extract<MediaCapability, "image" | "video">; size: string; onChange: (patch: CreativeGenerationPreferencePatch) => void }) {
    const t = useTranslations("create");
    const dimensions = parseCustomDimensions(size);
    const [width, setWidth] = useState(dimensions?.[0] || "");
    const [height, setHeight] = useState(dimensions?.[1] || "");
    const [error, setError] = useState("");

    useEffect(() => {
        const next = parseCustomDimensions(size);
        setWidth(next?.[0] || "");
        setHeight(next?.[1] || "");
        setError("");
    }, [size]);

    const updateSize = (nextWidth: string, nextHeight: string) => {
        const normalizedWidth = normalizeDimension(nextWidth);
        const normalizedHeight = normalizeDimension(nextHeight);
        setError(nextWidth && nextHeight && (!normalizedWidth || !normalizedHeight) ? t("positiveDimensionsRequired") : "");
        if (normalizedWidth && normalizedHeight) onChange({ size: `${normalizedWidth}x${normalizedHeight}` });
    };
    const changeWidth = (value: string) => {
        setWidth(value);
        updateSize(value, height);
    };
    const changeHeight = (value: string) => {
        setHeight(value);
        updateSize(width, value);
    };
    return (
        <div className="grid min-w-0 max-w-full gap-1.5 rounded-xl border border-[#e3e8ec] bg-[#fafbfc] p-2 dark:border-[#343b44] dark:bg-[#1f242a]">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                <DimensionInput ariaLabel={t("customMediaWidth", { media: t(capabilityMessageKeys[capability]) })} placeholder={t("width")} value={width} onChange={changeWidth} />
                <span className="shrink-0 text-xs text-[#9aa4ae]">×</span>
                <DimensionInput ariaLabel={t("customMediaHeight", { media: t(capabilityMessageKeys[capability]) })} placeholder={t("height")} value={height} onChange={changeHeight} />
            </div>
            {error ? <p className="text-[10px] text-[#b85c5c] dark:text-[#e39a9a]">{error}</p> : null}
        </div>
    );
}

function GenerationCountGroup({
    capability,
    value,
    maxBatchSize,
    supportsCustomBatchSize,
    customBatchSizeRange,
    disabledReason,
    onChange,
}: {
    capability: Extract<MediaCapability, "image" | "video">;
    value?: number;
    maxBatchSize?: number;
    supportsCustomBatchSize: boolean;
    customBatchSizeRange?: { min: number; max: number };
    disabledReason: string;
    onChange: (value?: number) => void;
}) {
    const t = useTranslations("create");
    const generationCountOptions = generationOptionValues.map((optionValue) => ({ value: optionValue, label: t("itemCount", { count: optionValue }) }));
    const customSelected = value !== undefined && !generationOptionValues.includes(value as (typeof generationOptionValues)[number]);
    const customEnabled = supportsCustomBatchSize && Boolean(customBatchSizeRange);
    const [draft, setDraft] = useState(customSelected ? String(value) : "");
    const [error, setError] = useState("");
    const lastEmittedValueRef = useRef(value);

    useEffect(() => {
        if (value !== lastEmittedValueRef.current) setDraft(value !== undefined && value > generationOptionValues.length ? String(value) : "");
        setError("");
        lastEmittedValueRef.current = value;
    }, [value]);

    const changeDraft = (next: string) => {
        const normalized = next.replace(/[^0-9]/g, "");
        const count = normalizeGenerationCount(normalized);
        setDraft(normalized);
        const fixedAllowed = Boolean(count && generationOptionValues.includes(count as (typeof generationOptionValues)[number]) && maxBatchSize && count <= maxBatchSize);
        const customAllowed = Boolean(count && customBatchSizeRange && count >= customBatchSizeRange.min && count <= customBatchSizeRange.max);
        setError(normalized && !fixedAllowed && !customAllowed ? (customBatchSizeRange ? t("generationCountRange", customBatchSizeRange) : disabledReason) : "");
        if (count && (fixedAllowed || customAllowed)) {
            lastEmittedValueRef.current = count;
            onChange(count);
        }
    };

    return (
        <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{t("quantity")}</p>
            <div className="grid grid-cols-6 gap-1" role="group" aria-label={t("selectGenerationCount", { media: t(capabilityMessageKeys[capability]) })}>
                <button
                    type="button"
                    className={cn(
                        "h-8 min-w-0 rounded-lg px-1 text-[11px] transition",
                        value === undefined
                            ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                            : "bg-[#f5f6f7] text-[#687481] hover:bg-[#edf0f2] hover:text-[#20242a] dark:bg-[#24282e] dark:text-[#a6afb9] dark:hover:bg-[#30363e] dark:hover:text-white",
                    )}
                    onClick={() => onChange(undefined)}
                    aria-pressed={value === undefined}
                >
                    {t("smart")}
                </button>
                {generationCountOptions.map((option) => (
                    <CapabilityControlTooltip key={option.value} reason={maxBatchSize && option.value <= maxBatchSize ? undefined : disabledReason} className="w-full">
                        <button
                            type="button"
                            className={cn(
                                "h-8 min-w-0 flex-1 rounded-lg px-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40",
                                value === option.value
                                    ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                                    : "bg-[#f5f6f7] text-[#687481] hover:bg-[#edf0f2] hover:text-[#20242a] dark:bg-[#24282e] dark:text-[#a6afb9] dark:hover:bg-[#30363e] dark:hover:text-white",
                            )}
                            disabled={!maxBatchSize || option.value > maxBatchSize}
                            aria-disabled={!maxBatchSize || option.value > maxBatchSize}
                            onClick={() => {
                                setDraft("");
                                setError("");
                                lastEmittedValueRef.current = option.value;
                                onChange(option.value);
                            }}
                            aria-label={t("selectGenerationCountValue", { media: t(capabilityMessageKeys[capability]), count: option.value })}
                            aria-pressed={value === option.value}
                        >
                            {option.label}
                        </button>
                    </CapabilityControlTooltip>
                ))}
                <CapabilityControlTooltip reason={customEnabled ? undefined : disabledReason} className="w-full">
                    <label
                        className={cn(
                            "relative h-8 min-w-0 flex-1 rounded-lg text-sm transition",
                            customSelected
                                ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                                : "bg-[#f5f6f7] text-[#687481] focus-within:bg-[#f5f8fa] focus-within:text-[#315d78] focus-within:ring-1 focus-within:ring-[#9bbdce] focus-within:ring-inset hover:bg-[#edf0f2] dark:bg-[#24282e] dark:text-[#a6afb9] dark:focus-within:bg-[#222d34] dark:focus-within:text-[#a8c8dc] dark:focus-within:ring-[#557f96] dark:hover:bg-[#30363e]",
                        )}
                        title={t("customCountHint")}
                    >
                        <input
                            aria-label={t("customGenerationCount")}
                            aria-disabled={!customEnabled}
                            disabled={!customEnabled}
                            inputMode="numeric"
                            type="text"
                            value={draft}
                            onChange={(event) => changeDraft(event.target.value)}
                            placeholder={t("custom")}
                            className="size-full min-w-0 bg-transparent px-1 text-center font-medium outline-none placeholder:font-normal placeholder:text-current disabled:cursor-not-allowed disabled:opacity-40"
                        />
                        {draft ? <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] opacity-70">{t("itemUnit")}</span> : null}
                    </label>
                </CapabilityControlTooltip>
            </div>
            {error ? <p className="text-[10px] text-[#b85c5c] dark:text-[#e39a9a]">{error}</p> : null}
        </div>
    );
}

function DimensionInput({ ariaLabel, placeholder, value, onChange }: { ariaLabel: string; placeholder: string; value: string; onChange: (value: string) => void }) {
    return (
        <input
            aria-label={ariaLabel}
            inputMode="numeric"
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ""))}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[#dce2e7] bg-white px-2 text-center text-xs text-[#20242a] outline-none transition placeholder:text-[#aeb6be] focus:border-[#7da6ba] focus:ring-2 focus:ring-[#7da6ba]/15 dark:border-[#3e4650] dark:bg-[#181b20] dark:text-[#f3f5f7] dark:placeholder:text-[#697480]"
        />
    );
}

export function normalizeGenerationCount(value: string | number) {
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) return 0;
    const count = Number(normalized);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function CompactOptionGroup<T extends string | number>({
    label,
    ariaLabel,
    value,
    options,
    columns = 4,
    isSupported,
    disabledReason,
    onChange,
}: {
    label: string;
    ariaLabel: string;
    value: T;
    options: readonly { value: T; label: string; shortLabel?: string }[];
    columns?: 2 | 3 | 4;
    isSupported?: (value: T) => boolean;
    disabledReason?: string;
    onChange: (value: T) => void;
}) {
    return (
        <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{label}</p>
            <div className={cn("grid gap-1", columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-3" : "grid-cols-4")} role="group" aria-label={ariaLabel}>
                {options.map((option) => (
                    <CapabilityControlTooltip key={option.value} reason={isSupported && !isSupported(option.value) ? disabledReason : undefined} className="w-full">
                        <button
                            type="button"
                            className={cn(
                                "h-8 min-w-0 flex-1 rounded-lg px-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40",
                                value === option.value
                                    ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                                    : "bg-[#f5f6f7] text-[#687481] hover:bg-[#edf0f2] hover:text-[#20242a] dark:bg-[#24282e] dark:text-[#a6afb9] dark:hover:bg-[#30363e] dark:hover:text-white",
                            )}
                            disabled={isSupported ? !isSupported(option.value) : false}
                            aria-disabled={isSupported ? !isSupported(option.value) : false}
                            onClick={() => onChange(option.value)}
                            aria-label={`${ariaLabel} ${option.label}`}
                            aria-pressed={value === option.value}
                        >
                            {option.shortLabel || option.label}
                        </button>
                    </CapabilityControlTooltip>
                ))}
            </div>
        </div>
    );
}

function PreferenceSelect<T extends string | number>({
    label,
    ariaLabel,
    value,
    options,
    disabledReason,
    onChange,
}: {
    label: string;
    ariaLabel: string;
    value: T;
    options: readonly { value: T; label: string; supported?: boolean }[];
    disabledReason?: string;
    onChange: (value: T) => void;
}) {
    return (
        <label className="grid min-w-0 gap-0.5 rounded-lg bg-[#f5f6f7] px-2 py-1 text-[10px] text-[#8b949f] dark:bg-[#24282e] dark:text-[#7f8996]">
            {label}
            <Select
                size="small"
                variant="borderless"
                virtual={false}
                className="w-full"
                value={value}
                options={options.map((option) => {
                    const disabled = option.value !== "auto" && option.supported === false;
                    return {
                        ...option,
                        disabled,
                        title: disabled ? disabledReason : undefined,
                        label: disabled ? (
                            <CapabilityControlTooltip reason={disabledReason} className="w-full">
                                <span aria-disabled="true">{option.label}</span>
                            </CapabilityControlTooltip>
                        ) : (
                            option.label
                        ),
                    };
                })}
                onChange={onChange}
                aria-label={ariaLabel}
            />
        </label>
    );
}

function PreferenceSummaryIcon({ capability, preferences }: { capability: MediaCapability; preferences: CreativeGenerationPreferences }) {
    if (capability === "audio") return <AudioLines className="size-4" />;
    const size = capability === "image" ? preferences.image?.size : preferences.video?.size;
    const ratio = (capability === "image" ? imageRatios : videoRatios).find((item) => item.value === size);
    const custom = parseCustomDimensions(size);
    if (custom) {
        return (
            <span className="grid size-4 place-items-center" aria-hidden="true">
                <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(8, Math.min(14, (Number(custom[0]) / Number(custom[1])) * 10)), height: Math.max(7, Math.min(14, (Number(custom[1]) / Number(custom[0])) * 10)) }} />
            </span>
        );
    }
    if (!ratio || ratio.value === "auto") return <Sparkles className="size-4" />;
    return (
        <span className="grid size-4 place-items-center" aria-hidden="true">
            <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(8, ratio.width * 0.55), height: Math.max(7, ratio.height * 0.55) }} />
        </span>
    );
}

export function generationPreferenceSummary(capability: MediaCapability, preferences: CreativeGenerationPreferences, copy: GenerationPreferenceSummaryCopy) {
    if (capability === "audio") {
        const voice = preferences.audio?.voice;
        const format = preferences.audio?.format;
        const audioParts = [
            voice ? audioVoiceOptions.find((option) => option.value === voice)?.label || voice : undefined,
            format ? audioFormatOptions.find((option) => option.value === format)?.label || format : undefined,
            preferences.audio?.speed ? `${preferences.audio.speed}x` : undefined,
        ].filter(Boolean);
        return audioParts.length ? audioParts.join(" · ") : copy.smartParameters;
    }
    const size = capability === "image" ? preferences.image?.size || "auto" : preferences.video?.size || "auto";
    const quality = capability === "image" ? preferences.image?.quality || "auto" : preferences.video?.quality || "auto";
    const count = capability === "image" ? preferences.image?.count : preferences.video?.count;
    const countLabel = count ? ` · ${copy.count(count, capability)}` : "";
    const sizeLabel = size === "auto" ? copy.smartRatio : formatSizeLabel(size);
    const qualityLabel = capability === "image" ? copy.imageQuality[quality] || quality : videoQualityLabel(quality, copy);
    const referenceMode = preferences.video?.referenceMode;
    const referenceLabel = capability === "video" && referenceMode ? copy.referenceMode[referenceMode] : undefined;
    if (capability === "image") return size === "auto" && quality === "auto" ? `${copy.smartParameters}${countLabel}` : `${sizeLabel} · ${qualityLabel}${countLabel}`;
    const videoParts = [
        size !== "auto" ? sizeLabel : undefined,
        quality !== "auto" ? qualityLabel : undefined,
        preferences.video?.seconds ? copy.seconds(preferences.video.seconds) : undefined,
        preferences.video?.generateAudio === true ? copy.withAudio : preferences.video?.generateAudio === false ? copy.withoutAudio : undefined,
        preferences.video?.watermark === true ? copy.withWatermark : preferences.video?.watermark === false ? copy.withoutWatermark : undefined,
        referenceLabel,
    ].filter(Boolean);
    return `${videoParts.length ? videoParts.join(" · ") : copy.smartParameters}${countLabel}`;
}

function videoQualityLabel(value: string, copy: GenerationPreferenceSummaryCopy) {
    const preset = value === "auto" ? copy.smartClarity : videoQualityOptions.find((item) => item.value === value)?.label;
    if (preset) return preset;
    return /^\d+$/.test(value) ? `${value}P` : value;
}

function parseCustomDimensions(value?: string) {
    const match = typeof value === "string" ? value.trim().match(/^(\d+)x(\d+)$/i) : null;
    if (!match || !normalizeDimension(match[1]) || !normalizeDimension(match[2])) return null;
    return [match[1], match[2]] as const;
}

function parseSizeShape(value: string) {
    const dimensions = parseCustomDimensions(value);
    if (dimensions) return scaledShape(Number(dimensions[0]), Number(dimensions[1]));
    const ratio = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    return ratio ? scaledShape(Number(ratio[1]), Number(ratio[2])) : { width: 18, height: 18 };
}

function scaledShape(width: number, height: number) {
    const ratio = width / height;
    return ratio >= 1 ? { width: 24, height: Math.max(10, 24 / ratio) } : { width: Math.max(10, 24 * ratio), height: 24 };
}

function normalizeDimension(value: string) {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return "";
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : "";
}

function formatSizeLabel(value: string) {
    const dimensions = parseCustomDimensions(value);
    return dimensions ? `${dimensions[0]}×${dimensions[1]}` : value;
}

export function CreativeModeIcon({ mode }: { mode: "agent" | MediaCapability }) {
    if (mode === "image") return <ImageIcon className="size-4" />;
    if (mode === "video") return <Video className="size-4" />;
    if (mode === "audio") return <AudioLines className="size-4" />;
    return <Lightbulb className="size-4" />;
}

export const creativeModeOptions = [{ value: "agent" }, { value: "image" }, { value: "video" }, { value: "audio" }] as const;

const capabilityMessageKeys = {
    image: "imageCapability",
    video: "videoCapability",
    audio: "audioCapability",
} as const;

const imageQualityMessageKeys = {
    auto: { label: "smartImageQuality", shortLabel: "smart" },
    high: { label: "highImageQuality", shortLabel: "high" },
    medium: { label: "mediumImageQuality", shortLabel: "medium" },
    low: { label: "lowImageQuality", shortLabel: "low" },
} as const;

const videoReferenceModeMessageKeys = {
    reference: "smartReference",
    first_frame: "firstFrame",
    first_last: "firstAndLastFrames",
} as const;

const capabilityReasonMessageKeys = {
    unconfigured: "generationCapabilityUnconfigured",
    unsupported: "generationCapabilityUnsupported",
    intersection: "generationCapabilityIntersection",
} as const;

export type GenerationPreferenceSummaryCopy = {
    smartParameters: string;
    smartRatio: string;
    smartClarity: string;
    withAudio: string;
    withoutAudio: string;
    withWatermark: string;
    withoutWatermark: string;
    imageQuality: Record<string, string>;
    referenceMode: Record<(typeof videoReferenceModeValues)[number], string>;
    seconds: (value: number) => string;
    count: (value: number, capability: MediaCapability) => string;
};

export function useGenerationPreferenceSummary(capability: MediaCapability, preferences: CreativeGenerationPreferences) {
    const t = useTranslations("create");
    return generationPreferenceSummary(capability, preferences, {
        smartParameters: t("smartParameters"),
        smartRatio: t("smartRatio"),
        smartClarity: t("smartClarity"),
        withAudio: t("withAudio"),
        withoutAudio: t("withoutAudio"),
        withWatermark: t("withWatermark"),
        withoutWatermark: t("withoutWatermark"),
        imageQuality: {
            auto: t("smartImageQuality"),
            high: t("highImageQuality"),
            medium: t("mediumImageQuality"),
            low: t("lowImageQuality"),
        },
        referenceMode: {
            reference: t("smartReference"),
            first_frame: t("firstFrame"),
            first_last: t("firstAndLastFrames"),
        },
        seconds: (value) => t("secondsCompact", { value }),
        count: (value, mediaCapability) => t(mediaCapability === "image" ? "imageCount" : "videoCount", { count: value }),
    });
}
