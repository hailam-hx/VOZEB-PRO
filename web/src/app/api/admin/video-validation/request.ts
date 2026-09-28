import type { StartVideoValidationRunRequest, VideoValidationPreviewRequest } from "@/lib/video-validation";

export function parsePreviewRequest(value: unknown): VideoValidationPreviewRequest {
    const input = record(value);
    rejectExtra(input, ["mode", "modelIds", "bindingIds", "maxBudgetHotxCredits", "concurrency", "readyPricingOnly"]);
    if (input.mode !== "contract_only" && input.mode !== "family_sample" && input.mode !== "changed_models" && input.mode !== "all_models_minimum") throw new Error("验收模式无效");
    if (input.readyPricingOnly !== true) throw new Error("验收仅允许使用计价状态 READY 的模型");
    return { mode: input.mode, maxBudgetHotxCredits: text(input.maxBudgetHotxCredits, "最大预算"), concurrency: integer(input.concurrency, "并发数"), readyPricingOnly: true, ...stringList(input.modelIds, "模型"), ...bindingList(input.bindingIds) };
}

export function parseStartRequest(value: unknown): StartVideoValidationRunRequest {
    const input = record(value);
    rejectExtra(input, ["previewRevision", "mode", "modelIds", "bindingIds", "maxBudgetHotxCredits", "concurrency", "readyPricingOnly"]);
    return { ...parsePreviewRequest(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "previewRevision"))), previewRevision: text(input.previewRevision, "预览版本") };
}

function record(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求数据无效");
    return value as Record<string, unknown>;
}
function rejectExtra(input: Record<string, unknown>, allowed: string[]) {
    const extra = Object.keys(input).find((key) => !allowed.includes(key));
    if (extra) throw new Error(`字段 ${extra} 不允许提交`);
}
function text(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label}无效`);
    return value.trim();
}
function integer(value: unknown, label: string) {
    if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label}无效`);
    return Number(value);
}
function stringList(value: unknown, label: string): Pick<VideoValidationPreviewRequest, "modelIds"> {
    if (value === undefined) return {};
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${label}列表无效`);
    return { modelIds: value.map((item) => String(item).trim()) };
}
function bindingList(value: unknown): Pick<VideoValidationPreviewRequest, "bindingIds"> {
    if (value === undefined) return {};
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error("绑定列表无效");
    return { bindingIds: value.map((item) => String(item).trim()) };
}
