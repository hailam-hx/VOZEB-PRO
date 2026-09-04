import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import { resolveCreativeGenerationCapability, type CreativeGenerationCapabilityModel, type CreativeGenerationCapabilityReason, type CreativeGenerationCapabilityState } from "@/lib/creative-generation-capabilities";
import { generationParametersCompatible, unionGenerationParameters, type NormalizedGenerationRequest } from "@/lib/generation-parameters";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";

import type { CanvasGenerationMode } from "../types";

type CanvasGenerationReference = { type: LogicalModelGenerationParameters["referenceInputs"][number] };

export type CanvasGenerationCapabilityIssue = {
    reason: CreativeGenerationCapabilityReason;
    field: keyof NormalizedGenerationRequest | "generationParameters";
    value?: unknown;
};

export type CanvasGenerationPreflightResult = { compatible: true; request: NormalizedGenerationRequest } | { compatible: false; request: NormalizedGenerationRequest; issue: CanvasGenerationCapabilityIssue };

export function resolveCanvasGenerationCapability(config: AiConfig, mode: CanvasGenerationMode, model: string): CreativeGenerationCapabilityState {
    if (mode === "text") return { reason: "unsupported" };
    const requested = normalizedModel(model);
    const logicalModel = config.logicalModels.find((item) => item.enabled && item.capability === mode && normalizedModel(item.id) === requested);
    if (!logicalModel) return { reason: "unconfigured" };
    const parameters = unionGenerationParameters(logicalModel);
    return parameters ? { parameters, reason: "unsupported" } : { reason: "unconfigured" };
}

export function resolveCanvasAgentGenerationCapability(
    models: readonly CreativeGenerationCapabilityModel[],
    selectedModels: readonly CreativeGenerationCapabilityModel[],
    capability: CreativeGenerationCapabilityModel["capability"],
    smartPlanning: boolean,
): CreativeGenerationCapabilityState {
    return resolveCreativeGenerationCapability({ models, selectedModels, capability, smartPlanning });
}

export function canvasGenerationPreflight({
    mode,
    config,
    capability,
    references = [],
    videoReferenceMode,
}: {
    mode: CanvasGenerationMode;
    config: AiConfig;
    capability: CreativeGenerationCapabilityState;
    references?: readonly CanvasGenerationReference[];
    videoReferenceMode?: LogicalModelGenerationParameters["videoReferenceModes"][number];
}): CanvasGenerationPreflightResult {
    if (mode === "text") return { compatible: true, request: {} };
    const request = canvasGenerationRequest(mode, config, references, videoReferenceMode);
    const compatibility = generationParametersCompatible(capability.parameters, request);
    if (compatibility.compatible) return { compatible: true, request };
    return {
        compatible: false,
        request,
        issue: {
            reason: compatibility.field === "generationParameters" ? "unconfigured" : capability.reason,
            field: compatibility.field,
            ...("field" in compatibility && compatibility.field in request ? { value: request[compatibility.field as keyof NormalizedGenerationRequest] } : {}),
        },
    };
}

function canvasGenerationRequest(
    mode: Exclude<CanvasGenerationMode, "text">,
    config: AiConfig,
    references: readonly CanvasGenerationReference[],
    videoReferenceMode?: LogicalModelGenerationParameters["videoReferenceModes"][number],
): NormalizedGenerationRequest {
    const referenceInputs = Array.from(new Set(references.map((reference) => reference.type)));
    const referenceCount = references.filter((reference) => reference.type === "image").length;
    const size = concreteText(config.size);
    const dimensions = size ? normalizePixelSize(size) : "";
    const common: NormalizedGenerationRequest = {
        ...(referenceInputs.length ? { referenceInputs } : {}),
        ...(referenceCount ? { referenceCount } : {}),
        ...(dimensions ? { pixelSize: dimensions } : size ? { aspectRatio: size } : {}),
    };
    if (mode === "image") {
        const quality = concreteText(config.quality);
        const batchSize = concreteNumber(config.count);
        return { ...common, ...(quality ? { quality } : {}), ...(batchSize !== undefined ? { batchSize } : {}) };
    }
    if (mode === "video") {
        const resolution = concreteText(config.vquality);
        const durationSeconds = concreteNumber(config.videoSeconds);
        return {
            ...common,
            ...(resolution ? { resolution } : {}),
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            ...(videoReferenceMode ? { videoReferenceMode } : {}),
        };
    }
    const format = concreteText(config.audioFormat);
    const speed = concreteNumber(config.audioSpeed);
    return { ...(format ? { format } : {}), ...(speed !== undefined ? { speed } : {}) };
}

function normalizedModel(value: string) {
    return modelOptionName(value)
        .replace(/^models\//i, "")
        .trim()
        .toLowerCase();
}

function concreteText(value: unknown) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return !text || text.toLowerCase() === "auto" ? "" : text;
}

function concreteNumber(value: unknown) {
    if (typeof value === "string" && (!value.trim() || value.trim().toLowerCase() === "auto")) return undefined;
    if (value === undefined || value === null || value === "") return undefined;
    return Number(value);
}

function normalizePixelSize(value: string) {
    const match = value.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (!match) return "";
    const width = Number(match[1]);
    const height = Number(match[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? `${width}x${height}` : "";
}
