import type {
    DflopDescriptionCapabilityField,
    DflopDescriptionCapabilitySnapshot,
    DflopMetadataConflict,
    DflopUpstreamModelMetadata,
    LogicalModelCapabilityDrift,
    LogicalModelGenerationParameterEvidence,
    LogicalModelGenerationParameterSources,
    LogicalModelGenerationParameters,
    ModelMetadataSource,
} from "@/lib/auth/store-types";
import { DFLOP_DESCRIPTION_CAPABILITY_FIELDS, parseDflopDescriptionCapabilities } from "@/lib/dflop-description-capabilities";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";
import { normalizeModelId } from "@/lib/model-capability";
import { normalizeProviderPricingProfile } from "@/lib/billing/provider-pricing";
import { parseDflopPricing } from "@/lib/dflop-pricing";
import { deriveDflopImageQualityProfile } from "@/lib/dflop-image-quality-profile";
import { normalizeImageQualityProfile } from "@/lib/image-quality-profile";

export const DFLOP_CAPABILITY_PRESET_VERSION = "2026-09-23";

type ParameterPatch = Partial<LogicalModelGenerationParameters>;

const DFLOP_CAPABILITY_PRESETS: Readonly<Record<string, ParameterPatch>> = {
    "doubao-seedream-5-0-pro-260628": { supportsAutoSize: false },
    "qwen-image-3.0-pro": { supportsAutoSize: false },
    "tvod-kling-expand": { referenceInputs: ["image"], minReferenceImages: 1, maxReferenceImages: 1 },
    "tvod-midjourney-v7": { maxBatchSize: 1 },
    "tvod-midjourney-v8.1": { maxBatchSize: 1 },
    "doubao-seedance-2.5": {
        referenceInputs: ["image", "video", "audio"],
        maxReferenceImages: 30,
        videoReferenceModes: ["reference", "first_frame", "first_last"],
    },
    "doubao-seedance-2.5-lite": {
        referenceInputs: ["image", "video", "audio"],
        maxReferenceImages: 30,
        videoReferenceModes: ["reference", "first_frame", "first_last"],
    },
};
const DFLOP_MIDJOURNEY_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);

const RUNTIME_FIELDS = {
    context_window: "contextWindow",
    default_max_tokens: "defaultMaxTokens",
    supports_tools: "supportsTools",
    supports_vision: "supportsVision",
    supports_web_search: "supportsWebSearch",
    supports_image_gen: "supportsImageGeneration",
    supports_video_input: "supportsVideoInput",
    supports_file_input: "supportsFileInput",
    supports_video_generation: "supportsVideoGeneration",
    supports_thinking: "supportsThinking",
    supports_fast_mode: "supportsFastMode",
    supports_json_mode: "supportsJsonMode",
    images_per_request: "imagesPerRequest",
    health_status: "healthStatus",
    last_check_at: "lastCheckAt",
} as const;

