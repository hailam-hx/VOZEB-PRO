import { decimal } from "./decimal";
import { estimateVideoTokenCount } from "./pricing";

export type SeedanceModelFamily = "seedance-2.0" | "seedance-2.5";
export type SeedanceFrame = { width: string; height: string };

export type SeedanceEstimate =
    | { status: "REFERENCE_DURATION_UNKNOWN"; billingBasis: "with_video_input" }
    | {
          status: "ESTIMATED" | "CONSERVATIVE_ESTIMATE";
          billingBasis: "default" | "with_video_input";
          effectiveInputVideoDurationSeconds: string;
          tokens: string;
          frame: SeedanceFrame;
      };

export function estimateSeedanceUsage(input: { outputDurationSeconds: string | number; verifiedInputVideoDurationSeconds?: string | number; frame: SeedanceFrame; hasReferenceVideo: boolean; conservativeFrame?: boolean }): SeedanceEstimate {
    const billingBasis = input.hasReferenceVideo ? "with_video_input" : "default";
    if (input.hasReferenceVideo && !positiveDecimal(input.verifiedInputVideoDurationSeconds)) return { status: "REFERENCE_DURATION_UNKNOWN", billingBasis: "with_video_input" };
    const actualInput = decimal(input.verifiedInputVideoDurationSeconds ?? 0, "参考视频时长");
    const effectiveInput = input.hasReferenceVideo && decimal(4).greaterThan(actualInput) ? decimal(4) : actualInput;
    return {
        status: input.conservativeFrame ? "CONSERVATIVE_ESTIMATE" : "ESTIMATED",
        billingBasis,
        effectiveInputVideoDurationSeconds: effectiveInput.toString(),
        tokens: estimateVideoTokenCount({ outputDurationSeconds: input.outputDurationSeconds, inputDurationSeconds: effectiveInput.toString(), ...input.frame }),
        frame: input.frame,
    };
}

export function computeSeedanceHoldUsage(input: { family: SeedanceModelFamily; outputDurationSeconds: string | number; frame: SeedanceFrame; hasReferenceVideo: boolean }) {
    const holdInputVideoDurationSeconds = input.hasReferenceVideo ? (input.family === "seedance-2.5" ? "30" : "15") : "0";
    return {
        billingBasis: input.hasReferenceVideo ? ("with_video_input" as const) : ("default" as const),
        holdInputVideoDurationSeconds,
        tokens: estimateVideoTokenCount({ outputDurationSeconds: input.outputDurationSeconds, inputDurationSeconds: holdInputVideoDurationSeconds, ...input.frame }),
        frame: input.frame,
    };
}

export function resolveSeedanceModelFamily(model: string): SeedanceModelFamily | undefined {
    const normalized = model.trim().toLowerCase().replace(/[_.]/g, "-");
    if (/seedance-2-5(?:-|$)/.test(normalized)) return "seedance-2.5";
    if (/seedance-2-0(?:-|$)/.test(normalized)) return "seedance-2.0";
    return undefined;
}

export function seedanceFrameDimensions(resolution: string | undefined, aspectRatio: string | undefined, family?: SeedanceModelFamily): SeedanceFrame | undefined {
    const edge = /^(480|720|1080)p?$/i.exec(resolution || "")?.[1];
    const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio || "");
    if (!edge || !ratio) return undefined;
    const horizontal = decimal(ratio[1], "视频比例");
    const vertical = decimal(ratio[2], "视频比例");
    const shortEdge = decimal(edge, "视频清晰度");
    if (horizontal.isZero() || vertical.isZero()) return undefined;
    if (family === "seedance-2.0" && edge === "480" && horizontal.toString() === "16" && vertical.toString() === "9") return { width: "864", height: "496" };
    if (family === "seedance-2.0" && edge === "480" && horizontal.toString() === "9" && vertical.toString() === "16") return { width: "496", height: "864" };
    return horizontal.greaterThan(vertical) || horizontal.toString() === vertical.toString()
        ? { width: shortEdge.times(horizontal).dividedBy(vertical).ceilToDecimalPlaces(0).toString(), height: edge }
        : { width: edge, height: shortEdge.times(vertical).dividedBy(horizontal).ceilToDecimalPlaces(0).toString() };
}

export function safeSeedanceFrame(resolution: string | undefined, aspectRatios: readonly string[], family?: SeedanceModelFamily) {
    return aspectRatios
        .map((ratio) => seedanceFrameDimensions(resolution, ratio, family))
        .filter((frame): frame is SeedanceFrame => Boolean(frame))
        .sort((left, right) => {
            const leftPixels = BigInt(left.width) * BigInt(left.height);
            const rightPixels = BigInt(right.width) * BigInt(right.height);
            return leftPixels === rightPixels ? 0 : leftPixels > rightPixels ? -1 : 1;
        })[0];
}

function positiveDecimal(value: string | number | undefined) {
    if (value === undefined) return false;
    try {
        return decimal(value).greaterThan(decimal(0));
    } catch {
        return false;
    }
}
