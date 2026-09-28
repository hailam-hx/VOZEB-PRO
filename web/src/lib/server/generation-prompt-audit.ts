export type PromptAudit = { originalPrompt: string; executionPrompt: string; manualPromptEnhancementEnabled: boolean };

export function auditGenerationPrompt(input: { audit?: PromptAudit; strict?: boolean; body: RequestInit["body"]; capability: "image" | "video" | "audio"; channelId?: string; model: string }) {
    if (!input.audit) {
        if (input.strict) throw new Error("缺少手动模型 Prompt 审计数据，已阻止上游请求");
        return;
    }
    const promptValues = promptsFromBody(input.body);
    const upstreamPrompt = promptValues[0];
    console.info("generation_prompt_audit", { ...input.audit, upstreamPrompt, capability: input.capability, channelId: input.channelId, model: input.model });
    const originalPrompt = input.audit.originalPrompt;
    if (input.strict && (!promptValues.length || promptValues.some((prompt) => prompt !== originalPrompt))) throw new Error("手动模型 Prompt 与用户原文不一致，已阻止上游请求");
}

function promptsFromBody(body: RequestInit["body"]): string[] {
    if (body instanceof FormData) return body.getAll("prompt").filter((value): value is string => typeof value === "string");
    if (typeof body !== "string") return [];
    try {
        const find = (value: unknown): string[] => {
            if (Array.isArray(value)) return value.flatMap(find);
            if (!value || typeof value !== "object") return [];
            const record = value as Record<string, unknown>;
            return Object.entries(record).flatMap(([key, item]) => (typeof item === "string" && (key === "prompt" || key === "text" || key === "input" || key === "content") ? [item] : find(item)));
        };
        return find(JSON.parse(body));
    } catch {
        return [];
    }
}
