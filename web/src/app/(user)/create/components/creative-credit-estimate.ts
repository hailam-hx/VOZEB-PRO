import { tryRequestCreditCost } from "@/constant/credits";
import { decimal } from "@/lib/billing/decimal";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";

import type { CreativeModelOption } from "./creative-generation-controls";

type EstimateConfig = Pick<AiConfig, "apiSource" | "size" | "quality" | "videoSeconds" | "vquality" | "audioFormat" | "logicalModels">;

export type CreativeCreditEstimate = { status: "planning" | "unavailable" } | { status: "ready"; credits: string };

export function estimateCreativeCredits({
    config,
    prompt,
    smartPlanning,
    selectedModels,
    preferences,
}: {
    config: EstimateConfig;
    prompt: string;
    smartPlanning: boolean;
    selectedModels: CreativeModelOption[];
    preferences: CreativeGenerationPreferences;
}): CreativeCreditEstimate {
    if (smartPlanning || !selectedModels.length) return { status: "planning" };
    let total = decimal(0);
    for (const model of selectedModels) {
        const copies = model.capability === "image" ? positiveInteger(preferences.image?.count) : model.capability === "video" ? positiveInteger(preferences.video?.count) : 1;
        const quality = model.capability === "image" ? preferences.image?.quality || config.quality : model.capability === "video" ? preferences.video?.quality || config.vquality : undefined;
        const credits = tryRequestCreditCost({
            apiSource: config.apiSource,
            logicalModels: config.logicalModels,
            model: model.id,
            kind: model.capability,
            count: 1,
            characters: prompt,
            quality,
            resolution: model.capability === "image" ? preferences.image?.size || config.size : undefined,
            videoQuality: model.capability === "video" ? quality : undefined,
            videoSeconds: model.capability === "video" ? preferences.video?.seconds || config.videoSeconds : undefined,
            format: model.capability === "audio" ? preferences.audio?.format || config.audioFormat : undefined,
        });
        if (credits === undefined) return { status: "unavailable" };
        total = total.plus(decimal(credits).times(decimal(copies)));
    }
    return { status: "ready", credits: total.toString() };
}

function positiveInteger(value: number | undefined) {
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 1;
}
