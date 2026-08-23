"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CreativeGenerationPreferences as GenerationPreferencesControl, type CreativeGenerationPreferencePatch, type MediaCapability } from "@/components/creative-generation-preferences";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import { cn } from "@/lib/utils";

type AgentMediaCapability = Extract<MediaCapability, "image" | "video">;

export function CompactAgentGenerationSettings({ preferences, onChange }: { preferences: CreativeGenerationPreferences; onChange: (preferences: CreativeGenerationPreferences) => void }) {
    const t = useTranslations("create.sharedSettings");
    const capability: AgentMediaCapability = preferences.mode === "video" ? "video" : "image";

    return (
        <GenerationPreferencesControl
            capability={capability}
            capabilities={["image", "video"]}
            preferences={preferences}
            triggerLabel={compactAgentPreferenceSummary(capability, preferences, t)}
            triggerAriaLabel={t("generationParameters", { summary: agentPreferenceSummary(capability, preferences, t) })}
            triggerIcon={<SlidersHorizontal className="size-4" />}
            triggerLabelClassName="min-w-0 flex-1 whitespace-nowrap text-left !overflow-visible !text-clip"
            panelClassName="!w-[280px]"
            triggerClassName={(open) =>
                cn(
                    "!h-9 !w-full !min-w-0 !max-w-[116px] !justify-start !gap-1.5 !rounded-lg !border !border-[#dce3e8] !bg-[#f7f9fa] !px-2 !text-[#54616d] !shadow-none hover:!border-[#cbd5dc] hover:!bg-[#f1f4f6] hover:!text-[#20242a] dark:!border-[#3b444d] dark:!bg-[#242a30] dark:!text-[#b5bec7] dark:hover:!border-[#4b5661] dark:hover:!bg-[#30363e] dark:hover:!text-white",
                    open && "!bg-[#eaf1f5] !text-[#315d78] dark:!bg-[#2a3b46] dark:!text-[#a8c8dc]",
                )
            }
            placement="top"
            compact
            onCapabilityChange={(next) => onChange({ ...preferences, mode: next })}
            onChange={(patch) => onChange(updateAgentGenerationPreferences(preferences, capability, patch))}
        />
    );
}

type SummaryTranslator = (key: string, values?: Record<string, string | number>) => string;

const defaultSummaryTranslator: SummaryTranslator = (key, values) => {
    const defaults: Record<string, string> = { smart: "Smart", smartParameters: "Smart parameters", high: "High", medium: "Medium", low: "Low" };
    if (key === "secondsCompact") return `${values?.value}s`;
    if (key === "imageCount") return `${values?.count} images`;
    return defaults[key] || key;
};

export function compactAgentPreferenceSummary(capability: AgentMediaCapability, preferences: CreativeGenerationPreferences, translate: SummaryTranslator = defaultSummaryTranslator) {
    if (capability === "video") {
        const video = preferences.video;
        const size = video?.size && video.size !== "auto" ? video.size.replace("x", "×") : translate("smart");
        return isExactSize(video?.size) ? size : `${size} · ${translate("secondsCompact", { value: video?.seconds || 5 })}`;
    }
    const image = preferences.image;
    const size = image?.size && image.size !== "auto" ? image.size.replace("x", "×") : translate("smart");
    return isExactSize(image?.size) ? size : `${size} · ${translate("imageCount", { count: image?.count || 1 })}`;
}

function agentPreferenceSummary(capability: AgentMediaCapability, preferences: CreativeGenerationPreferences, translate: SummaryTranslator) {
    if (capability === "video") {
        const video = preferences.video;
        const smart = translate("smart");
        const size = video?.size && video.size !== "auto" ? video.size.replace("x", "×") : smart;
        const quality = video?.quality && video.quality !== "auto" ? `${video.quality.replace(/p$/i, "")}P` : smart;
        return size === smart && quality === smart ? translate("smartParameters") : `${size} · ${quality} · ${translate("secondsCompact", { value: video?.seconds || 5 })}`;
    }
    const image = preferences.image;
    const smart = translate("smart");
    const size = image?.size && image.size !== "auto" ? image.size.replace("x", "×") : smart;
    const quality = translate(!image?.quality || image.quality === "auto" ? "smart" : image.quality);
    return size === smart && quality === smart && (image?.count || 1) === 1 ? translate("smartParameters") : `${size} · ${quality}${(image?.count || 1) > 1 ? ` · ${translate("imageCount", { count: image?.count || 1 })}` : ""}`;
}

export function updateAgentGenerationPreferences(preferences: CreativeGenerationPreferences, capability: AgentMediaCapability, patch: CreativeGenerationPreferencePatch): CreativeGenerationPreferences {
    if (capability === "image") {
        const image = { ...preferences.image };
        if (patch.size !== undefined) image.size = patch.size;
        if (patch.quality === "auto" || patch.quality === "high" || patch.quality === "medium" || patch.quality === "low") image.quality = patch.quality;
        if (patch.count !== undefined) image.count = patch.count;
        return { ...preferences, mode: "image", image };
    }
    const video = { ...preferences.video };
    if (patch.size !== undefined) video.size = patch.size;
    if (patch.quality !== undefined) video.quality = patch.quality;
    if (patch.count !== undefined) video.count = patch.count;
    if (patch.seconds !== undefined) video.seconds = patch.seconds;
    if (patch.generateAudio !== undefined) video.generateAudio = patch.generateAudio;
    if (patch.watermark !== undefined) video.watermark = patch.watermark;
    if (patch.referenceMode !== undefined) video.referenceMode = patch.referenceMode;
    return { ...preferences, mode: "video", video };
}

function isExactSize(value?: string) {
    return /^\d+x\d+$/i.test(value || "");
}
