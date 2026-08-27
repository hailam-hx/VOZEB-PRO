import type { CreativeGenerationMode, CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";

export function shouldShowVideoFrameControls(creationMode: "agent" | CreativeGenerationMode, preferences: CreativeGenerationPreferences) {
    const effectiveMode = creationMode === "agent" ? preferences.mode : creationMode;
    return effectiveMode === "video" && preferences.video?.referenceMode !== undefined && preferences.video.referenceMode !== "reference";
}

export function applyAgentGenerationCapability(creationMode: "agent" | CreativeGenerationMode, capability: CreativeGenerationMode, preferences: CreativeGenerationPreferences) {
    const next = creationMode === "agent" ? { ...preferences, mode: capability } : preferences;
    if (capability !== "video" || (creationMode !== "agent" && creationMode !== "video") || next.video?.referenceMode) return next;
    const video = { ...next.video };
    delete video.firstFrameAssetId;
    delete video.lastFrameAssetId;
    return { ...next, video: { ...video, referenceMode: "reference" as const } };
}
