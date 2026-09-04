"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCreativeComposerPopoverPlacement, type CreativeComposerPopoverPlacement } from "@/components/creative-composer-popover";
import { CreativeGenerationPreferences, useGenerationPreferenceSummary, type CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import type { CreativeGenerationPreferences as GenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";
import type { VoiceSelection } from "@/lib/voice-selection";

import { resolveCanvasGenerationCapability } from "../utils/canvas-generation-capabilities";

export type CanvasAudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type CanvasAudioSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: CanvasAudioSettingKey, value: string | VoiceSelection) => void;
    buttonClassName?: string;
    placement?: CreativeComposerPopoverPlacement;
};

export function CanvasAudioSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft" }: CanvasAudioSettingsPopoverProps) {
    const t = useTranslations("create.sharedSettings");
    const responsivePlacement = useCreativeComposerPopoverPlacement(placement);
    const capabilityState = resolveCanvasGenerationCapability(config, "audio", config.model);
    const preferences: GenerationPreferences = {
        mode: "audio",
        audio: {
            ...(config.audioVoice ? { voiceSelection: config.audioVoice } : {}),
            ...(concreteText(config.audioFormat) ? { format: config.audioFormat } : {}),
            ...(positiveNumber(config.audioSpeed) ? { speed: positiveNumber(config.audioSpeed) } : {}),
        },
    };
    const summary = useGenerationPreferenceSummary("audio", preferences);

    return (
        <CreativeGenerationPreferences
            capability="audio"
            preferences={preferences}
            triggerLabel={summary}
            triggerAriaLabel={t("generationParameters", { summary })}
            triggerIcon={<SlidersHorizontal className="size-4" />}
            triggerClassName={buttonClassName}
            triggerLabelClassName="whitespace-nowrap text-left !overflow-visible !text-clip"
            placement={responsivePlacement}
            autoAdjustOverflow
            generationParameters={capabilityState.parameters}
            capabilityReason={capabilityState.reason}
            extraContent={
                <label className="col-span-2 grid gap-1.5 text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">
                    {t("voiceInstructions")}
                    <textarea
                        value={config.audioInstructions || ""}
                        placeholder={t("voiceInstructionsPlaceholder")}
                        className="hide-scrollbar h-16 resize-none rounded-lg border border-[#dce2e7] bg-white px-2.5 py-2 text-xs font-normal text-[#20242a] outline-none dark:border-[#3e4650] dark:bg-[#181b20] dark:text-white"
                        onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                    />
                </label>
            }
            onChange={(patch) => applyAudioPreferencePatch(patch, onConfigChange)}
        />
    );
}

function applyAudioPreferencePatch(patch: CreativeGenerationPreferencePatch, onChange: (key: CanvasAudioSettingKey, value: string | VoiceSelection) => void) {
    if (patch.voiceSelection) onChange("audioVoice", patch.voiceSelection);
    if ("format" in patch) onChange("audioFormat", patch.format || "auto");
    if ("speed" in patch) onChange("audioSpeed", patch.speed === undefined ? "auto" : String(patch.speed));
}

function concreteText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim()) && value.trim().toLowerCase() !== "auto";
}

function positiveNumber(value: unknown) {
    if (typeof value === "string" && value.trim().toLowerCase() === "auto") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
