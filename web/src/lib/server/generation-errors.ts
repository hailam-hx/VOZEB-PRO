import { hasInsufficientPointsError } from "@/lib/creative-generation-status";
import { readProviderError } from "@/lib/server/provider-task-config";

export type GenerationFailureCategory = "validation" | "upstream" | "persistence" | "internal";

export type GenerationFailure = {
    code: string;
    category: GenerationFailureCategory;
    message: string;
    publicMessage: string;
    actionHint: string;
    retryable: boolean;
};

export const DEFAULT_CHANNEL_CONNECT_ERROR = "生成渠道暂时无法连接，请稍后重试或联系管理员。";

export function toSafeGenerationErrorMessage(error: unknown, fallback: string) {
    const message = generationErrorMessage(error);
    if (hasInsufficientPointsError(error)) return "积分不足";
    if (isTimeoutError(error, message)) return "生成接口响应超时，请稍后重试或检查模型服务。";
    if (isFetchNetworkError(error, message)) return DEFAULT_CHANNEL_CONNECT_ERROR;
    if (isHtmlGatewayError(message)) return DEFAULT_CHANNEL_CONNECT_ERROR;
    if (containsInfrastructureDetails(message)) return /参考|素材|公网/i.test(message) ? "参考素材暂时无法提交给当前生成渠道，请重新上传或稍后重试。" : DEFAULT_CHANNEL_CONNECT_ERROR;
    return message || fallback;
}

export function imageSubmissionFailure(status: number | undefined, message: string): GenerationFailure {
    if (status !== undefined && status >= 400 && status < 500 && ![408, 425, 429].includes(status)) {
        return {
            code: "UPSTREAM_BAD_REQUEST",
            category: "upstream",
            message,
            publicMessage: "上游拒绝了当前生成参数，请调整参数或更换模型后重试。",
            actionHint: "请检查比例、尺寸、画质和参考素材是否符合当前模型要求。",
            retryable: false,
        };
    }
    return {
        code: "SUBMISSION_UNKNOWN",
        category: "upstream",
        message,
        publicMessage: status && status >= 500 ? "上游服务暂时不可用，任务提交结果暂时无法确认。" : "任务提交结果暂时无法确认。",
        actionHint: "请稍后查看任务状态；为避免重复扣费，请勿立即重复提交。",
        retryable: false,
    };
}

export function imagePersistenceFailure(message: string): GenerationFailure {
    return {
        code: "MEDIA_DOWNLOAD_TIMEOUT",
        category: "persistence",
        message,
        publicMessage: "图片已由上游生成，但保存到媒体库时超时。",
        actionHint: "上游结果已保留，请联系管理员恢复保存，无需重新生成。",
        retryable: false,
    };
}

export function referenceImageRequiredFailure(message = "当前模型要求上传且只能上传 1 张参考图"): GenerationFailure {
    return {
        code: "REFERENCE_IMAGE_REQUIRED",
        category: "validation",
        message,
        publicMessage: "当前模型需要且只能使用 1 张参考图。",
        actionHint: "请上传 1 张参考图后重新提交。",
        retryable: false,
    };
}

function generationErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (!raw.trim().startsWith("{")) return raw;
    try {
        return readProviderError(JSON.parse(raw)) || raw;
    } catch {
        return raw;
    }
}

function isHtmlGatewayError(message: string) {
    return /<!doctype\s+html|<html\b|<head>\s*<title>\s*\d{3}\b|<center>\s*<h1>\s*\d{3}\b|\bnginx\b/i.test(message);
}

function containsInfrastructureDetails(message: string) {
    return /https?:\/\/|\blocalhost\b|\b127\.0\.0\.1\b|next_public_site_url|base\s*url|api\s*key|\bdns\b|\beconn\w*\b|\benotfound\b|服务器网络|https\s*证书|代理配置/i.test(message);
}

function isTimeoutError(error: unknown, message: string) {
    const lower = message.toLowerCase();
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted due to timeout")) return true;
    if (!(error instanceof Error)) return false;
    return error.name === "TimeoutError";
}

function isFetchNetworkError(error: unknown, message: string) {
    if (message.toLowerCase() === "fetch failed") return true;
    if (!(error instanceof TypeError)) return false;
    const cause = "cause" in error ? error.cause : undefined;
    if (!cause || typeof cause !== "object") return false;
    const code = "code" in cause ? String(cause.code) : "";
    return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code);
}
