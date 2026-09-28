import { decimal } from "@/lib/billing/decimal";
import type { SystemAiVideoBillingContext } from "./system-ai-billing";
import type { VideoGenerationReference } from "@/lib/video-reference-contract";

export function trustedVideoBillingContext(references: readonly VideoGenerationReference[]): SystemAiVideoBillingContext {
    const videos = references.filter((reference) => reference.type === "video");
    if (!videos.length) return { hasReferenceVideo: false };
    const verified = videos.map((reference) => (reference.durationSource === "server-probed" && reference.trustedDurationMs ? reference.trustedDurationMs : undefined));
    if (verified.some((duration) => !Number.isSafeInteger(duration) || Number(duration) <= 0)) return { hasReferenceVideo: true };
    return {
        hasReferenceVideo: true,
        verifiedInputVideoDurationSeconds: (verified as number[]).reduce((total, duration) => total.plus(decimal(duration).dividedBy(decimal(1000))), decimal(0)).toString(),
        referenceVideoDurationSource: "server-probed",
    };
}