export function parseDflopModelMetadata(metadata: Record<string, unknown>): DflopUpstreamModelMetadata {
    const id = stringValue(metadata.id) || stringValue(metadata.model);
    const category = stringValue(metadata.category)?.toLowerCase();
    const endpointType = metadata.endpoint_type === null ? null : stringValue(metadata.endpoint_type)?.toLowerCase();
    const supportedProtocols = stringList(metadata.supported_protocols).map((value) => value.toLowerCase());
    const preset = DFLOP_CAPABILITY_PRESETS[normalizeModelId(id || "")];
    const presetParameters = preset ? normalizeGenerationParameters(preset) : undefined;
    const description = parseDflopDescriptionCapabilities(metadata.description);
    const descriptionParameters = descriptionGenerationParameters(description, presetParameters);
    const structured = structuredGenerationParameters(metadata, category, id);
    const hasGenerationParameters = Boolean(presetParameters) || Object.keys(descriptionParameters.sources).length > 0 || Object.keys(structured.sources).length > 0;
    const generationParameters = hasGenerationParameters ? normalizeGenerationParameters({ ...presetParameters, ...descriptionParameters.parameters, ...structured.parameters }) : undefined;
    const generationParameterSources: LogicalModelGenerationParameterSources = {};
    const generationParameterEvidence: LogicalModelGenerationParameterEvidence = {};
    if (presetParameters) for (const field of Object.keys(preset) as Array<keyof LogicalModelGenerationParameters>) generationParameterSources[field] = "preset";
    Object.assign(generationParameterSources, descriptionParameters.sources);
    Object.assign(generationParameterEvidence, descriptionParameters.evidence);
    Object.assign(generationParameterSources, structured.sources);
    for (const field of Object.keys(structured.sources) as Array<keyof LogicalModelGenerationParameters>) delete generationParameterEvidence[field];
    const descriptionCapabilities = mergeDescriptionCapabilities(description, preset, metadata);
    const runtime = pickMetadata(metadata, RUNTIME_FIELDS);
    const providerPricingProfile = parseDflopPricing(metadata, {
        modelId: id || "unknown",
        category,
        endpointType,
        syncedAt: stringValue(metadata.pricing_synced_at) || new Date().toISOString(),
    });
    const imageQualityProfile = metadata.image_quality_profile
        ? deriveDflopImageQualityProfile({ modelId: id || "unknown", structuredProfile: metadata.image_quality_profile, providerPricingProfile, syncedAt: providerPricingProfile.syncedAt })
        : undefined;
    return {
        ...(stringValue(metadata.display_name) ? { displayName: stringValue(metadata.display_name) } : {}),
        ...(stringValue(metadata.brand) ? { brand: stringValue(metadata.brand) } : {}),
        ...(category ? { category } : {}),
        ...(stringValue(metadata.description) ? { description: stringValue(metadata.description) } : {}),
        ...(endpointType !== undefined ? { endpointType } : {}),
        ...(supportedProtocols.length ? { supportedProtocols } : {}),
        ...(generationParameters ? { generationParameters } : {}),
        ...(Object.keys(generationParameterSources).length ? { generationParameterSources } : {}),
        ...(Object.keys(generationParameterEvidence).length ? { generationParameterEvidence } : {}),
        ...(descriptionCapabilities ? { descriptionCapabilities: descriptionCapabilities.snapshot } : {}),
        ...(descriptionCapabilities?.conflicts.length ? { metadataConflicts: descriptionCapabilities.conflicts } : {}),
        ...(Object.keys(runtime).length ? { runtime } : {}),
        providerPricingProfile,
        ...(imageQualityProfile ? { imageQualityProfile } : {}),
        ...(preset ? { presetVersion: DFLOP_CAPABILITY_PRESET_VERSION } : {}),
    };
}

export function normalizeDflopUpstreamModelMetadata(value: unknown): DflopUpstreamModelMetadata | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const generationParameters = normalizeGenerationParameters(input.generationParameters);
    const sourceInput = input.generationParameterSources && typeof input.generationParameterSources === "object" && !Array.isArray(input.generationParameterSources) ? (input.generationParameterSources as Record<string, unknown>) : {};
    const generationParameterSources = Object.fromEntries(
        Object.entries(sourceInput).filter(([, source]) => source === "upstream" || source === "description" || source === "preset" || source === "manual" || source === "default"),
    ) as LogicalModelGenerationParameterSources;
    const generationParameterEvidence = normalizeGenerationParameterEvidence(input.generationParameterEvidence);
    const descriptionCapabilities = normalizeDescriptionCapabilities(input.descriptionCapabilities);
    const metadataConflicts = normalizeMetadataConflicts(input.metadataConflicts);
    const endpointType = input.endpointType === null ? null : stringValue(input.endpointType);
    const runtime = safeObject(input.runtime);
    const providerPricingProfile = normalizeProviderPricingProfile(input.providerPricingProfile);
    const imageQualityProfile = normalizeImageQualityProfile(input.imageQualityProfile);
    const normalized: DflopUpstreamModelMetadata = {
        ...(stringValue(input.displayName) ? { displayName: stringValue(input.displayName) } : {}),
        ...(stringValue(input.brand) ? { brand: stringValue(input.brand) } : {}),
        ...(stringValue(input.category) ? { category: stringValue(input.category)?.toLowerCase() } : {}),
        ...(stringValue(input.description) ? { description: stringValue(input.description) } : {}),
        ...(endpointType !== undefined ? { endpointType } : {}),
        ...(stringList(input.supportedProtocols).length ? { supportedProtocols: stringList(input.supportedProtocols).map((item) => item.toLowerCase()) } : {}),
        ...(generationParameters ? { generationParameters } : {}),
        ...(Object.keys(generationParameterSources).length ? { generationParameterSources } : {}),
        ...(Object.keys(generationParameterEvidence).length ? { generationParameterEvidence } : {}),
        ...(descriptionCapabilities ? { descriptionCapabilities } : {}),
        ...(metadataConflicts.length ? { metadataConflicts } : {}),
        ...(runtime ? { runtime: runtime as DflopUpstreamModelMetadata["runtime"] } : {}),
        ...(providerPricingProfile ? { providerPricingProfile } : {}),
        ...(imageQualityProfile ? { imageQualityProfile } : {}),
        ...(stringValue(input.presetVersion) ? { presetVersion: stringValue(input.presetVersion) } : {}),
    };
    return Object.keys(normalized).length ? normalized : undefined;
}

