import { normalizeImageQualityProfile, type ImageQualityProfile, type ImageQualityProfileSource } from "./image-quality-profile";

type DflopImageQualityProfileInput = {
    modelId: string;
    currentProfile?: ImageQualityProfile;
    structuredProfile?: unknown;
    providerPricingProfile?: { metadata?: Record<string, unknown> };
    syncedAt?: string;
};

const QWEN_1K_SIZES = ["512x512", "1024x1024", "1024x1536", "1536x1024"];
const QWEN_2K_SIZES = ["1536x1536", "2048x2048", "2560x2560"];
const QWEN_SIZE_BY_RATIO = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024" },
    "2k": { "1:1": "2048x2048" },
} as const;
const MIDJOURNEY_PROMPT_FLAG_MODELS = new Set(["tvod-midjourney-v7", "tvod-midjourney-v8.1"]);
const SEEDREAM_1920_MINIMUM_MODELS = new Set(["doubao-seedream-4-5-251128", "doubao-seedream-5-0-260128"]);

export function resolveDflopImageExecutionSize(modelId: string, requestedSize: string, resolutionTier?: string) {
    const normalizedModel = modelId.trim().toLowerCase();
    if (normalizedModel === "qwen-image-3.0-pro") return QWEN_SIZE_BY_RATIO[resolutionTier === "2k" ? "2k" : "1k"][requestedSize.trim() as "1:1"];
    if (normalizedModel === "doubao-seedream-5-0-pro-260628") return minimumSquareAreaSize(requestedSize, 1920 * 1920);
    if (!SEEDREAM_1920_MINIMUM_MODELS.has(normalizedModel)) return undefined;
    return minimumSquareAreaSize(requestedSize, 1920 * 1920);
}

function minimumSquareAreaSize(requestedSize: string, targetPixels: number) {
    const match = /^(\d+)\s*:\s*(\d+)$/.exec(requestedSize.trim());
    if (!match) return undefined;
    const ratioWidth = Number(match[1]);
    const ratioHeight = Number(match[2]);
    if (!Number.isSafeInteger(ratioWidth) || !Number.isSafeInteger(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) return undefined;
    const unit = Math.ceil(Math.sqrt(targetPixels / (ratioWidth * ratioHeight)) / 16) * 16;
    return `${ratioWidth * unit}x${ratioHeight * unit}`;
}

export function deriveDflopImageQualityProfile(input: DflopImageQualityProfileInput): ImageQualityProfile {
    const validatedAt = input.syncedAt || new Date().toISOString();
    const upstream = structuredCandidate(input.structuredProfile, validatedAt) || presetCandidate(input, validatedAt) || noneCandidate(validatedAt);
    const current = normalizeImageQualityProfile(input.currentProfile);
    if (!current || current.source !== "manual") return upstream;
    const changed = current.profileRevision !== upstream.profileRevision;
    return normalizeImageQualityProfile({
        ...current,
        validation: changed
            ? {
                  status: "DRIFT",
                  reasons: [...current.validation.reasons.filter((reason) => reason.code !== "UPSTREAM_PROFILE_CHANGED"), { code: "UPSTREAM_PROFILE_CHANGED", message: "DFLOP 上游画质档案已变化，当前继续使用管理员手动配置", severity: "warning" }],
                  validatedAt,
              }
            : { ...current.validation, validatedAt },
        upstreamCandidate: upstream,
    })!;
}

function structuredCandidate(value: unknown, validatedAt: string) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const profile = normalizeImageQualityProfile({ ...(value as Record<string, unknown>), source: "structured_upstream", validation: { status: "VALID", reasons: [], validatedAt } });
    return profile;
}

function presetCandidate(input: DflopImageQualityProfileInput, validatedAt: string) {
    const modelId = input.modelId.trim().toLowerCase();
    if (MIDJOURNEY_PROMPT_FLAG_MODELS.has(modelId)) {
        return profile(
            "prompt_flag",
            "explicit",
            "provider_preset",
            [
                { value: "standard", label: "标准", effect: { type: "prompt_flag", promptSuffix: "--sd", mutexGroup: "midjourney-quality" } },
                { value: "high", label: "高清", effect: { type: "prompt_flag", promptSuffix: "--hd", mutexGroup: "midjourney-quality" } },
            ],
            validatedAt,
            "standard",
        );
    }
    if (modelId === "qwen-image-3.0-pro") {
        return profile(
            "resolution_tier",
            "explicit",
            "provider_preset",
            [
                { value: "1k", label: "1K", effect: { type: "resolution_tier", resolutionTier: "1k", exactSizes: QWEN_1K_SIZES, sizeByAspectRatio: QWEN_SIZE_BY_RATIO["1k"] } },
                { value: "2k", label: "2K", effect: { type: "resolution_tier", resolutionTier: "2k", exactSizes: QWEN_2K_SIZES, sizeByAspectRatio: QWEN_SIZE_BY_RATIO["2k"] } },
            ],
            validatedAt,
            "1k",
        );
    }
    if (modelId === "doubao-seedream-5-0-pro-260628") {
        const threshold = decimalString(input.providerPricingProfile?.metadata?.imageLargeThresholdMegapixels);
        if (!threshold) {
            return profile("pixel_tier", "derived", "provider_preset", [], validatedAt, undefined, {
                status: "NEEDS_REVIEW",
                reasons: [{ code: "MISSING_PIXEL_TIER_THRESHOLD", message: "DFLOP 定价元数据缺少 Seedream 像素档位阈值", severity: "blocking" }],
            });
        }
        return profile(
            "pixel_tier",
            "derived",
            "provider_preset",
            [
                { value: "normal", label: "标准像素", effect: { type: "pixel_tier", pixelTier: "normal", maxMegapixels: threshold } },
                { value: "large", label: "大像素", effect: { type: "pixel_tier", pixelTier: "large", minMegapixels: threshold } },
            ],
            validatedAt,
        );
    }
    return undefined;
}

function noneCandidate(validatedAt: string) {
    return profile("none", "none", "none", [], validatedAt);
}

function profile(
    controlType: ImageQualityProfile["controlType"],
    selectionMode: ImageQualityProfile["selectionMode"],
    source: ImageQualityProfileSource,
    options: Array<{ value: string; label: string; effect: Record<string, unknown> }>,
    validatedAt: string,
    defaultValue?: string,
    validation: Pick<ImageQualityProfile["validation"], "status" | "reasons"> = { status: "VALID", reasons: [] },
) {
    return normalizeImageQualityProfile({ version: 1, controlType, selectionMode, source, options, ...(defaultValue ? { defaultValue } : {}), validation: { ...validation, validatedAt } })!;
}

function decimalString(value: unknown) {
    const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) ? normalized : undefined;
}
