import type { GenerationDefaultSettings, LogicalModel, LogicalModelCapability, LogicalModelGenerationParameters, SystemDefaultModels } from "@/lib/auth/store";
import { generationParametersCompatible, normalizeGenerationParameters, unionGenerationParameters } from "@/lib/generation-parameters";

export type GenerationParametersStatus = "unconfigured" | "incomplete" | "configured";

type GenerationDefaultsContext = Pick<{ logicalModels: LogicalModel[]; defaultModels: SystemDefaultModels; generationDefaults: GenerationDefaultSettings }, "logicalModels" | "defaultModels" | "generationDefaults">;

export function generationParametersStatus(capability: LogicalModelCapability, value: unknown): { state: GenerationParametersStatus; label: string } {
    const parameters = normalizeGenerationParameters(value);
    if (!parameters) return { state: "unconfigured", label: "能力档案未配置" };
    return profileComplete(capability, parameters) ? { state: "configured", label: "已配置" } : { state: "incomplete", label: "能力档案未完成" };
}

export function generationDefaultCapabilities(context: Pick<GenerationDefaultsContext, "logicalModels" | "defaultModels">) {
    const profile = (capability: LogicalModelCapability, modelId: string) => {
        const model = context.logicalModels.find((item) => item.capability === capability && item.id.toLowerCase() === modelId.toLowerCase());
        return model ? unionGenerationParameters(model) : undefined;
    };
    return {
        image: profile("image", context.defaultModels.imageModel),
        video: profile("video", context.defaultModels.videoModel),
        audio: profile("audio", context.defaultModels.audioModel),
    };
}

export function generationDefaultImageSizeOptions(context: Pick<GenerationDefaultsContext, "logicalModels" | "defaultModels">) {
    const capabilities = generationDefaultCapabilities(context);
    const profiles = [capabilities.image, capabilities.video].filter((profile): profile is LogicalModelGenerationParameters => Boolean(profile));
    const required = [context.defaultModels.imageModel, context.defaultModels.videoModel].filter(Boolean).length;
    if (!profiles.length || profiles.length !== required) return { options: [] as string[], supportsCustomSize: false };
    return {
        options: Array.from(new Set(profiles.flatMap((profile) => [...profile.aspectRatios, ...profile.pixelSizes]))).filter((value) => imageSizeCompatibleEvery(profiles, value)),
        supportsCustomSize: profiles.every((profile) => profile.supportsCustomSize),
    };
}

export function generationDefaultsValidationError(context: GenerationDefaultsContext, fields?: ReadonlyArray<keyof GenerationDefaultSettings>) {
    const defaults = context.generationDefaults;
    const capabilities = generationDefaultCapabilities(context);
    const includes = (field: keyof GenerationDefaultSettings) => !fields || fields.includes(field);
    if (includes("imageSize") && defaults.imageSize !== "auto") {
        const profiles = [capabilities.image, capabilities.video].filter((profile): profile is LogicalModelGenerationParameters => Boolean(profile));
        const requiredProfiles = [context.defaultModels.imageModel, context.defaultModels.videoModel].filter(Boolean).length;
        if (profiles.length !== requiredProfiles || !profiles.length || !profiles.every((profile) => imageSizeCompatible(profile, defaults.imageSize))) return "默认图片/视频比例不受当前默认模型支持";
    }
    if (includes("imageQuality") && defaults.imageQuality !== "auto" && !compatible(capabilities.image, { quality: defaults.imageQuality })) return "默认图片质量不受当前默认图片模型支持";
    if (includes("canvasImageCount") && defaults.canvasImageCount !== "auto" && !compatible(capabilities.image, { batchSize: defaults.canvasImageCount })) return "画布默认图片数量不受当前默认图片模型支持";
    if (includes("imageCount") && defaults.imageCount !== "auto" && !compatible(capabilities.image, { batchSize: defaults.imageCount })) return "默认图片数量不受当前默认图片模型支持";
    if (includes("videoQuality") && defaults.videoQuality !== "auto" && !compatible(capabilities.video, { resolution: defaults.videoQuality })) return "默认视频清晰度不受当前默认视频模型支持";
    if (includes("videoSeconds") && defaults.videoSeconds !== -1 && !compatible(capabilities.video, { durationSeconds: defaults.videoSeconds })) return "默认视频秒数不受当前默认视频模型支持";
    if (includes("audioVoice") && defaults.audioVoice !== "auto" && !compatible(capabilities.audio, { voice: defaults.audioVoice })) return "默认音频音色不受当前默认音频模型支持";
    if (includes("audioFormat") && defaults.audioFormat !== "auto" && !compatible(capabilities.audio, { format: defaults.audioFormat })) return "默认音频格式不受当前默认音频模型支持";
    return undefined;
}

