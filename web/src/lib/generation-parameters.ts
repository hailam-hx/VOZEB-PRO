import { audioFormatOptions, audioVoiceOptions } from "@/lib/audio-generation";
import type { LogicalModelCapability, LogicalModelGenerationParameters } from "@/lib/auth/store";

export const VOZEB_IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"] as const;
export const VOZEB_VIDEO_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export const VOZEB_IMAGE_QUALITIES = ["high", "medium", "low"] as const;
export const VOZEB_VIDEO_RESOLUTIONS = ["480", "720", "1080", "2k", "4k"] as const;
export const VOZEB_GENERATION_BATCH_OPTIONS = [1, 2, 3, 4] as const;
export const VOZEB_VIDEO_DURATION_OPTIONS = [5, 15] as const;
export const VOZEB_VIDEO_REFERENCE_MODES = ["reference", "first_frame", "first_last"] as const;

type GenerationParameterSource = { enabled: boolean; bindings: Array<{ enabled: boolean; generationParameters?: unknown }> };
type ReferenceInput = NonNullable<LogicalModelGenerationParameters["referenceInputs"]>[number];
type VideoReferenceMode = NonNullable<LogicalModelGenerationParameters["videoReferenceModes"]>[number];

export type NormalizedGenerationRequest = {
    referenceInputs?: ReferenceInput[];
    referenceCount?: number;
    aspectRatio?: string;
    pixelSize?: string;
    quality?: string;
    resolution?: string;
    durationSeconds?: number;
    batchSize?: number;
    videoReferenceMode?: VideoReferenceMode;
    voice?: string;
    format?: string;
    speed?: number;
};

export type GenerationCompatibility = { compatible: true } | { compatible: false; field: keyof NormalizedGenerationRequest | "generationParameters" };

export function fullGenerationParametersPreset(capability: LogicalModelCapability): LogicalModelGenerationParameters | undefined {
    const shared = {
        referenceInputs: [],
        aspectRatios: [],
        pixelSizes: [],
        supportsCustomSize: false,
        qualities: [],
        resolutions: [],
        durationSeconds: [],
        videoReferenceModes: [],
        voices: [],
        formats: [],
    } satisfies LogicalModelGenerationParameters;
    if (capability === "image") {
        return normalizeGenerationParameters({
            ...shared,
            referenceInputs: ["image"],
            aspectRatios: VOZEB_IMAGE_ASPECT_RATIOS,
            supportsCustomSize: true,
            qualities: VOZEB_IMAGE_QUALITIES,
        });
    }
    if (capability === "video") {
        return normalizeGenerationParameters({
            ...shared,
            aspectRatios: VOZEB_VIDEO_ASPECT_RATIOS,
            supportsCustomSize: true,
            resolutions: VOZEB_VIDEO_RESOLUTIONS,
            durationMode: "discrete",
            durationSeconds: VOZEB_VIDEO_DURATION_OPTIONS,
            supportsCustomDuration: true,
            customDurationRange: { min: 4, max: 15 },
            maxBatchSize: 4,
            supportsCustomBatchSize: true,
            customBatchSizeRange: { min: 1, max: 30 },
            videoReferenceModes: VOZEB_VIDEO_REFERENCE_MODES,
        });
    }
    if (capability === "audio") {
        return normalizeGenerationParameters({
            ...shared,
            referenceInputs: ["audio"],
            maxBatchSize: 1,
            voices: audioVoiceOptions.map((option) => option.value),
            formats: audioFormatOptions.map((option) => option.value),
            speedRange: { min: 0.25, max: 4 },
        });
    }
    return undefined;
}

