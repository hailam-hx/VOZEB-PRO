import type { LogicalModelGenerationParameters } from "@/lib/auth/store";

type ListField = "referenceInputs" | "aspectRatios" | "pixelSizes" | "qualities" | "resolutions" | "durationSeconds" | "videoReferenceModes" | "voices" | "formats";

export function validateGenerationParametersInput(value: unknown) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return "生成能力档案格式无效";
    const input = value as Record<string, unknown>;
    for (const field of ["referenceInputs", "qualities", "resolutions", "voices", "formats"] satisfies ListField[]) if (input[field] !== undefined && !stringList(input[field])) return `${label(field)}必须是非空文本列表`;
    if (input.aspectRatios !== undefined && (!Array.isArray(input.aspectRatios) || input.aspectRatios.some((item) => !ratio(item)))) return "支持比例必须使用正数 W:H 格式";
    if (input.pixelSizes !== undefined && (!Array.isArray(input.pixelSizes) || input.pixelSizes.some((item) => !size(item)))) return "精确尺寸必须使用正数 WIDTHxHEIGHT 格式";
    if (input.durationSeconds !== undefined && (!Array.isArray(input.durationSeconds) || input.durationSeconds.some((item) => !positive(item)))) return "可选秒数必须是正数";
    if (input.durationMode !== undefined && input.durationMode !== "discrete" && input.durationMode !== "range") return "视频时长模式无效";
    if (input.durationRange !== undefined) {
        const error = rangeError(input.durationRange, "视频时长");
        if (error) return error;
    }
    for (const field of ["supportsCustomDuration", "supportsCustomBatchSize"] as const) if (input[field] !== undefined && typeof input[field] !== "boolean") return `${field}必须是布尔值`;
    if (input.customDurationRange !== undefined) {
        const error = rangeError(input.customDurationRange, "自定义时长");
        if (error) return error;
    }
    if (input.supportsCustomDuration === true && input.customDurationRange === undefined) return "启用自定义时长时必须配置有效范围";
    if (input.customBatchSizeRange !== undefined) {
        const error = rangeError(input.customBatchSizeRange, "自定义数量");
        if (error) return error;
        const { min, max } = input.customBatchSizeRange as { min: unknown; max: unknown };
        if (!positiveInteger(min) || !positiveInteger(max)) return "自定义数量范围必须是正整数";
    }
    if (input.supportsCustomBatchSize === true && input.customBatchSizeRange === undefined) return "启用自定义数量时必须配置有效范围";
    if (input.speedRange !== undefined) {
        const error = rangeError(input.speedRange, "语速");
        if (error) return error;
    }
    for (const field of ["maxReferenceImages", "maxBatchSize"] as const) if (input[field] !== undefined && !positiveInteger(input[field])) return `${field === "maxReferenceImages" ? "最大参考图片数" : "最大批量数量"}必须是正整数`;
    if (input.referenceInputs !== undefined && (!Array.isArray(input.referenceInputs) || input.referenceInputs.some((item) => item !== "image" && item !== "video" && item !== "audio"))) return "参考素材类型无效";
    if (input.videoReferenceModes !== undefined && (!Array.isArray(input.videoReferenceModes) || input.videoReferenceModes.some((item) => item !== "reference" && item !== "first_frame" && item !== "first_last"))) return "视频参考方式无效";
    if (input.supportsCustomSize !== undefined && typeof input.supportsCustomSize !== "boolean") return "supportsCustomSize必须是布尔值";
    return undefined;
}

function stringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
}

function ratio(value: unknown) {
    const match = typeof value === "string" && value.trim().match(/^(\d+)\s*:\s*(\d+)$/);
    return Boolean(match && Number(match[1]) > 0 && Number(match[2]) > 0);
}

function size(value: unknown) {
    const match = typeof value === "string" && value.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    return Boolean(match && Number(match[1]) > 0 && Number(match[2]) > 0);
}

function positive(value: unknown) {
    const number = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : Number.NaN;
    return Number.isFinite(number) && number > 0;
}

function positiveInteger(value: unknown) {
    return positive(value) && Number.isSafeInteger(Number(value));
}

function rangeError(value: unknown, label: string) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${label}范围格式无效`;
    const { min, max } = value as { min?: unknown; max?: unknown };
    if (!positive(min) || !positive(max)) return `${label}范围必须是正数`;
    return Number(min) > Number(max) ? `${label}范围的最小值不能大于最大值` : undefined;
}

function label(field: keyof LogicalModelGenerationParameters) {
    return field === "referenceInputs" ? "参考素材类型" : field === "qualities" ? "图片质量" : field === "resolutions" ? "视频清晰度" : field === "voices" ? "音色" : "输出格式";
}
