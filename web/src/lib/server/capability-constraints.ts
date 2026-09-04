import type { LogicalModelGenerationParameters } from "@/lib/auth/store";
import { generationParametersCompatible, type NormalizedGenerationRequest } from "@/lib/generation-parameters";

type GenerationCandidate = { id?: unknown; generationParameters?: unknown };
type GenerationReference = { type?: unknown; role?: unknown };

export function assertCapabilityConstraints(parameters: LogicalModelGenerationParameters | undefined, request: NormalizedGenerationRequest) {
    const compatibility = generationParametersCompatible(parameters, request);
    if (!compatibility.compatible) throw capabilityError(compatibility.field, request);
}

export function filterGenerationCandidates<T extends GenerationCandidate>(candidates: readonly T[], request: NormalizedGenerationRequest) {
    let error: Error | undefined;
    const compatible = candidates.filter((candidate) => {
        const compatibility = generationParametersCompatible(candidate.generationParameters as LogicalModelGenerationParameters | undefined, request);
        if (compatibility.compatible) return true;
        error ||= capabilityError(compatibility.field, request);
        return false;
    });
    return { candidates: compatible, error };
}

export function resolveImageGenerationCandidates<T extends GenerationCandidate>(
    candidates: readonly T[],
    config: Record<string, unknown>,
    defaults: { imageSize: string; imageQuality: string; imageCount?: number | "auto" },
    referenceCount: number,
    hasMask: boolean,
) {
    return resolveCandidates(candidates, (candidate) => {
        const parameters = candidate.generationParameters as LogicalModelGenerationParameters | undefined;
        const size = resolveSize(config.size, defaults.imageSize, parameters);
        const quality = resolveText(config.quality, defaults.imageQuality, parameters, parameters?.qualities, (value) => ({ quality: value }));
        const explicitCount = positiveInteger(config.count);
        const defaultCount = positiveInteger(defaults.imageCount);
        const count =
            explicitCount ||
            (defaultCount ? compatibleDefault(parameters, { batchSize: defaultCount }, defaultCount) : undefined) ||
            (parameters?.maxBatchSize ? 1 : parameters?.supportsCustomBatchSize ? positiveInteger(parameters.customBatchSizeRange?.min) : undefined);
        const resolved = { ...candidate, ...(size ? { size } : {}), ...(quality ? { quality } : {}), ...(count ? { count } : {}) };
        return { candidate: resolved, request: imageGenerationRequest(resolved as Record<string, unknown>, referenceCount, hasMask) };
    });
}

export function resolveAudioGenerationCandidates<T extends GenerationCandidate>(candidates: readonly T[], config: Record<string, unknown> | undefined, defaults: { audioVoice: string; audioFormat: string }) {
    return resolveCandidates(candidates, (candidate) => {
        const parameters = candidate.generationParameters as LogicalModelGenerationParameters | undefined;
        const selection = config?.voiceSelection && typeof config.voiceSelection === "object" ? (config.voiceSelection as Record<string, unknown>) : undefined;
        const voice = selection ? concreteText(config?.voice) : resolveText(config?.voice, defaults.audioVoice, parameters, parameters?.voices, (value) => ({ voice: value }));
        const format = resolveText(config?.format, defaults.audioFormat, parameters, parameters?.formats, (value) => ({ format: value }));
        const explicitSpeed = positiveNumber(config?.speed);
        const speedAllowed = parameters?.speedAppliesTo !== "cloned" || selection?.type === "profile";
        const speed = speedAllowed ? explicitSpeed || parameters?.speedRange?.min : undefined;
        const resolved = { ...candidate, ...(voice ? { voice } : {}), ...(format ? { format } : {}), ...(speed ? { speed: String(speed) } : {}) };
        return { candidate: resolved, request: audioGenerationRequest(resolved as Record<string, unknown>) };
    });
}

