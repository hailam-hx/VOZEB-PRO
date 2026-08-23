"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CreativeGenerationPreferences, useGenerationPreferenceSummary, type CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import type { CreativeGenerationPreferences as GenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";
import { useCreativeComposerPopoverPlacement, type CreativeComposerPopoverPlacement } from "@/components/creative-composer-popover";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: CreativeComposerPopoverPlacement;
    fixedSizeLabel?: string;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", fixedSizeLabel }: CanvasImageSettingsPopoverProps) {
    const t = useTranslations("canvas");
    const createT = useTranslations("create");
    const responsivePlacement = useCreativeComposerPopoverPlacement(placement);
    const preferences: GenerationPreferences = {
        mode: "image",
        image: {
            size: config.size || "auto",
            quality: imageQuality(config.quality),
            count: positiveInteger(config.count),
        },
    };
    const summary = canvasImagePreferenceSummary(preferences, fixedSizeLabel, {
        autoSize: createT("smartRatio"),
        quality: { auto: createT("smartImageQuality"), high: createT("high"), medium: createT("medium"), low: createT("low") },
        count: (count) => createT("imageCount", { count }),
    });
    const localizedSummary = useGenerationPreferenceSummary("image", preferences);
    const fullSummary = fixedSizeLabel ? summary : localizedSummary;

    return (
        <CreativeGenerationPreferences
            capability="image"
            preferences={preferences}
            triggerLabel={summary}
            triggerAriaLabel={t("imageSettingsAria", { summary: fullSummary })}
            triggerIcon={<SlidersHorizontal className="size-4" />}
            triggerClassName={buttonClassName}
            triggerLabelClassName="whitespace-nowrap text-left !overflow-visible !text-clip"
            placement={responsivePlacement}
            autoAdjustOverflow
            fixedSizeLabel={fixedSizeLabel}
            onOpenChange={onOpenChange}
            onChange={(patch) => applyImagePreferencePatch(patch, onConfigChange)}
        />
    );
}

export function canvasImagePreferenceSummary(preferences: GenerationPreferences, fixedSizeLabel: string | undefined, labels: { autoSize: string; quality: Record<string, string>; count: (count: number) => string }) {
    const image = preferences.image;
    const size = fixedSizeLabel || compactSizeLabel(image?.size, labels.autoSize);
    if (!fixedSizeLabel && /^\d+x\d+$/i.test(image?.size || "")) return size;
    const quality = labels.quality[image?.quality || "auto"] || image?.quality || labels.quality.auto;
    const count = image?.count || 1;
    return `${size} · ${quality}${count > 1 ? ` · ${labels.count(count)}` : ""}`;
}

function applyImagePreferencePatch(patch: CreativeGenerationPreferencePatch, onChange: (key: keyof AiConfig, value: string) => void) {
    if (patch.size !== undefined) onChange("size", patch.size);
    if (patch.quality !== undefined) onChange("quality", patch.quality);
    if (patch.count !== undefined) onChange("count", String(patch.count));
}

function imageQuality(value?: string): NonNullable<GenerationPreferences["image"]>["quality"] {
    return value === "high" || value === "medium" || value === "low" ? value : "auto";
}

function positiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function compactSizeLabel(value: string | undefined, autoLabel: string) {
    return !value || value === "auto" ? autoLabel : value.replace("x", "×");
}
