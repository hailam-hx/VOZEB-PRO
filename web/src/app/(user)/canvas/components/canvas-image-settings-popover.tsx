"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CreativeGenerationPreferences, useGenerationPreferenceSummary, type CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import type { CreativeGenerationPreferences as GenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";
import { useCreativeComposerPopoverPlacement, type CreativeComposerPopoverPlacement } from "@/components/creative-composer-popover";
import { resolveCanvasGenerationCapability } from "../utils/canvas-generation-capabilities";

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
    const capabilityState = resolveCanvasGenerationCapability(config, "image", config.model);
    const preferences: GenerationPreferences = {
        mode: "image",
        image: {
            ...(concreteText(config.size) ? { size: config.size } : {}),
            ...(concreteText(config.quality) ? { quality: config.quality } : {}),
            ...(positiveInteger(config.count) ? { count: positiveInteger(config.count) } : {}),
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
            generationParameters={capabilityState.parameters}
            capabilityReason={capabilityState.reason}
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
    if ("size" in patch) onChange("size", patch.size || "auto");
    if ("quality" in patch) onChange("quality", patch.quality || "auto");
    if ("count" in patch) onChange("count", patch.count === undefined ? "auto" : String(patch.count));
}

function positiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function concreteText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim()) && value.trim().toLowerCase() !== "auto";
}

function compactSizeLabel(value: string | undefined, autoLabel: string) {
    return !value || value === "auto" ? autoLabel : value.replace("x", "×");
}
