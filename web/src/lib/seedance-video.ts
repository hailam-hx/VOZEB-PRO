import { isSeedanceVideoModelName, normalizeModelId } from "@/lib/model-capability";
import { urlHostMatches, urlPathStartsWith } from "@/lib/url-host";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export const SEEDANCE_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
};

export const seedanceResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
] as const;

export const seedanceRatioOptions = [
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
    { value: "1:1", label: "1:1" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "21:9", label: "21:9" },
    { value: "adaptive", label: "adaptive" },
] as const;

const seedancePixels = {
    "480p": {
        "16:9": "864x496",
        "4:3": "752x560",
        "1:1": "640x640",
        "3:4": "560x752",
        "9:16": "496x864",
        "21:9": "992x432",
    },
    "720p": {
        "16:9": "1280x720",
        "4:3": "1112x834",
        "1:1": "960x960",
        "3:4": "834x1112",
        "9:16": "720x1280",
        "21:9": "1470x630",
    },
    "1080p": {
        "16:9": "1920x1080",
        "4:3": "1664x1248",
        "1:1": "1440x1440",
        "3:4": "1248x1664",
        "9:16": "1080x1920",
        "21:9": "2206x946",
    },
} as const;

export function isSeedanceVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "baseUrl">) {
    const selectedModel = config.model || config.videoModel;
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, selectedModel) : config;
    if ("channels" in config) {
        const channel = resolveModelChannel(config, selectedModel);
        const logical = config.logicalModels.find((model) => normalizeModelId(model.id) === normalizeModelId(modelOptionName(selectedModel)));
        const binding = logical?.bindings.filter((item) => item.enabled && item.channelId === channel.id).sort((left, right) => left.priority - right.priority)[0];
        const modelProtocol = channel.advancedConfig?.modelConfigs?.[normalizeModelId(binding?.upstreamModel || selectedModel)]?.protocol;
        if (modelProtocol && modelProtocol !== "auto") return modelProtocol === "seedance" || modelProtocol === "volcengine-video";
        if (channel.advancedConfig?.protocol === "seedance" || channel.advancedConfig?.protocol === "volcengine-video") return true;
    }
    return isSeedanceVideoModelName(modelOptionName(requestConfig.model || requestConfig.videoModel)) || isArkPlanBaseUrl(requestConfig.baseUrl);
}

export function isSeedanceFastModel(model: string) {
    const value = model.toLowerCase();
    return isSeedanceVideoModelName(value) && value.includes("fast");
}

function isArkPlanBaseUrl(baseUrl: string) {
    return urlHostMatches(baseUrl, "ark.cn-beijing.volces.com") && (urlPathStartsWith(baseUrl, "/api/plan/v3") || urlPathStartsWith(baseUrl, "/api/v3"));
}

export function normalizeSeedanceResolution(value: string, model = "") {
    const normalized = normalizeResolutionToken(value);
    if (isSeedanceFastModel(model) && normalized === "1080p") return "720p";
    return seedanceResolutionOptions.some((item) => item.value === normalized) ? normalized : "720p";
}

function normalizeResolutionToken(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = String(value || "").replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

export function normalizeSeedanceDuration(value: string) {
    if (String(value).trim() === "-1") return -1;
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

export function normalizeSeedanceRatio(value: string) {
    if (!value || value === "auto" || value === "adaptive") return "adaptive";
    if (seedanceRatioOptions.some((item) => item.value === value)) return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return "adaptive";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "adaptive";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["4:3", 4 / 3],
        ["1:1", 1],
        ["3:4", 3 / 4],
        ["9:16", 9 / 16],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

export function seedancePixelLabel(resolution: string, ratio: string) {
    const normalizedResolution = normalizeSeedanceResolution(resolution) as keyof typeof seedancePixels;
    const normalizedRatio = normalizeSeedanceRatio(ratio) as keyof (typeof seedancePixels)[typeof normalizedResolution] | "adaptive";
    if (normalizedRatio === "adaptive") return "adaptive";
    return seedancePixels[normalizedResolution][normalizedRatio] || "";
}

export function boolConfig(value: string | undefined, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

function seedanceProviderReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    if (kind === "image") return `图片${index + 1}`;
    if (kind === "video") return `视频${index + 1}`;
    return `音频${index + 1}`;
}

export function buildSeedancePromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const labels = [...images.map((_, index) => seedanceProviderReferenceLabel("image", index)), ...videos.map((_, index) => seedanceProviderReferenceLabel("video", index)), ...audios.map((_, index) => seedanceProviderReferenceLabel("audio", index))];
    const text = prompt.trim();
    if (!labels.length) return text;
    return `参考素材编号：${labels.join("、")}。请按这些编号理解提示词中的图片、视频和音频引用。\n\n${text}`;
}

export type SeedanceVideoReferenceIssue = {
    code: "file-too-large" | "duration-out-of-range" | "dimensions-out-of-range" | "ratio-out-of-range" | "pixels-out-of-range" | "total-duration-out-of-range";
    index?: number;
};

export function seedanceVideoReferenceIssue(videos: ReferenceVideo[]): SeedanceVideoReferenceIssue | undefined {
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const issueIndex = index + 1;
        if (video.bytes && video.bytes > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes) return { code: "file-too-large", index: issueIndex };
        if (video.durationMs) {
            if (video.durationMs < 2000 || video.durationMs > 15000) return { code: "duration-out-of-range", index: issueIndex };
            totalDurationMs += video.durationMs;
        }
        if (video.width && video.height) {
            if (video.width < 300 || video.width > 6000 || video.height < 300 || video.height > 6000) return { code: "dimensions-out-of-range", index: issueIndex };
            const ratio = video.width / video.height;
            if (ratio < 0.4 || ratio > 2.5) return { code: "ratio-out-of-range", index: issueIndex };
            const pixels = video.width * video.height;
            if (pixels < 640 * 640 || pixels > 2206 * 946) return { code: "pixels-out-of-range", index: issueIndex };
        }
    }
    return totalDurationMs > 15000 ? { code: "total-duration-out-of-range" } : undefined;
}

export function seedanceVideoReferenceIssueCode(issue: SeedanceVideoReferenceIssue) {
    return `seedance-reference-${issue.code}${issue.index ? `:${issue.index}` : ""}`;
}
