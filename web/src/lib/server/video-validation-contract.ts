import { createHash } from "node:crypto";

import type { LogicalModelGenerationParameters, SystemChannelModelConfig, SystemChannelProtocol } from "@/lib/auth/store-types";

export type VideoContractFamilyDescriptor = {
    protocol: string;
    createPath: string;
    imageToVideoPath?: string;
    queryPath: string;
    cancelPath?: string;
    requestShapeRevision: string;
    statusParserRevision: string;
    resultParserRevision: string;
    referenceModes: string[];
    billingBases: string[];
    runtimeOptionKeys: string[];
};

export type VideoContractCase = {
    id:
        | "text-to-video"
        | "image-to-video"
        | "first-frame"
        | "first-last-frame"
        | "avatar"
        | "lipsync"
        | "motion"
        | "subtitle-workflow"
        | "clip-compose-workflow"
        | "resolution"
        | "duration"
        | "ratio"
        | "audio"
        | "watermark"
        | "bearer-auth"
        | "idempotency"
        | "cancel"
        | "error-400"
        | "error-402"
        | "error-429"
        | "error-503"
        | "timeout"
        | "submission-uncertain";
    applicability: "APPLICABLE" | "NOT_APPLICABLE";
};

type ContractInput = {
    protocol: SystemChannelProtocol | string;
    modelId?: string;
    modelLabel?: string;
    operation: Partial<SystemChannelModelConfig>;
    generationParameters?: LogicalModelGenerationParameters;
    billingBases?: string[];
    runtimeOptions?: Record<string, unknown>;
};

type ContractCaseInput = Pick<ContractInput, "operation" | "generationParameters" | "runtimeOptions">;

export type VideoContractCheckResult = { status: "PASSED" | "FAILED"; reasons: string[] };

export function describeVideoContract(input: ContractInput): VideoContractFamilyDescriptor {
    const operation = input.operation;
    return {
        protocol: input.protocol,
        createPath: operation.createPath?.trim() || "",
        ...(operation.imageToVideoPath?.trim() ? { imageToVideoPath: operation.imageToVideoPath.trim() } : {}),
        queryPath: operation.queryPath?.trim() || "",
        ...(operation.cancelPath?.trim() ? { cancelPath: operation.cancelPath.trim() } : {}),
        requestShapeRevision: digest(operation.requestTemplate || ""),
        statusParserRevision: digest(operation.statusField || ""),
        resultParserRevision: digest(operation.resultField || ""),
        referenceModes: referenceModes(input).sort(),
        billingBases: uniqueSorted(input.billingBases || []),
        runtimeOptionKeys: uniqueSorted(Object.keys(input.runtimeOptions || {})),
    };
}

export function videoContractFamilyFingerprint(descriptor: VideoContractFamilyDescriptor) {
    return digest(canonical(descriptor));
}

export function buildVideoContractCases(input: ContractCaseInput): VideoContractCase[] {
    const profile = input.generationParameters;
    const operation = input.operation;
    const modes = new Set(profile?.videoReferenceModes || []);
    const references = new Set(profile?.referenceInputs || []);
    const runtimeKeys = new Set(Object.keys(input.runtimeOptions || {}));
    const template = operation.requestTemplate || "";
    const applicable = (id: VideoContractCase["id"], enabled = true): VideoContractCase => ({ id, applicability: enabled ? "APPLICABLE" : "NOT_APPLICABLE" });
    return [
        applicable("text-to-video"),
        applicable("image-to-video", operation.supportsReferenceImage === true && references.has("image") && modes.has("reference")),
        applicable("first-frame", modes.has("first_frame")),
        applicable("first-last-frame", modes.has("first_last")),
        applicable("resolution", Boolean(profile?.resolutions.length)),
        applicable("duration", Boolean(profile?.durationSeconds.length || profile?.durationRange || profile?.customDurationRange)),
        applicable("ratio", Boolean(profile?.aspectRatios.length)),
        applicable("audio", references.has("audio") || runtimeKeys.has("generateAudio") || template.includes("generate_audio") || template.includes("generateAudio")),
        applicable("watermark", runtimeKeys.has("watermark") || template.includes("watermark")),
        applicable("bearer-auth"),
        applicable("idempotency"),
        applicable("cancel", Boolean(operation.cancelPath)),
        applicable("error-400"),
        applicable("error-402"),
        applicable("error-429"),
        applicable("error-503"),
        applicable("timeout"),
        applicable("submission-uncertain"),
    ];
}

export function validateStaticVideoContract(input: ContractCaseInput): VideoContractCheckResult {
    const reasons: string[] = [];
    if (!input.operation.createPath?.trim()) reasons.push("CREATE_PATH_MISSING");
    if (!input.operation.queryPath?.trim()) reasons.push("QUERY_PATH_MISSING");
    if (!input.operation.requestTemplate?.trim()) reasons.push("REQUEST_TEMPLATE_MISSING");
    if (!input.operation.statusField?.trim()) reasons.push("STATUS_FIELD_MISSING");
    if (!input.operation.resultField?.trim()) reasons.push("RESULT_FIELD_MISSING");
    return { status: reasons.length ? "FAILED" : "PASSED", reasons };
}

function referenceModes(input: ContractInput) {
    const profile = input.generationParameters;
    const operation = input.operation;
    return uniqueSorted([
        ...(profile?.videoReferenceModes || []),
        ...(profile?.referenceInputs || []).map((value) => `input:${value}`),
        ...(operation.supportsReferenceImage ? ["operation:image"] : []),
        ...(operation.supportsReferenceVideo ? ["operation:video"] : []),
        ...(operation.supportsReferenceAudio ? ["operation:audio"] : []),
    ]);
}

function uniqueSorted(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function digest(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