export function resolveVideoGenerationCandidates<T extends GenerationCandidate>(
    candidates: readonly T[],
    config: Record<string, unknown>,
    defaults: { imageSize: string; videoQuality: string; videoSeconds: number },
    references: readonly GenerationReference[],
) {
    return resolveCandidates(candidates, (candidate) => {
        const parameters = candidate.generationParameters as LogicalModelGenerationParameters | undefined;
        const size = resolveSize(config.size, defaults.imageSize, parameters);
        const vquality = resolveText(config.vquality, defaults.videoQuality, parameters, parameters?.resolutions, (value) => ({ resolution: value }));
        const explicitDuration = positiveNumber(config.videoSeconds);
        const videoSeconds =
            explicitDuration ||
            compatibleDefault(parameters, { durationSeconds: defaults.videoSeconds }, defaults.videoSeconds) ||
            (parameters?.durationMode === "discrete" ? parameters.durationSeconds[0] : parameters?.durationMode === "range" ? parameters.durationRange?.min : parameters?.supportsCustomDuration ? parameters.customDurationRange?.min : undefined);
        const count = positiveInteger(config.count);
        const generateAudio = concreteBoolean(config.videoGenerateAudio);
        const watermark = concreteBoolean(config.videoWatermark);
        const resolved = {
            ...candidate,
            ...(size ? { size } : {}),
            ...(vquality ? { vquality } : {}),
            ...(videoSeconds ? { videoSeconds } : {}),
            ...(count ? { count } : {}),
            ...(generateAudio !== undefined ? { videoGenerateAudio: generateAudio } : {}),
            ...(watermark !== undefined ? { videoWatermark: watermark } : {}),
        };
        return { candidate: resolved, request: videoGenerationRequest(resolved as Record<string, unknown>, references) };
    });
}

export function imageGenerationRequest(config: Record<string, unknown>, referenceCount: number, hasMask: boolean): NormalizedGenerationRequest {
    const count = Math.max(0, Math.floor(referenceCount)) + (hasMask ? 1 : 0);
    const size = concreteText(config.size);
    const quality = concreteText(config.quality);
    const batchSize = positiveInteger(config.count);
    return {
        ...(count ? { referenceInputs: ["image"], referenceCount: count } : {}),
        ...(size && pixelSize(size) ? { pixelSize: pixelSize(size) } : size ? { aspectRatio: size } : {}),
        ...(quality ? { quality } : {}),
        ...(batchSize ? { batchSize } : {}),
    };
}

export function videoGenerationRequest(config: Record<string, unknown>, references: readonly GenerationReference[]): NormalizedGenerationRequest {
    const referenceInputs = Array.from(new Set(references.map((reference) => reference.type).filter((type): type is "image" | "video" | "audio" => type === "image" || type === "video" || type === "audio")));
    const referenceCount = references.filter((reference) => reference.type === "image").length;
    const size = concreteText(config.size);
    const resolution = concreteText(config.vquality);
    const durationSeconds = positiveNumber(config.videoSeconds);
    const batchSize = positiveInteger(config.count);
    const videoReferenceMode = references.some((reference) => reference.role === "last_frame") ? "first_last" : references.some((reference) => reference.role === "first_frame") ? "first_frame" : references.length ? "reference" : undefined;
    return {
        ...(referenceInputs.length ? { referenceInputs } : {}),
        ...(referenceCount ? { referenceCount } : {}),
        ...(size && pixelSize(size) ? { pixelSize: pixelSize(size) } : size ? { aspectRatio: size } : {}),
        ...(resolution ? { resolution } : {}),
        ...(durationSeconds ? { durationSeconds } : {}),
        ...(batchSize ? { batchSize } : {}),
        ...(videoReferenceMode ? { videoReferenceMode } : {}),
    };
}

