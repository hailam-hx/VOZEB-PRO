import { createHash } from "node:crypto";

import type { LogicalModelBinding } from "@/lib/auth/store-types";
import { decimal } from "@/lib/billing/decimal";
import { resolveSeedanceModelFamily } from "@/lib/billing/seedance-usage";
import { normalizeVideoResolution } from "@/lib/generation-parameters";
import type { VideoValidationNormalizedContext, VideoValidationReference } from "@/lib/video-validation";
import { estimateValidationCost } from "./video-validation-cost";

type ReferenceMode = "text" | "reference" | "first_frame" | "first_last";
type ContextResult =
    | { ok: true; bindingId: string; upstreamModelId: string; capabilityRevision: string; context: VideoValidationNormalizedContext; selectionReasons: string[] }
    | { ok: false; reasonCode: "CAPABILITY_INCOMPLETE" | "COST_NOT_ESTIMATABLE" | "BUDGET_BOUND_UNAVAILABLE" | "REFERENCE_CONTRACT_UNSUPPORTED" };

export function resolveMinimumVideoValidationContext(input: { binding: LogicalModelBinding; referenceMode: ReferenceMode; allowAutoResolution?: boolean; runtimeOptions?: { generateAudio?: boolean; watermark?: boolean } }): ContextResult {
    const profile = input.binding.generationParameters;
    const rateCard = input.binding.costRateCard;
    if (!profile || !rateCard) return { ok: false, reasonCode: "CAPABILITY_INCOMPLETE" };
    const duration = minimumDuration(profile);
    const aspectRatio = [...profile.aspectRatios].sort()[0];
    if (!duration || !aspectRatio) return { ok: false, reasonCode: "CAPABILITY_INCOMPLETE" };
    const references = resolveReferences(input.referenceMode, profile.videoReferenceModes);
    if (!references) return { ok: false, reasonCode: "REFERENCE_CONTRACT_UNSUPPORTED" };
    const autoResolution = input.allowAutoResolution && !profile.resolutions.length && rateCard.components.every((component) => !component.when?.resolution);
    const candidates = [...profile.resolutions, ...(autoResolution ? [""] : [])]
        .map((resolution) => (resolution ? normalizeVideoResolution(resolution) : ""))
        .filter((value): value is string => value !== undefined && value !== null)
        .map((resolution) => {
            const context: VideoValidationNormalizedContext = { count: "1", durationSeconds: String(duration), resolution: canonicalResolution(resolution), aspectRatio, generateAudio: false, watermark: false, references };
            return {
                context,
                cost: estimateValidationCost({ rateCard, context, providerPricingProfile: input.binding.providerPricingProfile, seedanceModelFamily: resolveSeedanceModelFamily(input.binding.upstreamModel), aspectRatios: profile.aspectRatios }),
            };
        })
        .filter((candidate): candidate is { context: VideoValidationNormalizedContext; cost: Extract<ReturnType<typeof estimateValidationCost>, { ok: true }> } => candidate.cost.ok)
        .sort((left, right) => compareDecimal(left.cost.estimatedCredits, right.cost.estimatedCredits) || left.context.resolution.localeCompare(right.context.resolution));
    const selected = candidates[0];
    if (!selected) {
        const hasUnbounded = profile.resolutions.some((resolution) => {
            const context: VideoValidationNormalizedContext = {
                count: "1",
                durationSeconds: String(duration),
                resolution: canonicalResolution(normalizeVideoResolution(resolution) || resolution),
                aspectRatio,
                generateAudio: false,
                watermark: false,
                references,
            };
            const estimate = estimateValidationCost({ rateCard, context, providerPricingProfile: input.binding.providerPricingProfile, seedanceModelFamily: resolveSeedanceModelFamily(input.binding.upstreamModel), aspectRatios: profile.aspectRatios });
            return !estimate.ok && estimate.reasonCode === "BUDGET_BOUND_UNAVAILABLE";
        });
        return { ok: false, reasonCode: hasUnbounded ? "BUDGET_BOUND_UNAVAILABLE" : "COST_NOT_ESTIMATABLE" };
    }
    return {
        ok: true,
        bindingId: input.binding.id,
        upstreamModelId: input.binding.upstreamModel,
        capabilityRevision: createHash("sha256").update(canonical(profile)).digest("hex"),
        context: selected.context,
        selectionReasons: ["MINIMUM_DURATION", "LOWEST_EXECUTABLE_PROVIDER_COST", ...(autoResolution ? ["PROVIDER_AUTO_RESOLUTION"] : []), "AUDIO_DISABLED", "WATERMARK_DISABLED"],
    };
}

function minimumDuration(profile: NonNullable<LogicalModelBinding["generationParameters"]>) {
    const candidates = [...profile.durationSeconds, profile.durationRange?.min, profile.customDurationRange?.min].filter((value): value is number => typeof value === "number" && value > 0);
    return candidates.length ? Math.min(...candidates) : undefined;
}

function resolveReferences(mode: ReferenceMode, supported: NonNullable<LogicalModelBinding["generationParameters"]>["videoReferenceModes"]): VideoValidationReference[] | undefined {
    if (mode === "text") return [];
    if (!supported.includes(mode === "reference" ? "reference" : mode)) return undefined;
    if (mode === "first_last")
        return [
            { role: "first_frame", fixture: "image" },
            { role: "last_frame", fixture: "image" },
        ];
    return [{ role: mode === "first_frame" ? "first_frame" : "reference", fixture: "image" }];
}

function canonicalResolution(value: string) {
    return /^\d+$/.test(value) ? `${value}p` : value;
}

function compareDecimal(left: string, right: string) {
    const a = decimal(left);
    const b = decimal(right);
    return a.greaterThan(b) ? 1 : b.greaterThan(a) ? -1 : 0;
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