export function reconcileDflopUpstreamModelMetadata(previous: DflopUpstreamModelMetadata | undefined, incoming: DflopUpstreamModelMetadata | undefined) {
    if (!incoming) return incoming;
    const previousCapabilities = previous?.descriptionCapabilities;
    if (!previousCapabilities) return incoming;
    const incomingCapabilities = incoming.descriptionCapabilities || ({ values: Object.fromEntries(DFLOP_DESCRIPTION_CAPABILITY_FIELDS.map((field) => [field, null])) } as DflopDescriptionCapabilitySnapshot);
    const values = { ...incomingCapabilities.values };
    const sources = { ...(incomingCapabilities.sources || {}) };
    const evidence = { ...(incomingCapabilities.evidence || {}) };
    const evidenceMissing = new Set(incomingCapabilities.evidenceMissing || []);
    for (const field of DFLOP_DESCRIPTION_CAPABILITY_FIELDS) {
        if (previousCapabilities.sources?.[field] !== "description") continue;
        if (incomingCapabilities.sources?.[field] === "upstream" || incomingCapabilities.sources?.[field] === "description") continue;
        values[field] = previousCapabilities.values[field];
        sources[field] = "description";
        if (previousCapabilities.evidence?.[field]) evidence[field] = previousCapabilities.evidence[field];
        evidenceMissing.add(field);
    }
    return {
        ...incoming,
        descriptionCapabilities: {
            values,
            ...(Object.keys(sources).length ? { sources } : {}),
            ...(Object.keys(evidence).length ? { evidence } : {}),
            ...(evidenceMissing.size ? { evidenceMissing: [...evidenceMissing] } : {}),
        },
    };
}

export function mergeDflopGenerationParameters(
    current: LogicalModelGenerationParameters | undefined,
    currentSources: LogicalModelGenerationParameterSources | undefined,
    incoming: LogicalModelGenerationParameters | undefined,
    incomingSources: LogicalModelGenerationParameterSources | undefined,
    force = false,
    currentEvidence?: LogicalModelGenerationParameterEvidence,
    incomingEvidence?: LogicalModelGenerationParameterEvidence,
) {
    const parameters = { ...(current || normalizeGenerationParameters({})!) } as Record<keyof LogicalModelGenerationParameters, unknown>;
    const sources: LogicalModelGenerationParameterSources = currentSources ? { ...currentSources } : inferLegacyManualSources(current);
    const drifts: LogicalModelCapabilityDrift[] = [];
    const evidence: LogicalModelGenerationParameterEvidence = { ...(currentEvidence || {}) };
    const descriptionEvidenceMissing: Array<keyof LogicalModelGenerationParameters> = [];
    let manualOverridesPreserved = 0;
    const fields = new Set<keyof LogicalModelGenerationParameters>([...(Object.keys(sources) as Array<keyof LogicalModelGenerationParameters>), ...(Object.keys(incomingSources || {}) as Array<keyof LogicalModelGenerationParameters>)]);
    for (const field of fields) {
        const source = sources[field];
        const nextSource = incomingSources?.[field];
        const upstream = incoming?.[field];
        if (!force && source === "manual") {
            if (nextSource && !sameValue(parameters[field], upstream)) {
                manualOverridesPreserved += 1;
                drifts.push({ field, local: parameters[field], upstream, source: "manual", ...(nextSource === "description" ? { upstreamSource: nextSource } : {}), ...(incomingEvidence?.[field] ? { evidence: incomingEvidence[field] } : {}) });
            }
            continue;
        }
        if (source === "description" && (!nextSource || nextSource === "preset")) {
            descriptionEvidenceMissing.push(field);
        } else if (nextSource) {
            parameters[field] = cloneValue(upstream);
            sources[field] = nextSource;
            if (incomingEvidence?.[field]) evidence[field] = incomingEvidence[field];
            else delete evidence[field];
        } else if (source === "upstream" || source === "preset") {
            delete parameters[field];
            delete sources[field];
            delete evidence[field];
        }
    }
    return { parameters: normalizeGenerationParameters(parameters)!, sources, evidence, drifts, descriptionEvidenceMissing, manualOverridesPreserved };
}