export function resetIncompatibleGenerationDefaults(context: GenerationDefaultsContext): Pick<GenerationDefaultSettings, "canvasImageCount" | "imageCount" | "imageSize" | "imageQuality" | "videoQuality" | "videoSeconds" | "audioVoice" | "audioFormat"> {
    const defaults = context.generationDefaults;
    const capabilities = generationDefaultCapabilities(context);
    const imageProfiles = [capabilities.image, capabilities.video].filter((profile): profile is LogicalModelGenerationParameters => Boolean(profile));
    const requiredProfiles = [context.defaultModels.imageModel, context.defaultModels.videoModel].filter(Boolean).length;
    return {
        canvasImageCount: defaults.canvasImageCount === "auto" || compatible(capabilities.image, { batchSize: defaults.canvasImageCount }) ? defaults.canvasImageCount : "auto",
        imageCount: defaults.imageCount === "auto" || compatible(capabilities.image, { batchSize: defaults.imageCount }) ? defaults.imageCount : "auto",
        imageSize: defaults.imageSize === "auto" || (imageProfiles.length === requiredProfiles && imageProfiles.length > 0 && imageProfiles.every((profile) => imageSizeCompatible(profile, defaults.imageSize))) ? defaults.imageSize : "auto",
        imageQuality: defaults.imageQuality === "auto" || compatible(capabilities.image, { quality: defaults.imageQuality }) ? defaults.imageQuality : "auto",
        videoQuality: defaults.videoQuality === "auto" || compatible(capabilities.video, { resolution: defaults.videoQuality }) ? defaults.videoQuality : "auto",
        videoSeconds: defaults.videoSeconds === -1 || compatible(capabilities.video, { durationSeconds: defaults.videoSeconds }) ? defaults.videoSeconds : -1,
        audioVoice: defaults.audioVoice === "auto" || compatible(capabilities.audio, { voice: defaults.audioVoice }) ? defaults.audioVoice : "auto",
        audioFormat: defaults.audioFormat === "auto" || compatible(capabilities.audio, { format: defaults.audioFormat }) ? defaults.audioFormat : "auto",
    };
}

function profileComplete(capability: LogicalModelCapability, profile: LogicalModelGenerationParameters) {
    if (profile.supportsCustomBatchSize && !profile.customBatchSizeRange) return false;
    if (profile.supportsCustomDuration && !profile.customDurationRange) return false;
    const supportsSize = profile.aspectRatios.length > 0 || profile.pixelSizes.length > 0 || profile.supportsCustomSize;
    if (capability === "image") return supportsSize && profile.qualities.length > 0 && Boolean(profile.maxBatchSize);
    if (capability === "video") return supportsSize && profile.resolutions.length > 0 && Boolean(profile.durationMode && (profile.durationMode === "range" ? profile.durationRange : profile.durationSeconds.length)) && Boolean(profile.maxBatchSize);
    if (capability === "audio") return profile.voices.length > 0 && profile.formats.length > 0 && Boolean(profile.speedRange);
    return true;
}

function imageSizeCompatible(profile: LogicalModelGenerationParameters, value: string) {
    return value.includes(":") ? generationParametersCompatible(profile, { aspectRatio: value }).compatible : generationParametersCompatible(profile, { pixelSize: value }).compatible;
}

function imageSizeCompatibleEvery(profiles: LogicalModelGenerationParameters[], value: string) {
    return profiles.every((profile) => imageSizeCompatible(profile, value));
}

function compatible(profile: LogicalModelGenerationParameters | undefined, request: Parameters<typeof generationParametersCompatible>[1]) {
    return generationParametersCompatible(profile, request).compatible;
}