export function audioGenerationRequest(config: Record<string, unknown>): NormalizedGenerationRequest {
    const voice = concreteText(config.voice);
    const format = concreteText(config.format);
    const speed = positiveNumber(config.speed);
    return { ...(voice ? { voice } : {}), ...(format ? { format } : {}), ...(speed ? { speed } : {}) };
}

function capabilityError(field: keyof NormalizedGenerationRequest | "generationParameters", request: NormalizedGenerationRequest) {
    const messages: Record<typeof field, string> = {
        generationParameters: "当前模型尚未配置生成参数能力",
        referenceInputs: `当前模型不支持参考${(request.referenceInputs || []).map((input) => ({ image: "图片", video: "视频", audio: "音频" })[input]).join("、")}输入`,
        referenceCount: `当前模型不支持当前参考图数量（${request.referenceCount || 0} 张）`,
        aspectRatio: `当前模型不支持 ${request.aspectRatio || "当前"} 比例`,
        pixelSize: `当前模型不支持 ${request.pixelSize || "当前"} 尺寸`,
        quality: `当前模型不支持画质 ${request.quality || "当前值"}`,
        resolution: `当前模型不支持清晰度 ${request.resolution || "当前值"}`,
        durationSeconds: `当前模型不支持 ${request.durationSeconds || 0} 秒视频时长`,
        batchSize: `当前模型不支持一次生成 ${request.batchSize || 0} 个结果`,
        videoReferenceMode: `当前模型不支持${({ reference: "普通参考", first_frame: "首帧", first_last: "首尾帧" } as const)[request.videoReferenceMode || "reference"]}模式`,
        voice: `当前模型不支持音色 ${request.voice || "当前值"}`,
        format: `当前模型不支持格式 ${request.format || "当前值"}`,
        speed: `当前模型不支持语速 ${request.speed || "当前值"}`,
    };
    return new Error(messages[field]);
}

function concreteText(value: unknown) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return text && text.toLowerCase() !== "auto" ? text : "";
}

function pixelSize(value: string) {
    const match = value.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (!match) return "";
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? `${width}x${height}` : "";
}

function positiveInteger(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function concreteBoolean(value: unknown) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
}

function resolveCandidates<T extends GenerationCandidate, R extends T>(candidates: readonly T[], resolve: (candidate: T) => { candidate: R; request: NormalizedGenerationRequest }) {
    let error: Error | undefined;
    const compatible: R[] = [];
    for (const candidate of candidates) {
        const resolved = resolve(candidate);
        const compatibility = generationParametersCompatible(candidate.generationParameters as LogicalModelGenerationParameters | undefined, resolved.request);
        if (compatibility.compatible) compatible.push(resolved.candidate);
        else error ||= capabilityError(compatibility.field, resolved.request);
    }
    return { candidates: compatible, error };
}

function resolveSize(value: unknown, fallback: string, parameters: LogicalModelGenerationParameters | undefined) {
    const explicit = concreteText(value);
    if (explicit) return explicit;
    const defaultValue = concreteText(fallback);
    if (defaultValue) {
        const request = pixelSize(defaultValue) ? { pixelSize: pixelSize(defaultValue) } : { aspectRatio: defaultValue };
        if (generationParametersCompatible(parameters, request).compatible) return defaultValue;
    }
    return parameters?.aspectRatios?.[0] || parameters?.pixelSizes?.[0];
}

function resolveText(value: unknown, fallback: unknown, parameters: LogicalModelGenerationParameters | undefined, supported: readonly string[] | undefined, request: (value: string) => NormalizedGenerationRequest) {
    const explicit = concreteText(value);
    if (explicit) return explicit;
    const defaultValue = concreteText(fallback);
    if (defaultValue && generationParametersCompatible(parameters, request(defaultValue)).compatible) return defaultValue;
    return supported?.[0];
}

function compatibleDefault<T>(parameters: LogicalModelGenerationParameters | undefined, request: NormalizedGenerationRequest, value: T) {
    return generationParametersCompatible(parameters, request).compatible ? value : undefined;
}