export function normalizeGenerationParameters(value: unknown): LogicalModelGenerationParameters | undefined {
    if (value === undefined) return undefined;
    const input = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const discreteDurations = normalizeNumbers(input.durationSeconds) || [];
    const durationRange = normalizeRange(input.durationRange);
    const durationMode = input.durationMode === "discrete" ? "discrete" : input.durationMode === "range" ? "range" : undefined;
    const supportsCustomDuration = input.supportsCustomDuration === true;
    const supportsCustomBatchSize = input.supportsCustomBatchSize === true;
    const profile: LogicalModelGenerationParameters = {
        referenceInputs: normalizeEnumList(input.referenceInputs, ["image", "video", "audio"]) || [],
        maxReferenceImages: positiveInteger(input.maxReferenceImages),
        aspectRatios: normalizeAspectRatios(input.aspectRatios) || [],
        pixelSizes: normalizePixelSizes(input.pixelSizes) || [],
        supportsCustomSize: input.supportsCustomSize === true,
        qualities: normalizeStringList(input.qualities) || [],
        resolutions: normalizeStringList(input.resolutions) || [],
        durationMode,
        durationSeconds: durationMode === "discrete" ? discreteDurations : [],
        durationRange: durationMode === "range" ? durationRange : undefined,
        supportsCustomDuration: supportsCustomDuration || undefined,
        customDurationRange: supportsCustomDuration ? normalizeRange(input.customDurationRange) : undefined,
        maxBatchSize: positiveInteger(input.maxBatchSize),
        supportsCustomBatchSize: supportsCustomBatchSize || undefined,
        customBatchSizeRange: supportsCustomBatchSize ? normalizeIntegerRange(input.customBatchSizeRange) : undefined,
        videoReferenceModes: normalizeEnumList(input.videoReferenceModes, ["reference", "first_frame", "first_last"]) || [],
        voices: normalizeStringList(input.voices) || [],
        formats: normalizeStringList(input.formats) || [],
        speedRange: normalizeRange(input.speedRange),
    };
    return Object.fromEntries(Object.entries(profile).filter(([, item]) => item !== undefined)) as LogicalModelGenerationParameters;
}

export function unionGenerationParameters(model: GenerationParameterSource): LogicalModelGenerationParameters | undefined {
    if (!model.enabled) return undefined;
    const profiles = model.bindings
        .filter((binding) => binding.enabled)
        .map((binding) => normalizeGenerationParameters(binding.generationParameters))
        .filter((profile): profile is LogicalModelGenerationParameters => Boolean(profile));
    return unionProfiles(profiles);
}

export function unionAvailableGenerationParameters(models: GenerationParameterSource[]): LogicalModelGenerationParameters | undefined {
    return unionProfiles(models.map(unionGenerationParameters).filter((profile): profile is LogicalModelGenerationParameters => Boolean(profile)));
}

export function intersectGenerationParameters(models: GenerationParameterSource[]): LogicalModelGenerationParameters | undefined {
    const profiles = models.map(unionGenerationParameters);
    if (!profiles.length || profiles.some((profile) => !profile)) return undefined;
    return intersectProfiles(profiles as LogicalModelGenerationParameters[]);
}

export function generationParametersCompatible(parameters: LogicalModelGenerationParameters | undefined, request: NormalizedGenerationRequest): GenerationCompatibility {
    const profile = normalizeGenerationParameters(parameters);
    if (!profile) return hasConcreteRequest(request) ? { compatible: false, field: "generationParameters" } : { compatible: true };
    if (request.referenceInputs?.some((input) => !profile.referenceInputs?.includes(input))) return incompatible("referenceInputs");
    if (request.referenceCount !== undefined && (!profile.maxReferenceImages || !positiveInteger(request.referenceCount) || request.referenceCount > profile.maxReferenceImages)) return incompatible("referenceCount");
    if (request.aspectRatio !== undefined && !profile.aspectRatios?.includes(request.aspectRatio.trim())) return incompatible("aspectRatio");
    if (request.pixelSize !== undefined && !pixelSizeCompatible(profile, request.pixelSize)) return incompatible("pixelSize");
    if (request.quality !== undefined && !profile.qualities?.includes(request.quality.trim())) return incompatible("quality");
    if (request.resolution !== undefined && !profile.resolutions?.includes(request.resolution.trim())) return incompatible("resolution");
    if (request.durationSeconds !== undefined && !durationCompatible(profile, request.durationSeconds)) return incompatible("durationSeconds");
    if (request.batchSize !== undefined && !batchSizeCompatible(profile, request.batchSize)) return incompatible("batchSize");
    if (request.videoReferenceMode !== undefined && !profile.videoReferenceModes?.includes(request.videoReferenceMode)) return incompatible("videoReferenceMode");
    if (request.voice !== undefined && !profile.voices?.includes(request.voice.trim())) return incompatible("voice");
    if (request.format !== undefined && !profile.formats?.includes(request.format.trim())) return incompatible("format");
    if (request.speed !== undefined && (!profile.speedRange || !isPositiveNumber(request.speed) || request.speed < profile.speedRange.min || request.speed > profile.speedRange.max)) return incompatible("speed");
    return { compatible: true };
}

