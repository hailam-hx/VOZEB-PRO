type VozebRecommendedVideoInput = {
    model: string;
    prompt: string;
    duration?: number;
    aspectRatio?: string;
    resolution?: string;
    generateAudio?: boolean;
    images: string[];
    videos: string[];
    audios: string[];
};

const SEEDANCE_FAST_720P = "seedance 2.0-fast-720p";

export function assertVozebRecommendedVideoReferences(model: string, references: Array<{ type?: string }>) {
    if (normalizeModel(model) !== SEEDANCE_FAST_720P) return;
    if (references.some((reference) => reference.type === "video")) throw new Error("Seedance 2.0-fast-720p 不支持参考视频");
    if (references.some((reference) => reference.type === "audio")) throw new Error("Seedance 2.0-fast-720p 不支持参考音频");
}

export function buildVozebRecommendedVideoRequest(input: VozebRecommendedVideoInput) {
    const seedanceFast720p = normalizeModel(input.model) === SEEDANCE_FAST_720P;
    if (input.duration !== undefined && (!Number.isFinite(input.duration) || input.duration <= 0)) throw new Error("当前视频渠道不支持无效时长");
    if (seedanceFast720p && input.duration !== undefined && (input.duration < 5 || input.duration > 15)) throw new Error(`Seedance 2.0-fast-720p 不支持 ${input.duration} 秒时长`);
    if (seedanceFast720p && input.resolution !== undefined && input.resolution !== "720p") throw new Error(`Seedance 2.0-fast-720p 不支持 ${input.resolution} 清晰度`);
    if (seedanceFast720p && input.generateAudio === true) throw new Error("Seedance 2.0-fast-720p 不支持生成音频");
    if (input.images.length > 9) throw new Error("当前视频渠道最多支持 9 张参考图");
    if (input.videos.length > 3) throw new Error("当前视频渠道最多支持 3 个参考视频");
    if (input.audios.length > 3) throw new Error("当前视频渠道最多支持 3 个参考音频");
    const payload: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.resolution ? { resolution: input.resolution, metadata: { resolution: input.resolution } } : {}),
        ...(input.generateAudio !== undefined ? { generate_audio: input.generateAudio } : {}),
        ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    };
    if (input.images.length) payload.images = input.images;
    if (input.videos.length) payload.videos = input.videos;
    if (input.audios.length) payload.audios = input.audios;
    return payload;
}

function normalizeModel(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}
