import type { ComponentProps } from "react";
import { Sparkles } from "lucide-react";
import type { LogicalModel } from "@/lib/auth/store";
import { decimal } from "@/lib/billing/decimal";
import { calculatePricingReserve, normalizeBillableUsage } from "@/lib/billing/pricing";

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

export function requestCreditCost(options: { apiSource?: "system" | "custom"; logicalModels?: LogicalModel[]; model: string; count?: string | number } & CreditCostOptions) {
    if (options.apiSource !== "system") return "0";
    const model = resolveLogicalModel(options.logicalModels, options.model);
    if (!model?.saleRateCard) return "0";
    try {
        const count = positiveInteger(options.count) || "1";
        const resolution = options.resolution || (options.kind === "video" ? options.videoQuality : undefined);
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
            format: options.format,
        });
        return calculatePricingReserve({ rateCard: model.saleRateCard, usage }).credits;
    } catch {
        return "0";
    }
}

type CreditCostOptions = {
    kind?: "image" | "video" | "text" | "audio" | "api";
    quality?: string;
    videoQuality?: string;
    videoSeconds?: string | number;
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
