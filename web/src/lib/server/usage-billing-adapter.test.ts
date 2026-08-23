import { describe, expect, it } from "vitest";

import { calculateProviderUsageCost, createStreamingUsageAccumulator, deriveProxyBillableUsage, normalizeProxyBillableRequest } from "./usage-billing-adapter";

const textRate = {
    version: 1 as const,
    components: [
        { id: "input", dimension: "inputTokens" as const, unitPrice: "0.001", per: "1000" },
        { id: "output", dimension: "outputTokens" as const, unitPrice: "0.002", per: "1000" },
    ],
};

describe("usage billing protocol adapters", () => {
    it("rejects text before upstream when no request or model output maximum proves the reserve", () => {
        expect(() => normalizeProxyBillableRequest({ capability: "text", payload: { model: "writer", messages: [{ role: "user", content: "hello" }] }, rateCard: textRate })).toThrow("最大输出 token");
    });

    it("uses a model output limit and a conservative measured input upper bound", () => {
        const normalized = normalizeProxyBillableRequest({ capability: "text", payload: { model: "writer", messages: [{ role: "user", content: "hello" }] }, rateCard: textRate, inputLimits: { maxOutputTokens: "128" } });

        expect(normalized).toEqual({ capability: "text", source: "request", inputTokens: "5", maxOutputTokens: "128" });
    });

    it("prefers provider actual usage and otherwise derives text usage from output bytes", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { messages: [{ role: "user", content: "hello" }], max_tokens: 128 }, rateCard: textRate });

        expect(deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { usage: { prompt_tokens: 7, completion_tokens: 3 } } })).toMatchObject({ source: "actual", inputTokens: "7", outputTokens: "3" });
        expect(deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { choices: [{ message: { content: "ok" } }] } })).toMatchObject({ source: "derived", inputTokens: "5", outputTokens: "2" });
    });

    it("accumulates streaming usage incrementally without retaining response chunks", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { messages: [{ role: "user", content: "hello" }], max_tokens: 128 }, rateCard: textRate });
        const accumulator = createStreamingUsageAccumulator("text", requestUsage);

        accumulator.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'));
        accumulator.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n\n'));

        expect(accumulator.finish()).toEqual({ capability: "text", source: "actual", inputTokens: "7", outputTokens: "3" });
        expect(accumulator.bufferedBytes()).toBe(0);
    });

    it("prices provider usage from the frozen cost rate without credit rounding", () => {
        expect(calculateProviderUsageCost(textRate, { capability: "text", source: "actual", inputTokens: "2", outputTokens: "2" })).toBe("0.000006");
    });
});