function unionProfiles(profiles: LogicalModelGenerationParameters[]) {
    if (!profiles.length) return undefined;
    const duration = unionDuration(profiles);
    return normalizeGenerationParameters({
        referenceInputs: unionList(profiles, "referenceInputs"),
        maxReferenceImages: maximum(profiles, "maxReferenceImages"),
        aspectRatios: unionList(profiles, "aspectRatios"),
        pixelSizes: unionList(profiles, "pixelSizes"),
        supportsCustomSize: profiles.some((profile) => profile.supportsCustomSize),
        qualities: unionList(profiles, "qualities"),
        resolutions: unionList(profiles, "resolutions"),
        ...duration,
        ...unionCustomRange(profiles, "supportsCustomDuration", "customDurationRange"),
        maxBatchSize: maximum(profiles, "maxBatchSize"),
        ...unionCustomRange(profiles, "supportsCustomBatchSize", "customBatchSizeRange"),
        videoReferenceModes: unionList(profiles, "videoReferenceModes"),
        voices: unionList(profiles, "voices"),
        formats: unionList(profiles, "formats"),
        speedRange: unionRange(profiles, "speedRange"),
    });
}

function intersectProfiles(profiles: LogicalModelGenerationParameters[]) {
    const duration = intersectDuration(profiles);
    return normalizeGenerationParameters({
        referenceInputs: intersectList(profiles, "referenceInputs"),
        maxReferenceImages: minimum(profiles, "maxReferenceImages"),
        aspectRatios: intersectList(profiles, "aspectRatios"),
        pixelSizes: intersectList(profiles, "pixelSizes"),
        supportsCustomSize: profiles.every((profile) => profile.supportsCustomSize),
        qualities: intersectList(profiles, "qualities"),
        resolutions: intersectList(profiles, "resolutions"),
        ...duration,
        ...intersectCustomRange(profiles, "supportsCustomDuration", "customDurationRange"),
        maxBatchSize: minimum(profiles, "maxBatchSize"),
        ...intersectCustomRange(profiles, "supportsCustomBatchSize", "customBatchSizeRange"),
        videoReferenceModes: intersectList(profiles, "videoReferenceModes"),
        voices: intersectList(profiles, "voices"),
        formats: intersectList(profiles, "formats"),
        speedRange: intersectRange(profiles, "speedRange"),
    });
}

function unionDuration(profiles: LogicalModelGenerationParameters[]) {
    const discrete = profiles.flatMap((profile) => (profile.durationMode === "discrete" ? profile.durationSeconds : []));
    const ranges = profiles
        .filter((profile) => profile.durationMode === "range")
        .map((profile) => profile.durationRange)
        .filter((range): range is { min: number; max: number } => Boolean(range));
    if (!ranges.length) return discrete.length ? { durationMode: "discrete" as const, durationSeconds: uniqueNumbers(discrete) } : {};
    const continuousRange = continuousUnion(ranges);
    if (!continuousRange || discrete.some((value) => value < continuousRange.min || value > continuousRange.max)) return {};
    return { durationMode: "range" as const, durationRange: continuousRange };
}