function structuredGenerationParameters(metadata: Record<string, unknown>, category: string | undefined, modelId?: string) {
    const parameters: ParameterPatch = {};
    const sources: LogicalModelGenerationParameterSources = {};
    const set = <K extends keyof LogicalModelGenerationParameters>(field: K, value: LogicalModelGenerationParameters[K] | undefined, source: ModelMetadataSource = "upstream") => {
        if (value === undefined) return;
        parameters[field] = value as never;
        sources[field] = source;
    };
    if (category === "image" && Array.isArray(metadata.image_ratios)) {
        const ratios = stringList(metadata.image_ratios);
        set("aspectRatios", /^tvod-midjourney-v(?:7|8\.1)$/i.test(modelId || "") ? ratios.filter((ratio) => DFLOP_MIDJOURNEY_ASPECT_RATIOS.has(ratio)) : ratios);
    }
    if (category === "video") {
        if (Array.isArray(metadata.video_ratios)) set("aspectRatios", stringList(metadata.video_ratios));
        if (Array.isArray(metadata.video_resolutions)) set("resolutions", stringList(metadata.video_resolutions));
        const min = positiveNumber(metadata.video_duration_min);
        const max = positiveNumber(metadata.video_duration_max);
        if (min !== undefined && max !== undefined && min <= max) {
            set("durationMode", "range");
            set("durationRange", { min, max });
            set("supportsCustomDuration", true);
            set("customDurationRange", { min, max });
        }
    }
    const referenceInputs = enumList(metadata.reference_inputs, ["image", "video", "audio"] as const);
    if (referenceInputs) set("referenceInputs", referenceInputs);
    const maxReferenceImages = positiveInteger(metadata.max_reference_images);
    if (maxReferenceImages !== undefined) set("maxReferenceImages", maxReferenceImages);
    const videoReferenceModes = enumList(metadata.video_reference_modes, ["reference", "first_frame", "first_last"] as const);
    if (videoReferenceModes) set("videoReferenceModes", videoReferenceModes);
    return { parameters, sources };
}

function descriptionGenerationParameters(description: ReturnType<typeof parseDflopDescriptionCapabilities>, preset: LogicalModelGenerationParameters | undefined) {
    const { values } = description;
    const parameters: ParameterPatch = {};
    const sources: LogicalModelGenerationParameterSources = {};
    const evidence: LogicalModelGenerationParameterEvidence = {};
    const referenceFields = ["referenceImage", "referenceVideo", "referenceAudio"] as const;
    if (referenceFields.some((field) => values[field] !== null)) {
        const inputs = new Set(preset?.referenceInputs || []);
        for (const [field, input] of [
            ["referenceImage", "image"],
            ["referenceVideo", "video"],
            ["referenceAudio", "audio"],
        ] as const) {
            if (values[field] === true) inputs.add(input);
            if (values[field] === false) inputs.delete(input);
        }
        parameters.referenceInputs = [...inputs];
        sources.referenceInputs = "description";
        evidence.referenceInputs = firstEvidence(description.evidence, referenceFields) || "DFLOP description";
    }
    if (typeof values.maxReferenceImages === "number") {
        parameters.maxReferenceImages = values.maxReferenceImages;
        sources.maxReferenceImages = "description";
        if (description.evidence.maxReferenceImages) evidence.maxReferenceImages = description.evidence.maxReferenceImages;
    }
    if (values.firstFrame !== null || values.firstLastFrame !== null) {
        const modes = new Set(preset?.videoReferenceModes || []);
        if (values.firstFrame === true) modes.add("first_frame");
        if (values.firstFrame === false) modes.delete("first_frame");
        if (values.firstLastFrame === true) modes.add("first_last");
        if (values.firstLastFrame === false) modes.delete("first_last");
        parameters.videoReferenceModes = [...modes];
        sources.videoReferenceModes = "description";
        evidence.videoReferenceModes = firstEvidence(description.evidence, ["firstLastFrame", "firstFrame"]) || "DFLOP description";
    }
    return { parameters, sources, evidence };
}

function firstEvidence(evidence: ReturnType<typeof parseDflopDescriptionCapabilities>["evidence"], fields: readonly DflopDescriptionCapabilityField[]) {
    return fields.map((field) => evidence[field]).find(Boolean);
}

