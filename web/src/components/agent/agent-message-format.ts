"use client";

import { useTranslations } from "next-intl";

const TECHNICAL_ERROR_PATTERN = /\{\s*"error"|request id|new_api_error|convert_request_failed|not available|backend-(?:anon|api)\/conversation failed|<!doctype\s+html|<html\b|\bnginx\b/i;
const ACTIONABLE_ERROR_PATTERN = /积分不足|余额不足|请先登录|登录(?:状态)?(?:已)?失效|没有权限|无权访问|请求过于频繁|内容(?:不符合|未通过).*审核|当前渠道无法读取站内参考素材|参考素材暂时无法提交/;

type AgentMessageKey =
    | "fallback"
    | "partialFailure"
    | "insufficientCredits"
    | "authFailed"
    | "rateLimited"
    | "timeout"
    | "connectionFailed"
    | "invalidParameters"
    | "modelUnavailable"
    | "jsonRequired"
    | "channelRejected"
    | "channelParametersRejected"
    | "signInRequired"
    | "sessionExpired"
    | "permissionDenied"
    | "contentRejected"
    | "referenceUnavailable"
    | "running"
    | "completed";
export type AgentMessageTranslator = (key: AgentMessageKey) => string;

const defaultMessages: Record<AgentMessageKey, string> = {
    fallback: "Agent could not complete this task. Switch models or try again later.",
    partialFailure: "Some creation tasks could not be completed. Adjust the request and try again.",
    insufficientCredits: "Insufficient credits",
    authFailed: "The current channel could not authenticate. Ask an administrator to check the API key and model permissions.",
    rateLimited: "Too many requests. Try again later.",
    timeout: "The model response timed out. Try again later.",
    connectionFailed: "Could not connect to the model service. Try again later.",
    invalidParameters: "The model does not support the current request parameters. Check the model and generation settings.",
    modelUnavailable: "The current model is unavailable. Switch models or try again later.",
    jsonRequired: "This video channel requires application/json. Ask an administrator to select a matching built-in protocol or configure a custom request template.",
    channelRejected: "The current channel rejected the request. Ask an administrator to check the API key and model permissions.",
    channelParametersRejected: "The current channel rejected the request parameters. Ask an administrator to verify the protocol and model capabilities.",
    signInRequired: "Sign in to continue.",
    sessionExpired: "Your sign-in session expired. Sign in again.",
    permissionDenied: "You do not have permission to perform this action.",
    contentRejected: "The content did not pass review. Adjust the request and try again.",
    referenceUnavailable: "The current channel cannot use these reference assets. Try another model or contact an administrator.",
    running: "Running the creation task…",
    completed: "Creation task completed.",
};

const defaultTranslate: AgentMessageTranslator = (key) => defaultMessages[key];

export function useAgentMessageFormatter() {
    const t = useTranslations("common.agentErrors");
    const translate: AgentMessageTranslator = (key) => t(key);
    return {
        formatMessage: (text: string) => formatAgentMessageText(text, translate),
        friendlyError: (value: unknown) => friendlyAgentError(value, translate),
    };
}

export function friendlyAgentError(value: unknown, translate: AgentMessageTranslator = defaultTranslate) {
    const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
    const actionable = actionableErrorMessage(message, translate);
    if (actionable) return actionable;
    const classified = classifiedTechnicalError(message, translate);
    if (classified) return classified;
    if (!message) return translate("fallback");
    if (/任务依赖无法继续执行/.test(message)) return translate("partialFailure");
    return message;
}

export function formatAgentMessageText(text: string, translate: AgentMessageTranslator = defaultTranslate) {
    if (isErrorPayload(text)) {
        const actionable = actionableErrorMessage(text, translate);
        if (actionable) return actionable;
        const classified = classifiedTechnicalError(text, translate);
        if (classified) return classified;
    }
    const legacyTextResult = text.match(/^已完成 1 个创作任务。\s*「[^」]+」已完成：\s*\*\*(.+?)\*\*/s);
    if (legacyTextResult?.[1]) return legacyTextResult[1].trim();
    if (/^正在执行任务 task-[^（]+（第 \d+ 次）…?$/.test(text.trim())) return translate("running");
    if (text.trim() === "任务依赖无法继续执行") return translate("partialFailure");
    if (text.trim() === "创作计划与后台生成任务已全部完成。") return translate("completed");
    const planningBoundary = ["\n\n我的选择：", "\n\n已安排 "].map((value) => text.indexOf(value)).filter((index) => index >= 0);
    const visibleText = planningBoundary.length ? text.slice(0, Math.min(...planningBoundary)) : text;
    return formatAgentArtifactText(visibleText)
        .split("\n")
        .filter((line) => !/^「[^」]+」已生成(?:并返回画布)?。$/.test(line.trim()))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function formatAgentArtifactText(value: string) {
    if (!/:::writing\{[^}\r\n]*\}/.test(value)) return value.trim();
    return value
        .replace(/:::writing\{[^}\r\n]*\}([\s\S]*?):::/g, "$1")
        .replace(/:::writing\{[^}\r\n]*\}[ \t]*(?:\r?\n)?/g, "")
        .replace(/(?:\r?\n)?[ \t]*:::[ \t]*$/g, "")
        .trim();
}

