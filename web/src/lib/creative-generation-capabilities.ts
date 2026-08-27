import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import { generationParametersCompatible, intersectGenerationParameters, normalizeGenerationParameters, unionAvailableGenerationParameters } from "@/lib/generation-parameters";

export type CreativeGenerationCapabilityModel = {
    id: string;
    capability: "image" | "video" | "audio";
    generationParameters?: LogicalModelGenerationParameters;
};

export type CreativeGenerationCapabilityReason = "unconfigured" | "unsupported" | "intersection";

export type CreativeGenerationCapabilityState = {
    parameters?: LogicalModelGenerationParameters;
    reason: CreativeGenerationCapabilityReason;
};

export type CreativeReferenceInput = LogicalModelGenerationParameters["referenceInputs"][number];
export type CreativeReferenceAsset = { id?: string; type: CreativeReferenceInput | "text" };
export type CreativeReferenceCapabilityViolation = {
    reason: CreativeGenerationCapabilityReason;
    field: "input" | "count";
    type: CreativeReferenceInput;
    maxReferenceImages?: number;
};

export type CreativeGenerationField = "imageSize" | "imageQuality" | "imageCount" | "videoSize" | "videoResolution" | "videoDuration" | "videoCount" | "videoReferenceMode" | "audioVoice" | "audioFormat" | "audioSpeed";

export function resolveCreativeGenerationCapability({
    models,
    selectedModels,
    capability,
    smartPlanning,
}: {
    models: readonly CreativeGenerationCapabilityModel[];
    selectedModels: readonly CreativeGenerationCapabilityModel[];
    capability?: CreativeGenerationCapabilityModel["capability"];
    smartPlanning: boolean;
}): CreativeGenerationCapabilityState {
    const candidates = (smartPlanning ? models : selectedModels).filter((model) => !capability || model.capability === capability);
    const sources = candidates.map(profileSource);
    const configured = candidates.filter((model) => model.generationParameters !== undefined);
    if (!candidates.length || !configured.length || (!smartPlanning && configured.length !== candidates.length)) return { reason: "unconfigured" };
    if (smartPlanning) return { parameters: unionAvailableGenerationParameters(sources), reason: "unsupported" };
    if (candidates.length === 1) return { parameters: normalizeGenerationParameters(candidates[0].generationParameters), reason: "unsupported" };
    return { parameters: intersectGenerationParameters(sources), reason: "intersection" };
}

export function creativeGenerationValueSupported(parameters: LogicalModelGenerationParameters | undefined, field: CreativeGenerationField, value: unknown) {
    if (value === undefined || value === null || value === "" || (typeof value === "string" && value.trim().toLowerCase() === "auto")) return true;
    const profile = normalizeGenerationParameters(parameters);
    if (!profile) return false;
    switch (field) {
        case "imageSize":
        case "videoSize":
            return sizeSupported(profile, value);
        case "imageQuality":
            return typeof value === "string" && profile.qualities.includes(value.trim());
        case "videoResolution":
            return typeof value === "string" && profile.resolutions.includes(value.trim());
        case "imageCount":
        case "videoCount":
            return positiveInteger(value) && generationParametersCompatible(profile, { batchSize: Number(value) }).compatible;
        case "videoDuration":
            return durationSupported(profile, value);
        case "videoReferenceMode":
            return typeof value === "string" && profile.videoReferenceModes.includes(value as LogicalModelGenerationParameters["videoReferenceModes"][number]);
        case "audioVoice":
            return typeof value === "string" && profile.voices.includes(value.trim());
        case "audioFormat":
            return typeof value === "string" && profile.formats.includes(value.trim());
        case "audioSpeed": {
            const speed = Number(value);
            return Number.isFinite(speed) && speed > 0 && Boolean(profile.speedRange && speed >= profile.speedRange.min && speed <= profile.speedRange.max);
        }
    }
}

