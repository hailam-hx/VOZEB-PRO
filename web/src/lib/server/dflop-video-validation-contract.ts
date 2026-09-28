import type { VideoContractCase } from "./video-validation-contract";

/** DFLOP's documented SKU-specific request contracts. These cases are not interchangeable with text-to-video. */
export function dflopVideoValidationContract(modelId: string): { caseId: VideoContractCase["id"]; requestBranch: string; allowAutoResolution?: boolean; blockedReason?: string } | null {
    const id = modelId
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
    // The public registry and https://model.dflop.top/docs/reference/models currently
    // quote materially different Grok prices. Neither is a proven conservative ceiling.
    if (id === "grok-imagine-video") return { caseId: "text-to-video", requestBranch: "grok-t2v", allowAutoResolution: true, blockedReason: "GROK_PRICING_SOURCE_CONFLICT" };
    if (id === "grok-imagine-video-1.5-preview") return { caseId: "image-to-video", requestBranch: "grok-i2v", allowAutoResolution: true, blockedReason: "GROK_PRICING_SOURCE_CONFLICT" };
    if (id === "dh-avatar") return { caseId: "avatar", requestBranch: "avatar-with-driver", blockedReason: "AVATAR_PRICING_SOURCE_CONFLICT" };
    if (["dh-lipsync", "dh-lipsync-pro", "dh-lipsync-max"].includes(id)) return { caseId: "lipsync", requestBranch: "video-with-driving-audio", blockedReason: "PUBLIC_VIDEO_AND_AUDIO_REQUIRED" };
    if (id === "dh-motion") return { caseId: "motion", requestBranch: "video-with-portraits", blockedReason: "PUBLIC_VIDEO_AND_PORTRAIT_REQUIRED" };
    if (id === "tvod-subtitle-soft") return { caseId: "subtitle-workflow", requestBranch: "subtitle-process", blockedReason: "SUBTITLE_RESULT_SCHEMA_UNVERIFIED" };
    if (id === "clip-compose") return { caseId: "clip-compose-workflow", requestBranch: "asr-then-compose", blockedReason: "ASR_PRICE_BOUND_UNVERIFIED" };
    return null;
}
