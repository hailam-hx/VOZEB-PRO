import type { ComponentProps } from "react";
import { Sparkles } from "lucide-react";
import type { LogicalModel } from "@/lib/auth/store";
import { decimal } from "@/lib/billing/decimal";
import { calculatePricingReserve, estimateVideoTokenCount, normalizeBillableUsage } from "@/lib/billing/pricing";
import { estimateSeedanceUsage, type SeedanceFrame } from "@/lib/billing/seedance-usage";

export const DEFAULT_MODEL_POINT_COST_KEY = "__default__";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Sparkles className="size-[1em]" strokeWidth={2.4} />
        </span>
    );
}

function modelName(value: string) {
    const separator = value.indexOf("::");
    return separator >= 0 ? value.slice(separator + 2) : value;
}

export function formatCreditAmount(value: number | string) {
    try {
        const [whole, fraction] = decimal(value).roundHalfUp(8).toString().split(".");
        const sign = whole.startsWith("-") ? "-" : "";
        const grouped = whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
    } catch {
        return "0";
    }
}

export function requestCreditCost(options: CreditCostRequest) {
    return tryRequestCreditCost(options) ?? "0";
}

export function tryRequestCreditCost(options: CreditCostRequest) {
    if (options.apiSource !== "system") return "0";
    const model = resolveLogicalModel(options.logicalModels, options.model);
    if (!model?.saleRateCard) return undefined;
    try {
        const count = positiveInteger(options.count) || "1";
        const resolution = options.resolution || (options.kind === "video" ? options.videoQuality : undefined);
        const billingBasis = options.kind === "video" ? (options.hasReferenceVideo ? ("with_video_input" as const) : ("default" as const)) : undefined;
        const videoTokenComponents = options.kind === "video" ? model.saleRateCard.components.filter((component) => component.dimension === "outputTokens" && component.when?.billingBasis) : [];
        if (
            videoTokenComponents.length &&
            (!resolution || !billingBasis || !videoTokenComponents.some((component) => component.when?.billingBasis === billingBasis && canonicalVideoResolution(component.when?.resolution) === canonicalVideoResolution(resolution)))
        )
            return undefined;
        const outputTokens = videoTokenComponents.length
            ? estimateVideoRequestTokens({
                  durationSeconds: options.videoSeconds,
                  resolution,
                  aspectRatio: options.videoAspectRatio,
                  hasReferenceVideo: options.hasReferenceVideo === true,
                  verifiedInputVideoDurationSeconds: options.verifiedInputVideoDurationSeconds,
                  safeVideoFrame: options.safeVideoFrame,
              })
            : undefined;
        if (videoTokenComponents.length && outputTokens === undefined) return undefined;
        const text = options.characters || "";
        const textLimits = model.bindings.flatMap((binding) => (binding.capabilityProfile?.maxOutputTokens ? [String(binding.capabilityProfile.maxOutputTokens)] : []));
        const maxOutputTokens = textLimits.reduce((maximum, value) => (BigInt(value) > BigInt(maximum) ? value : maximum), "0");
        const usage = normalizeBillableUsage({
            capability: options.kind === "api" ? "text" : options.kind || model.capability,
            source: "request",
            request: "1",
            inputTokens: model.capability === "text" ? String(new TextEncoder().encode(text).length) : undefined,
            cachedInputTokens: model.capability === "text" ? "0" : undefined,
            maxOutputTokens: model.capability === "text" && maxOutputTokens !== "0" ? maxOutputTokens : undefined,
            count,
            characters: options.characters === undefined ? undefined : String(Array.from(text).length),
            megapixels: megapixels(resolution, count),
            quality: options.quality,
            resolution,
            durationSeconds: options.videoSeconds,
            outputTokens,
            billingBasis,
            ...(options.kind === "video" ? { hasReferenceVideo: options.hasReferenceVideo === true } : {}),
            format: options.format,
        });
        return calculatePricingReserve({ rateCard: model.saleRateCard, usage }).credits;
    } catch {
        return undefined;
    }
}

type CreditCostRequest = { apiSource?: "system" | "custom"; logicalModels?: LogicalModel[]; model: string; count?: string | number } & {
    kind?: "image" | "video" | "text" | "audio" | "api";
    quality?: string;
    videoQuality?: string;
    videoSeconds?: string | number;
    videoAspectRatio?: string;
    hasReferenceVideo?: boolean;
    verifiedInputVideoDurationSeconds?: string;
    safeVideoFrame?: SeedanceFrame;
    resolution?: string;
    format?: string;
    characters?: string;
};

function resolveLogicalModel(models: LogicalModel[] | undefined, requested: string) {
    const normalized = modelName(requested).trim().toLowerCase();
    return models?.find((model) => model.id.toLowerCase() === normalized || model.bindings.some((binding) => modelName(binding.upstreamModel).trim().toLowerCase() === normalized));
}

function positiveInteger(value: string | number | undefined) {
    const normalized = String(value ?? "1").trim();
    return /^[1-9]\d*$/.test(normalized) ? normalized : undefined;
}

function megapixels(resolution: string | undefined, count: string) {
    const match = /^(\d+)x(\d+)$/i.exec(resolution || "");
    return match ? decimal(match[1]).times(decimal(match[2])).times(decimal(count)).dividedBy(decimal("1000000")).toString() : undefined;
}

function estimateVideoRequestTokens(input: { durationSeconds?: string | number; resolution?: string; aspectRatio?: string; hasReferenceVideo: boolean; verifiedInputVideoDurationSeconds?: string; safeVideoFrame?: SeedanceFrame }) {
    if (input.durationSeconds === undefined) return undefined;
    if (input.hasReferenceVideo) {
        if (!input.safeVideoFrame) return undefined;
        const estimate = estimateSeedanceUsage({
            outputDurationSeconds: input.durationSeconds,
            verifiedInputVideoDurationSeconds: input.verifiedInputVideoDurationSeconds,
            frame: input.safeVideoFrame,
            hasReferenceVideo: true,
            conservativeFrame: true,
        });
        return estimate.status === "REFERENCE_DURATION_UNKNOWN" ? undefined : estimate.tokens;
    }
    const edge = /^(480|720|1080)p?$/i.exec(input.resolution || "")?.[1];
    const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(input.aspectRatio || "");
    if (!edge || !ratio) return undefined;
    const horizontal = Number(ratio[1]);
    const vertical = Number(ratio[2]);
    const shortEdge = Number(edge);
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || horizontal <= 0 || vertical <= 0) return undefined;
    const dimensions = horizontal >= vertical ? { width: Math.ceil((shortEdge * horizontal) / vertical), height: shortEdge } : { width: shortEdge, height: Math.ceil((shortEdge * vertical) / horizontal) };
    return estimateVideoTokenCount({ outputDurationSeconds: input.durationSeconds, ...dimensions });
}

function canonicalVideoResolution(value: string | undefined) {
    const match = /^(480|720|1080)p?$/i.exec(value || "");
    return match ? `${match[1]}p` : value;
}