function intersectDuration(profiles: LogicalModelGenerationParameters[]) {
    const first = profiles[0];
    if (profiles.every((profile) => profile.durationMode === "discrete")) return { durationMode: "discrete" as const, durationSeconds: first.durationSeconds.filter((value) => profiles.every((profile) => profile.durationSeconds.includes(value))) };
    const discrete = profiles.flatMap((profile) => (profile.durationMode === "discrete" ? profile.durationSeconds : []));
    if (discrete.length) return { durationMode: "discrete" as const, durationSeconds: uniqueNumbers(discrete).filter((value) => profiles.every((profile) => durationCompatible(profile, value))) };
    const min = Math.max(...profiles.map((profile) => profile.durationRange?.min || Infinity));
    const max = Math.min(...profiles.map((profile) => profile.durationRange?.max || -Infinity));
    return min <= max ? { durationMode: "range" as const, durationRange: { min, max } } : {};
}

function durationCompatible(profile: LogicalModelGenerationParameters, value: number) {
    if (!isPositiveNumber(value)) return false;
    const fixed = profile.durationMode === "discrete" ? profile.durationSeconds.includes(value) : profile.durationMode === "range" ? inRange(profile.durationRange, value) : false;
    return fixed || (profile.supportsCustomDuration === true && inRange(profile.customDurationRange, value));
}

function batchSizeCompatible(profile: LogicalModelGenerationParameters, value: number) {
    if (!positiveInteger(value)) return false;
    const fixed = VOZEB_GENERATION_BATCH_OPTIONS.includes(value as (typeof VOZEB_GENERATION_BATCH_OPTIONS)[number]) && Boolean(profile.maxBatchSize && value <= profile.maxBatchSize);
    return fixed || (profile.supportsCustomBatchSize === true && inRange(profile.customBatchSizeRange, value));
}

function pixelSizeCompatible(profile: LogicalModelGenerationParameters, value: string) {
    const normalized = normalizePixelSize(value);
    if (!normalized) return false;
    return profile.pixelSizes?.includes(normalized) || profile.supportsCustomSize === true;
}

function incompatible(field: Exclude<GenerationCompatibility, { compatible: true }>["field"]): GenerationCompatibility {
    return { compatible: false, field };
}

function normalizeEnumList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
    const values = normalizeStringList(value)?.filter((item): item is T => (allowed as readonly string[]).includes(item));
    return values?.length ? values : undefined;
}

function normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const values = uniqueStrings(
        value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
    );
    return values.length ? values : undefined;
}

function normalizePixelSizes(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const values = uniqueStrings(
        value
            .filter((item): item is string => typeof item === "string")
            .map(normalizePixelSize)
            .filter((item): item is string => Boolean(item)),
    );
    return values.length ? values : undefined;
}

function normalizeAspectRatios(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const values = uniqueStrings(
        value
            .filter((item): item is string => typeof item === "string")
            .map((item) => {
                const match = item.trim().match(/^(\d+)\s*:\s*(\d+)$/);
                return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? `${Number(match[1])}:${Number(match[2])}` : undefined;
            })
            .filter((item): item is string => Boolean(item)),
    );
    return values.length ? values : undefined;
}

function normalizePixelSize(value: string) {
    const match = value.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (!match) return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? `${width}x${height}` : undefined;
}

function normalizeNumbers(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const values = uniqueNumbers(value.map(numericValue).filter(isPositiveNumber));
    return values.length ? values : undefined;
}

function normalizeRange(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as { min?: unknown; max?: unknown };
    const min = numericValue(input.min);
    const max = numericValue(input.max);
    if (!isPositiveNumber(min) || !isPositiveNumber(max)) return undefined;
    return min <= max ? { min, max } : undefined;
}

function normalizeIntegerRange(value: unknown) {
    const range = normalizeRange(value);
    return range && Number.isSafeInteger(range.min) && Number.isSafeInteger(range.max) ? range : undefined;
}