export function sanitizeCreativeGenerationPreferences(preferences: CreativeGenerationPreferences, capability: CreativeGenerationCapabilityModel["capability"], parameters: LogicalModelGenerationParameters | undefined) {
    if (capability === "image") {
        const image = preferences.image;
        if (!image) return preferences;
        return replacePreference(preferences, "image", {
            ...(creativeGenerationValueSupported(parameters, "imageSize", image.size) && concreteText(image.size) ? { size: image.size } : {}),
            ...(creativeGenerationValueSupported(parameters, "imageQuality", image.quality) && concreteText(image.quality) ? { quality: image.quality } : {}),
            ...(creativeGenerationValueSupported(parameters, "imageCount", image.count) && image.count !== undefined ? { count: image.count } : {}),
        });
    }
    if (capability === "audio") {
        const audio = preferences.audio;
        if (!audio) return preferences;
        return replacePreference(preferences, "audio", {
            ...(creativeGenerationValueSupported(parameters, "audioVoice", audio.voice) && concreteText(audio.voice) ? { voice: audio.voice } : {}),
            ...(creativeGenerationValueSupported(parameters, "audioFormat", audio.format) && concreteText(audio.format) ? { format: audio.format } : {}),
            ...(creativeGenerationValueSupported(parameters, "audioSpeed", audio.speed) && audio.speed !== undefined ? { speed: audio.speed } : {}),
        });
    }
    const video = preferences.video;
    if (!video) return preferences;
    const referenceMode = creativeGenerationValueSupported(parameters, "videoReferenceMode", video.referenceMode) && video.referenceMode ? video.referenceMode : undefined;
    return replacePreference(preferences, "video", {
        ...(creativeGenerationValueSupported(parameters, "videoSize", video.size) && concreteText(video.size) ? { size: video.size } : {}),
        ...(creativeGenerationValueSupported(parameters, "videoResolution", video.quality) && concreteText(video.quality) ? { quality: video.quality } : {}),
        ...(creativeGenerationValueSupported(parameters, "videoDuration", video.seconds) && video.seconds !== undefined ? { seconds: video.seconds } : {}),
        ...(creativeGenerationValueSupported(parameters, "videoCount", video.count) && video.count !== undefined ? { count: video.count } : {}),
        ...(video.generateAudio !== undefined ? { generateAudio: video.generateAudio } : {}),
        ...(video.watermark !== undefined ? { watermark: video.watermark } : {}),
        ...(referenceMode ? { referenceMode } : {}),
        ...(referenceMode === "first_frame" || referenceMode === "first_last" ? { firstFrameAssetId: video.firstFrameAssetId } : {}),
        ...(referenceMode === "first_last" ? { lastFrameAssetId: video.lastFrameAssetId } : {}),
    });
}

export function configuredCreativeGenerationOptions(known: readonly string[], configured: readonly string[] | undefined) {
    return Array.from(new Set([...known, ...(configured || [])]));
}

export function creativeReferenceAdditionAvailability(state: CreativeGenerationCapabilityState, selectedAssets: readonly CreativeReferenceAsset[], type: CreativeReferenceInput) {
    const profile = normalizeGenerationParameters(state.parameters);
    if (!profile || !profile.referenceInputs.includes(type)) return { supported: false as const, reason: state.reason, field: "input" as const };
    if (type !== "image") return { supported: true as const };
    const imageCount = selectedAssets.filter((asset) => asset.type === "image").length;
    if (profile.maxReferenceImages && imageCount < profile.maxReferenceImages) return { supported: true as const };
    return { supported: false as const, reason: state.reason, field: "count" as const, ...(profile.maxReferenceImages ? { maxReferenceImages: profile.maxReferenceImages } : {}) };
}

export function creativeReferenceCapabilityViolation(state: CreativeGenerationCapabilityState, selectedAssets: readonly CreativeReferenceAsset[]): CreativeReferenceCapabilityViolation | undefined {
    const profile = normalizeGenerationParameters(state.parameters);
    const unsupported = selectedAssets.find((asset): asset is CreativeReferenceAsset & { type: CreativeReferenceInput } => asset.type !== "text" && !profile?.referenceInputs.includes(asset.type));
    if (unsupported) return { reason: state.reason, field: "input", type: unsupported.type };
    const imageCount = selectedAssets.filter((asset) => asset.type === "image").length;
    if (imageCount && (!profile?.maxReferenceImages || imageCount > profile.maxReferenceImages)) {
        return { reason: state.reason, field: "count", type: "image", ...(profile?.maxReferenceImages ? { maxReferenceImages: profile.maxReferenceImages } : {}) };
    }
    return undefined;
}

export function creativeReferenceInputFromMimeType(value: string): CreativeReferenceInput | undefined {
    const type = value.trim().toLowerCase().split("/", 1)[0];
    return type === "image" || type === "video" || type === "audio" ? type : undefined;
}

function profileSource(model: CreativeGenerationCapabilityModel) {
    return { enabled: true, bindings: [{ enabled: true, generationParameters: model.generationParameters }] };
}

function replacePreference<K extends "image" | "video" | "audio">(preferences: CreativeGenerationPreferences, key: K, value: NonNullable<CreativeGenerationPreferences[K]>) {
    const next = { ...preferences };
    if (Object.values(value).some((item) => item !== undefined)) next[key] = value;
    else delete next[key];
    return next;
}

function sizeSupported(parameters: LogicalModelGenerationParameters, value: unknown) {
    if (typeof value !== "string") return false;
    const text = value.trim();
    const dimensions = normalizePixelSize(text);
    if (dimensions) return parameters.pixelSizes.includes(dimensions) || parameters.supportsCustomSize;
    return parameters.aspectRatios.includes(text);
}

function durationSupported(parameters: LogicalModelGenerationParameters, value: unknown) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 && generationParametersCompatible(parameters, { durationSeconds: seconds }).compatible;
}

function normalizePixelSize(value: string) {
    const match = value.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (!match) return "";
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? `${width}x${height}` : "";
}

function concreteText(value: unknown) {
    return typeof value === "string" && value.trim() && value.trim().toLowerCase() !== "auto";
}

function positiveInteger(value: unknown): value is number {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0;
}