function mergeDescriptionCapabilities(description: ReturnType<typeof parseDflopDescriptionCapabilities>, preset: ParameterPatch | undefined, metadata: Record<string, unknown>) {
    const values = Object.fromEntries(DFLOP_DESCRIPTION_CAPABILITY_FIELDS.map((field) => [field, null])) as DflopDescriptionCapabilitySnapshot["values"];
    const sources: NonNullable<DflopDescriptionCapabilitySnapshot["sources"]> = {};
    const evidence: NonNullable<DflopDescriptionCapabilitySnapshot["evidence"]> = {};
    if (preset) {
        const referenceInputs = new Set(preset.referenceInputs || []);
        if (referenceInputs.size) {
            values.referenceImage = referenceInputs.has("image");
            values.referenceVideo = referenceInputs.has("video");
            values.referenceAudio = referenceInputs.has("audio");
            sources.referenceImage = sources.referenceVideo = sources.referenceAudio = "preset";
        }
        if (preset.maxReferenceImages !== undefined) {
            values.maxReferenceImages = preset.maxReferenceImages;
            sources.maxReferenceImages = "preset";
        }
        const modes = new Set(preset.videoReferenceModes || []);
        if (modes.size) {
            values.firstFrame = modes.has("first_frame") || modes.has("first_last");
            values.firstLastFrame = modes.has("first_last");
            values.lastFrame = modes.has("first_last");
            sources.firstFrame = sources.firstLastFrame = sources.lastFrame = "preset";
        }
    }
    for (const field of DFLOP_DESCRIPTION_CAPABILITY_FIELDS) {
        if (description.values[field] === null) continue;
        values[field] = description.values[field];
        sources[field] = "description";
        if (description.evidence[field]) evidence[field] = description.evidence[field];
    }
    const structured = structuredDescriptionCapabilities(metadata);
    const conflicts: DflopMetadataConflict[] = [];
    for (const field of DFLOP_DESCRIPTION_CAPABILITY_FIELDS) {
        const structuredValue = structured[field];
        if (structuredValue === null) continue;
        if (description.values[field] !== null && !sameValue(description.values[field], structuredValue)) {
            conflicts.push({ field, structured: structuredValue, description: description.values[field], ...(description.evidence[field] ? { descriptionEvidence: description.evidence[field] } : {}) });
        }
        values[field] = structuredValue;
        sources[field] = "upstream";
        delete evidence[field];
    }
    return Object.keys(sources).length ? { snapshot: { values, sources, ...(Object.keys(evidence).length ? { evidence } : {}) }, conflicts } : undefined;
}

function structuredDescriptionCapabilities(metadata: Record<string, unknown>): DflopDescriptionCapabilitySnapshot["values"] {
    const values = Object.fromEntries(DFLOP_DESCRIPTION_CAPABILITY_FIELDS.map((field) => [field, null])) as DflopDescriptionCapabilitySnapshot["values"];
    const referenceInputs = enumList(metadata.reference_inputs, ["image", "video", "audio"] as const);
    if (referenceInputs) {
        values.referenceImage = referenceInputs.includes("image");
        values.referenceVideo = referenceInputs.includes("video");
        values.referenceAudio = referenceInputs.includes("audio");
    }
    setStructuredNumber(values, "maxReferenceImages", metadata.max_reference_images);
    setStructuredNumber(values, "maxReferenceVideos", metadata.max_reference_videos);
    setStructuredNumber(values, "maxReferenceAudios", metadata.max_reference_audios);
    setStructuredNumber(values, "fps", metadata.fps ?? metadata.video_fps);
    setStructuredNumber(values, "maxReferenceVideoDuration", metadata.max_reference_video_duration);
    setStructuredNumber(values, "maxTotalReferenceVideoDuration", metadata.max_total_reference_video_duration);
    setStructuredBoolean(values, "textToVideo", metadata.text_to_video);
    setStructuredBoolean(values, "imageToVideo", metadata.image_to_video);
    setStructuredBoolean(values, "videoToVideo", metadata.video_to_video);
    setStructuredBoolean(values, "generateAudio", metadata.generate_audio);
    const modes = enumList(metadata.video_reference_modes, ["reference", "first_frame", "first_last"] as const);
    if (modes) {
        values.firstFrame = modes.includes("first_frame") || modes.includes("first_last");
        values.firstLastFrame = modes.includes("first_last");
        values.lastFrame = modes.includes("first_last");
    }
    return values;
}

function setStructuredBoolean(values: DflopDescriptionCapabilitySnapshot["values"], field: DflopDescriptionCapabilityField, value: unknown) {
    if (typeof value === "boolean") values[field] = value;
}

