import { readProviderError, readProviderString } from "@/lib/server/provider-task-config";

export const VIDEO_PROVIDER_ID_KEYS = ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId", "uuid", "task_uuid", "taskUuid", "generation_id", "generationId"];
export const VIDEO_PROVIDER_STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
export const VIDEO_PROVIDER_MEDIA_KEYS = ["video_url", "videoUrl", "media_url", "mediaUrl", "content_url", "contentUrl", "output_url", "outputUrl", "result_url", "resultUrl", "url", "uri"];
export const VIDEO_PROVIDER_SUCCESS = new Set(["completed", "complete", "succeeded", "success", "done", "finished"]);
export const VIDEO_PROVIDER_FAILED = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired"]);

export type VideoProviderFailureDiagnostic = {
    status: number;
    message: string;
    code?: string;
    type?: string;
    param?: string;
    requestId?: string;
};

export const VIDEO_INPUT_COPYRIGHT_RESTRICTED = "video_input_copyright_restricted";
export const VIDEO_REFERENCE_DURATION_EXCEEDED = "video_reference_duration_exceeded";
const SEEDANCE_COPYRIGHT_POLICY_CODE = "InputVideoSensitiveContentDetected.PolicyViolation";

export function parseVideoProviderJson(value: string) {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new Error("视频接口返回了无效 JSON");
    }
}

export function readVideoProviderHttpError(value: string, status: number) {
    return readVideoProviderFailureDiagnostic(value, status).message;
}

export function readVideoProviderFailureDiagnostic(value: string, status: number): VideoProviderFailureDiagnostic {
    try {
        const payload = JSON.parse(value) as unknown;
        const root = record(payload);
        const error = record(root.error);
        const message = readProviderError(payload) || `视频接口请求失败（${status}）`;
        const resolvedRequestId = requestId(root, error, message);
        return {
            status,
            message,
            ...textField(firstText(error.code, root.code), "code"),
            ...textField(firstText(error.type, root.type), "type"),
            ...textField(firstText(error.param, root.param), "param"),
            ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}),
        };
    } catch {
        const message = value.slice(0, 300) || `视频接口请求失败（${status}）`;
        const resolvedRequestId = requestId({}, {}, message);
        return { status, message, ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}) };
    }
}

export function classifyVideoProviderPublicError(input: Pick<VideoProviderFailureDiagnostic, "message"> & Partial<Pick<VideoProviderFailureDiagnostic, "code" | "param">>) {
    if (input.code === SEEDANCE_COPYRIGHT_POLICY_CODE) return VIDEO_INPUT_COPYRIGHT_RESTRICTED;
    const message = input.message || "";
    const durationRejection =
        (!input.code || input.code === "InvalidParameter") &&
        (!input.param || input.param === "content[1]") &&
        /content\[1\].*video duration \(seconds\).*less than or equal to 30\.2.*doubao-seedance-2-5.*r2v/i.test(message);
    return durationRejection ? VIDEO_REFERENCE_DURATION_EXCEEDED : undefined;
}

export function readVideoProviderId(value: unknown) {
    return readProviderString(value, undefined, VIDEO_PROVIDER_ID_KEYS);
}

export function readVideoProviderStatus(value: unknown, configuredPath?: string) {
    return readProviderString(value, configuredPath, VIDEO_PROVIDER_STATUS_KEYS).toLowerCase();
}

export function readVideoProviderUrl(value: unknown, configuredPath?: string) {
    return readProviderString(value, configuredPath, VIDEO_PROVIDER_MEDIA_KEYS);
}

export function videoProviderMediaUrl(baseUrl: string, url: string) {
    const base = baseUrl.replace(/\/+$/, "");
    return /^https?:\/\//i.test(url) ? `${base}/_media?url=${encodeURIComponent(url)}` : `${base}/${url.replace(/^\/+/, "")}`;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textField(value: unknown, key: "code" | "type" | "param") {
    return typeof value === "string" && value.trim() ? { [key]: value.trim().slice(0, 300) } : {};
}

function firstText(...values: unknown[]) {
    return values.find((value) => typeof value === "string" && value.trim());
}

function requestId(root: Record<string, unknown>, error: Record<string, unknown>, message: string) {
    const value = [error.request_id, error.requestId, root.request_id, root.requestId].find((item) => typeof item === "string" && item.trim());
    if (typeof value === "string") return value.trim().slice(0, 300);
    return message.match(/request[ _-]?id\s*[:：]\s*([a-zA-Z0-9_-]+)/i)?.[1]?.slice(0, 300) || "";
}