function isErrorPayload(value: string) {
    const text = value.trim();
    return text.startsWith("{") || /^(?:<!doctype\s+html|<html\b)/i.test(text);
}

function actionableErrorMessage(value: string, translate: AgentMessageTranslator) {
    const text = value.trim();
    if (!text.startsWith("{")) return normalizeActionableError(text, translate);
    try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        const error = payload.error;
        const response = payload.response && typeof payload.response === "object" ? (payload.response as Record<string, unknown>) : undefined;
        const responseError = response?.error;
        const candidates = [payload.msg, payload.message, error, objectMessage(error), response?.msg, responseError, objectMessage(responseError)];
        return candidates.map((candidate) => (typeof candidate === "string" ? normalizeActionableError(candidate.trim(), translate) : "")).find(Boolean) || normalizeActionableError(text, translate);
    } catch {
        return "";
    }
}

function classifiedTechnicalError(value: string, translate: AgentMessageTranslator) {
    const message = extractErrorMessage(value);
    if (!message) return "";
    if (/积分不足|余额不足/.test(message)) return translate("insufficientCredits");
    if (/status\s*[=:]\s*(401|403)|unauthorized|forbidden|鉴权失败|api\s*key|密钥/i.test(message)) return translate("authFailed");
    if (/status\s*[=:]\s*429|rate.?limit|限流|请求过于频繁/i.test(message)) return translate("rateLimited");
    if (/timeout|timed\s*out|超时|响应超时/i.test(message)) return translate("timeout");
    if (/network|fetch failed|econn|enotfound|dns|证书|连接失败|无法连接|服务器网络/i.test(message)) return translate("connectionFailed");
    if (/status\s*[=:]\s*4\d{2}|invalid|unsupported|参数(?:错误|无效|不支持)|请求参数|seedance-reference-/i.test(message)) return translate("invalidParameters");
    if (/status\s*[=:]\s*5\d{2}|not available|convert_request_failed|backend-(?:anon|api)\/conversation failed|<!doctype\s+html|<html\b|\bnginx\b|request id|new_api_error/i.test(message)) {
        return translate("modelUnavailable");
    }
    return TECHNICAL_ERROR_PATTERN.test(value) ? translate("modelUnavailable") : "";
}

function extractErrorMessage(value: string) {
    const text = value.trim();
    if (!text) return "";
    if (!text.startsWith("{")) return text;
    try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        const error = payload.error;
        const response = payload.response && typeof payload.response === "object" ? (payload.response as Record<string, unknown>) : undefined;
        const responseError = response?.error;
        return [payload.msg, payload.message, error, objectMessage(error), response?.msg, responseError, objectMessage(responseError)].map((candidate) => (typeof candidate === "string" ? candidate.trim() : "")).find(Boolean) || text;
    } catch {
        return text;
    }
}

function objectMessage(value: unknown) {
    return value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string" ? String((value as { message: string }).message) : "";
}

function normalizeActionableError(message: string, translate: AgentMessageTranslator) {
    if (/积分不足|余额不足/.test(message)) return translate("insufficientCredits");
    if (/must use application\/json|requires? application\/json|content[- ]type[^\n]*application\/json/i.test(message)) return translate("jsonRequired");
    if (/\b(?:unauthorized|forbidden|permission denied)\b|未授权|权限不足|无权调用/i.test(message)) return translate("channelRejected");
    if (/\b(?:invalid|unsupported) (?:request|parameter|field|argument)\b|参数(?:错误|无效|不支持)|不支持的参数/i.test(message)) return translate("channelParametersRejected");
    if (/请先登录/.test(message)) return translate("signInRequired");
    if (/登录(?:状态)?(?:已)?失效/.test(message)) return translate("sessionExpired");
    if (/没有权限|无权访问/.test(message)) return translate("permissionDenied");
    if (/请求过于频繁/.test(message)) return translate("rateLimited");
    if (/内容(?:不符合|未通过).*审核/.test(message)) return translate("contentRejected");
    if (/当前渠道无法读取站内参考素材|参考素材暂时无法提交/.test(message)) return translate("referenceUnavailable");
    return ACTIONABLE_ERROR_PATTERN.test(message) ? translate("fallback") : "";
}