function setStructuredNumber(values: DflopDescriptionCapabilitySnapshot["values"], field: DflopDescriptionCapabilityField, value: unknown) {
    const number = positiveNumber(value);
    if (number !== undefined) values[field] = number;
}

function normalizeGenerationParameterEvidence(value: unknown): LogicalModelGenerationParameterEvidence {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([field, evidence]) => (stringValue(evidence) ? [[field, stringValue(evidence)]] : []))) as LogicalModelGenerationParameterEvidence;
}

function normalizeDescriptionCapabilities(value: unknown): DflopDescriptionCapabilitySnapshot | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const rawValues = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? (input.values as Record<string, unknown>) : {};
    const values = Object.fromEntries(
        DFLOP_DESCRIPTION_CAPABILITY_FIELDS.map((field) => {
            const item = rawValues[field];
            return [field, typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)) ? item : null];
        }),
    ) as DflopDescriptionCapabilitySnapshot["values"];
    const rawSources = input.sources && typeof input.sources === "object" && !Array.isArray(input.sources) ? (input.sources as Record<string, unknown>) : {};
    const sources = Object.fromEntries(
        Object.entries(rawSources).filter(([field, source]) => DFLOP_DESCRIPTION_CAPABILITY_FIELDS.includes(field as DflopDescriptionCapabilityField) && (source === "upstream" || source === "description" || source === "preset")),
    ) as NonNullable<DflopDescriptionCapabilitySnapshot["sources"]>;
    const rawEvidence = input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence) ? (input.evidence as Record<string, unknown>) : {};
    const evidence = Object.fromEntries(
        Object.entries(rawEvidence).flatMap(([field, item]) => (DFLOP_DESCRIPTION_CAPABILITY_FIELDS.includes(field as DflopDescriptionCapabilityField) && stringValue(item) ? [[field, stringValue(item)]] : [])),
    ) as NonNullable<DflopDescriptionCapabilitySnapshot["evidence"]>;
    const evidenceMissing = Array.isArray(input.evidenceMissing)
        ? Array.from(new Set(input.evidenceMissing.filter((field): field is DflopDescriptionCapabilityField => typeof field === "string" && DFLOP_DESCRIPTION_CAPABILITY_FIELDS.includes(field as DflopDescriptionCapabilityField))))
        : [];
    return { values, ...(Object.keys(sources).length ? { sources } : {}), ...(Object.keys(evidence).length ? { evidence } : {}), ...(evidenceMissing.length ? { evidenceMissing } : {}) };
}

function normalizeMetadataConflicts(value: unknown): DflopMetadataConflict[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const input = item as Record<string, unknown>;
        if (typeof input.field !== "string" || !DFLOP_DESCRIPTION_CAPABILITY_FIELDS.includes(input.field as DflopDescriptionCapabilityField)) return [];
        return [
            {
                field: input.field as DflopDescriptionCapabilityField,
                structured: cloneValue(input.structured),
                description: cloneValue(input.description),
                ...(stringValue(input.descriptionEvidence) ? { descriptionEvidence: stringValue(input.descriptionEvidence) } : {}),
            },
        ];
    });
}

function inferLegacyManualSources(value: LogicalModelGenerationParameters | undefined) {
    if (!value) return {};
    return Object.fromEntries(
        Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .map(([field]) => [field, "manual"]),
    ) as LogicalModelGenerationParameterSources;
}

function pickMetadata<T extends Record<string, string>>(metadata: Record<string, unknown>, fields: T) {
    return Object.fromEntries(
        Object.entries(fields).flatMap(([upstream, local]) => {
            const value = metadata[upstream];
            return isMetadataValue(value) ? [[local, structuredClone(value)]] : [];
        }),
    );
}

function isMetadataValue(value: unknown): value is string | number | boolean | string[] | Record<string, unknown> {
    if (typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
    return Boolean(value && typeof value === "object");
}

function safeObject(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 4_000) : undefined;
}

function stringList(value: unknown) {
    return Array.isArray(value) ? Array.from(new Set(value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])))) : [];
}

function enumList<const T extends readonly string[]>(value: unknown, allowed: T): T[number][] | undefined {
    if (!Array.isArray(value)) return undefined;
    return Array.from(new Set(value.filter((item): item is T[number] => typeof item === "string" && allowed.includes(item))));
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function positiveInteger(value: unknown) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function sameValue(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
}
