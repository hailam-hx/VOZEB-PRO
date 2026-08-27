import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import { generationParametersCompatible, intersectGenerationParameters, type GenerationCompatibility, type NormalizedGenerationRequest, normalizeGenerationParameters, unionGenerationParameters } from "@/lib/generation-parameters";
import { normalizeDramaImageSize } from "@/lib/drama-image-size";
import type { AiConfig } from "@/stores/use-config-store";

type DramaDefaultModel = AiConfig["logicalModels"][number];
type DramaCapabilityField = Exclude<GenerationCompatibility, { compatible: true }>["field"];

export type DramaCapabilityFailure = { compatible: false; field: DramaCapabilityField; reason: string };
export type DramaCapabilityResult = { compatible: true } | DramaCapabilityFailure;

export type DramaGenerationCapabilities = {
    imageParameters?: LogicalModelGenerationParameters;
    videoParameters?: LogicalModelGenerationParameters;
    projectParameters?: LogicalModelGenerationParameters;
    imageBindings?: LogicalModelGenerationParameters[];
    videoBindings?: LogicalModelGenerationParameters[];
};

export function resolveDramaGenerationCapabilities(config: Pick<AiConfig, "imageModel" | "videoModel" | "logicalModels">): DramaGenerationCapabilities {
    const image = defaultModel(config.logicalModels, config.imageModel, "image");
    const video = defaultModel(config.logicalModels, config.videoModel, "video");
    const imageParameters = image ? unionGenerationParameters(image) : undefined;
    const videoParameters = video ? unionGenerationParameters(video) : undefined;
    return {
        imageParameters,
        videoParameters,
        projectParameters: image && video ? intersectGenerationParameters([image, video]) : undefined,
        imageBindings: image ? configuredBindings(image) : undefined,
        videoBindings: video ? configuredBindings(video) : undefined,
    };
}

export function checkDramaProjectSize(state: DramaGenerationCapabilities, size: string): DramaCapabilityResult {
    if (size.trim().toLowerCase() === "auto") return { compatible: true };
    if (!state.imageParameters || !state.videoParameters) return unconfigured();
    return check(state.projectParameters, sizeRequest(size), "project");
}

export function resolveDramaSmartProjectSize(state: DramaGenerationCapabilities, systemDefault: string) {
    if (checkDramaProjectSize(state, systemDefault).compatible) return normalizeDramaImageSize(systemDefault);
    return state.projectParameters?.aspectRatios[0] || state.projectParameters?.pixelSizes[0] || "auto";
}

export function checkDramaImageRequest(state: DramaGenerationCapabilities, input: { size: string; referenceCount?: number; quality?: string }): DramaCapabilityResult {
    return checkBindings(
        state.imageBindings,
        {
            ...sizeRequest(input.size),
            ...(input.referenceCount ? { referenceInputs: ["image"] as const, referenceCount: input.referenceCount } : {}),
            ...(concrete(input.quality) ? { quality: input.quality!.trim() } : {}),
            batchSize: 1,
        },
        "image",
    );
}

export function checkDramaDuration(state: DramaGenerationCapabilities, durationSeconds: number): DramaCapabilityResult {
    return check(state.videoParameters, { durationSeconds }, "video");
}

export function checkDramaVideoReferenceMode(state: DramaGenerationCapabilities, videoReferenceMode: "reference" | "first_frame" | "first_last"): DramaCapabilityResult {
    return check(state.videoParameters, { videoReferenceMode }, "video");
}

export function checkDramaVideoRequest(
    state: DramaGenerationCapabilities,
    input: {
        size: string;
        durationSeconds: number;
        referenceCount?: number;
        referenceMode?: "reference" | "first_frame" | "first_last";
        resolution?: string;
    },
): DramaCapabilityResult {
    return checkBindings(
        state.videoBindings,
        {
            ...sizeRequest(input.size),
            durationSeconds: input.durationSeconds,
            ...(input.referenceCount ? { referenceInputs: ["image"] as const, referenceCount: input.referenceCount } : {}),
            ...(input.referenceMode ? { videoReferenceMode: input.referenceMode } : {}),
            ...(concrete(input.resolution) ? { resolution: input.resolution!.trim() } : {}),
        },
        "video",
    );
}

export function queueDramaShotsAfterPreflight<T extends { id: string; failure?: DramaCapabilityFailure }>(shots: readonly T[], queue: () => void) {
    const blocked = shots.find((shot) => shot.failure);
    if (blocked?.failure) return { queued: false as const, shotId: blocked.id, failure: blocked.failure };
    queue();
    return { queued: true as const };
}

export function startDramaTaskAfterPreflight<T>(result: DramaCapabilityResult, start: () => T) {
    if (!result.compatible) return { started: false as const, failure: result };
    return { started: true as const, task: start() };
}

function defaultModel(models: DramaDefaultModel[], selected: string, capability: DramaDefaultModel["capability"]) {
    const id = normalizedModel(selected);
    return models.find((model) => model.enabled && model.capability === capability && normalizedModel(model.id) === id);
}

function normalizedModel(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}

function configuredBindings(model: DramaDefaultModel) {
    return model.bindings.flatMap((binding) => {
        const parameters = binding.enabled ? normalizeGenerationParameters(binding.generationParameters) : undefined;
        return parameters ? [parameters] : [];
    });
}

function sizeRequest(size: string): Pick<NormalizedGenerationRequest, "aspectRatio" | "pixelSize"> {
    const normalized = normalizeDramaImageSize(size);
    if (normalized === "auto") return {};
    if (/^\d+:\d+$/.test(normalized)) return { aspectRatio: normalized };
    return { pixelSize: normalized || size.trim() };
}

function checkBindings(bindings: LogicalModelGenerationParameters[] | undefined, request: NormalizedGenerationRequest, surface: "image" | "video"): DramaCapabilityResult {
    if (!bindings?.length) return unconfigured();
    const failures = bindings.map((parameters) => generationParametersCompatible(parameters, request));
    if (failures.some((result) => result.compatible)) return { compatible: true };
    const failure = failures.find((result): result is Exclude<GenerationCompatibility, { compatible: true }> => !result.compatible)!;
    return { ...failure, reason: failureReason(surface, failure.field) };
}

function check(parameters: LogicalModelGenerationParameters | undefined, request: NormalizedGenerationRequest, surface: "project" | "image" | "video"): DramaCapabilityResult {
    const result = generationParametersCompatible(parameters, request);
    if (result.compatible) return result;
    if (result.field === "generationParameters") return unconfigured();
    return { ...result, reason: failureReason(surface, result.field) };
}

function unconfigured(): DramaCapabilityFailure {
    return { compatible: false, field: "generationParameters", reason: "管理员尚未为该模型配置此能力" };
}

function failureReason(surface: "project" | "image" | "video", field: DramaCapabilityField) {
    if (surface === "project") return "默认图片模型和默认视频模型不共同支持该项目尺寸";
    const model = surface === "image" ? "默认图片模型" : "默认视频模型";
    const labels: Partial<Record<DramaCapabilityField, string>> = {
        aspectRatio: "当前生成比例",
        pixelSize: "当前生成尺寸",
        quality: "当前画质",
        resolution: "当前清晰度",
        durationSeconds: "当前镜头时长",
        batchSize: "当前生成数量",
        referenceInputs: "当前参考素材类型",
        referenceCount: "当前参考图数量",
        videoReferenceMode: "当前参考方式",
    };
    return `${model}不支持${labels[field] || "当前生成参数"}`;
}

function concrete(value: string | undefined) {
    const normalized = value?.trim().toLowerCase();
    return Boolean(normalized && normalized !== "auto");
}