function positiveInteger(value: unknown) {
    const number = Math.floor(numericValue(value));
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function numericValue(value: unknown) {
    return typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : Number.NaN;
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function uniqueStrings(values: string[]) {
    return Array.from(new Set(values));
}

function uniqueNumbers(values: number[]) {
    return Array.from(new Set(values));
}

function unionList<K extends "referenceInputs" | "aspectRatios" | "pixelSizes" | "qualities" | "resolutions" | "videoReferenceModes" | "voices" | "formats">(profiles: LogicalModelGenerationParameters[], key: K) {
    return uniqueStrings(profiles.flatMap((profile) => profile[key] || []) as string[]);
}

function intersectList<K extends "referenceInputs" | "aspectRatios" | "pixelSizes" | "qualities" | "resolutions" | "videoReferenceModes" | "voices" | "formats">(profiles: LogicalModelGenerationParameters[], key: K) {
    const values = (profiles[0]?.[key] || []) as string[];
    return values.filter((value) => profiles.every((profile) => ((profile[key] || []) as string[]).includes(value)));
}

function maximum<K extends "maxReferenceImages" | "maxBatchSize">(profiles: LogicalModelGenerationParameters[], key: K) {
    const values = profiles.map((profile) => profile[key]).filter((value): value is number => value !== undefined);
    return values.length ? Math.max(...values) : undefined;
}

function minimum<K extends "maxReferenceImages" | "maxBatchSize">(profiles: LogicalModelGenerationParameters[], key: K) {
    const values = profiles.map((profile) => profile[key]);
    return values.every((value): value is number => value !== undefined) ? Math.min(...values) : undefined;
}

function unionRange(profiles: LogicalModelGenerationParameters[], key: "speedRange") {
    const ranges = profiles.map((profile) => profile[key]).filter((range): range is { min: number; max: number } => Boolean(range));
    return continuousUnion(ranges);
}

function unionCustomRange(profiles: LogicalModelGenerationParameters[], supportKey: "supportsCustomDuration" | "supportsCustomBatchSize", rangeKey: "customDurationRange" | "customBatchSizeRange") {
    const ranges = profiles
        .filter((profile) => profile[supportKey] === true)
        .map((profile) => profile[rangeKey])
        .filter((range): range is { min: number; max: number } => Boolean(range));
    const range = continuousUnion(ranges, rangeKey === "customBatchSizeRange");
    return range ? { [supportKey]: true, [rangeKey]: range } : {};
}

function continuousUnion(ranges: Array<{ min: number; max: number }>, allowAdjacentIntegers = false) {
    if (!ranges.length) return undefined;
    const sorted = [...ranges].sort((left, right) => left.min - right.min || left.max - right.max);
    const { min } = sorted[0];
    let { max } = sorted[0];
    for (const range of sorted.slice(1)) {
        if (range.min > max + (allowAdjacentIntegers ? 1 : 0)) return undefined;
        max = Math.max(max, range.max);
    }
    return { min, max };
}

function hasConcreteRequest(request: NormalizedGenerationRequest) {
    return Object.entries(request).some(([key, value]) => value !== undefined && (key !== "referenceInputs" || !Array.isArray(value) || value.length > 0));
}

function intersectRange(profiles: LogicalModelGenerationParameters[], key: "speedRange") {
    const ranges = profiles.map((profile) => profile[key]);
    if (!ranges.every((range): range is { min: number; max: number } => Boolean(range))) return undefined;
    const min = Math.max(...ranges.map((range) => range.min));
    const max = Math.min(...ranges.map((range) => range.max));
    return min <= max ? { min, max } : undefined;
}

function intersectCustomRange(profiles: LogicalModelGenerationParameters[], supportKey: "supportsCustomDuration" | "supportsCustomBatchSize", rangeKey: "customDurationRange" | "customBatchSizeRange") {
    if (!profiles.every((profile) => profile[supportKey] === true)) return {};
    const ranges = profiles.map((profile) => profile[rangeKey]);
    if (!ranges.every((range): range is { min: number; max: number } => Boolean(range))) return {};
    const min = Math.max(...ranges.map((range) => range.min));
    const max = Math.min(...ranges.map((range) => range.max));
    return min <= max ? { [supportKey]: true, [rangeKey]: { min, max } } : {};
}

function inRange(range: { min: number; max: number } | undefined, value: number) {
    return Boolean(range && value >= range.min && value <= range.max);
}
