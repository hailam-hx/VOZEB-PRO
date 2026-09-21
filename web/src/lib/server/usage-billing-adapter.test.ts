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
    it("joins legal multiline SSE usage before normalizing cached input tokens", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 128 }, rateCard: textRate });
        const accumulator = createStreamingUsageAccumulator("text", requestUsage);
        const bytes = new TextEncoder().encode('event: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":{"usage":{"input_tokens":5,"output_tokens":2,\r\ndata: "input_tokens_details":{"cached_tokens":1}}}}\r\n\r\n');
        for (const byte of bytes) accumulator.push(Uint8Array.of(byte));
        expect(accumulator.finish()).toMatchObject({ source: "actual", inputTokens: "4", cachedInputTokens: "1", outputTokens: "2" });
    });
    it("rejects text before upstream when no request or model output maximum proves the reserve", () => {
        expect(() => normalizeProxyBillableRequest({ capability: "text", payload: { model: "writer", messages: [{ role: "user", content: "hello" }] }, rateCard: textRate })).toThrow("最大输出 token");
    });

    it("uses a model output limit and a conservative measured input upper bound", () => {
        const normalized = normalizeProxyBillableRequest({ capability: "text", payload: { model: "writer", messages: [{ role: "user", content: "hello" }] }, rateCard: textRate, inputLimits: { maxOutputTokens: "128" } });

        expect(normalized).toMatchObject({ capability: "text", source: "request", request: "1", inputTokens: "5", cachedInputTokens: "0", maxOutputTokens: "128", characters: "5" });
    });

    it("uses provider token usage and rejects response bytes as derived token usage", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { messages: [{ role: "user", content: "hello" }], max_tokens: 128 }, rateCard: textRate });

        expect(deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { usage: { prompt_tokens: 7, completion_tokens: 3 } } })).toMatchObject({ source: "actual", inputTokens: "7", outputTokens: "3" });
        expect(deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { choices: [{ message: { content: "你好" } }] } })).toBeUndefined();
    });

    it("separates cached input tokens and normalizes request characters and total megapixels", () => {
        const textRequest = normalizeProxyBillableRequest({
            capability: "text",
            payload: { messages: [{ role: "user", content: "hello" }], max_tokens: 128 },
            rateCard: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
        });
        const actual = deriveProxyBillableUsage({ capability: "text", requestUsage: textRequest, payload: { usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } } });
        const image = normalizeProxyBillableRequest({
            capability: "image",
            payload: { prompt: "海报", n: 2, size: "1920x1080" },
            rateCard: { version: 1, components: [{ id: "megapixels", dimension: "megapixels", unitPrice: "1" }] },
        });

        expect(textRequest).toMatchObject({ request: "1", characters: "5", cachedInputTokens: "0" });
        expect(actual).toMatchObject({ inputTokens: "6", cachedInputTokens: "4", outputTokens: "3", request: "1" });
        expect(image).toMatchObject({ request: "1", count: "2", characters: "2", megapixels: "4.1472" });
    });

    it("normalizes supported nested and aliased video pricing parameters", () => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "duration", dimension: "durationSeconds" as const, unitPrice: "0.08", when: { resolution: "1080p", quality: "cinematic", format: "mp4" } }],
        };

        expect(
            normalizeProxyBillableRequest({
                capability: "video",
                payload: { parameters: { durationSeconds: 6, resolution: "1080p", quality: "cinematic", format: "mp4" } },
                rateCard,
            }),
        ).toMatchObject({ durationSeconds: "6", resolution: "1080p", quality: "cinematic", format: "mp4" });
        expect(
            normalizeProxyBillableRequest({
                capability: "video",
                payload: { seconds: 8, resolution_name: "1080p", vquality: "cinematic", format: "mp4" },
                rateCard,
            }),
        ).toMatchObject({ durationSeconds: "8", resolution: "1080p", quality: "cinematic", format: "mp4" });
    });

    it("derives canonical video quality from a resolution-only provider payload", () => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "duration-480", dimension: "durationSeconds" as const, unitPrice: "0.0829", when: { quality: "480" } }],
        };

        expect(
            normalizeProxyBillableRequest({
                capability: "video",
                payload: { duration: 5, resolution: "480p" },
                rateCard,
            }),
        ).toMatchObject({ durationSeconds: "5", resolution: "480p", quality: "480" });
    });

    it("reserves an administrator-configured maximum for inherited video duration", () => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "duration-480", dimension: "durationSeconds" as const, unitPrice: "0.1009", when: { quality: "480" } }],
        };

        expect(
            normalizeProxyBillableRequest({
                capability: "video",
                payload: { duration: -1, ratio: "adaptive", resolution: "480p" },
                rateCard,
                inputLimits: { maxDurationSeconds: "30" },
            }),
        ).toMatchObject({ durationSeconds: "30", resolution: "480p", quality: "480" });
    });

    it("accumulates streaming usage incrementally without retaining response chunks", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { messages: [{ role: "user", content: "hello" }], max_tokens: 128 }, rateCard: textRate });
        const accumulator = createStreamingUsageAccumulator("text", requestUsage);

        accumulator.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'));
        accumulator.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n\n'));

        expect(accumulator.finish()).toMatchObject({ capability: "text", source: "actual", request: "1", inputTokens: "7", cachedInputTokens: "0", outputTokens: "3", characters: "5" });
    });

    it("does not turn streamed response bytes into billable output tokens", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { messages: [{ role: "user", content: "hello" }], max_tokens: 128 }, rateCard: textRate });
        const accumulator = createStreamingUsageAccumulator("text", requestUsage);

        accumulator.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'));

        expect(accumulator.finish()).toBeUndefined();
    });

    it("merges Claude split usage as cumulative counters without double-counting cache tokens", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 128 }, rateCard: textRate });
        const accumulator = createStreamingUsageAccumulator("text", requestUsage);
        accumulator.push(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7,"cache_read_input_tokens":12,"cache_creation_input_tokens":3}}}\n\n'));
        expect(accumulator.finish()).toBeUndefined();
        accumulator.push(new TextEncoder().encode('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":0}}\n\n'));
        expect(accumulator.finish()).toMatchObject({ source: "actual", inputTokens: "10", cachedInputTokens: "12", outputTokens: "0" });
        accumulator.push(new TextEncoder().encode('data: {"type":"message_delta","usage":{"output_tokens":2}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n'));
        expect(accumulator.finish()).toMatchObject({ source: "actual", inputTokens: "10", cachedInputTokens: "12", outputTokens: "4" });
    });

    it("normalizes nested Responses usage and replaces cumulative totals across chunk boundaries", () => {
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 128 }, rateCard: textRate });
        const accumulator = createStreamingUsageAccumulator("text", requestUsage);
        accumulator.push(
            new TextEncoder().encode('data: {"type":"response.in_progress","response":{"usage":{"input_tokens":5,"output_tokens":1,"input_tokens_details":{"cached_tokens":1}}}}\n\ndata: {"type":"response.failed","response":{"usage":{"input_'),
        );
        accumulator.push(new TextEncoder().encode('tokens":5,"output_tokens":2,"input_tokens_details":{"cached_tokens":1}},"error":{"message":"fixture"}}}\n\n'));
        expect(accumulator.finish()).toMatchObject({ source: "actual", inputTokens: "4", cachedInputTokens: "1", outputTokens: "2" });
        expect(accumulator.finish()).toMatchObject({ inputTokens: "4", outputTokens: "2" });
    });

    it.each([{ message: { usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 1 } } }, { response: { usage: { input_tokens: 5, output_tokens: 2, input_tokens_details: { cached_tokens: 1 } } } }])(
        "uses the same native usage normalization for buffered payload %#",
        (payload) => {
            const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 128 }, rateCard: textRate });
            expect(deriveProxyBillableUsage({ capability: "text", requestUsage, payload })).toMatchObject({ source: "actual", inputTokens: "4", cachedInputTokens: "1", outputTokens: "2" });
        },
    );

    it("prices provider usage from the frozen cost rate without credit rounding", () => {
        expect(calculateProviderUsageCost(textRate, { capability: "text", source: "actual", inputTokens: "2", outputTokens: "2" })).toBe("0.000006");
    });
});
