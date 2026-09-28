import { describe, expect, it } from "vitest";

import {
    AuthoritativeVideoUsageError,
    calculateProviderUsageCost,
    createStreamingUsageAccumulator,
    deriveProxyBillableUsage,
    normalizeAuthoritativeVideoUsage,
    normalizeProxyBillableRequest,
    validateSignedImageQualityRequest,
    videoTokenBillingRequestContext,
} from "./usage-billing-adapter";
import { normalizeImageQualityProfile } from "@/lib/image-quality-profile";

const textRate = {
    version: 1 as const,
    components: [
        { id: "input", dimension: "inputTokens" as const, unitPrice: "0.001", per: "1000" },
        { id: "output", dimension: "outputTokens" as const, unitPrice: "0.002", per: "1000" },
    ],
};

describe("usage billing protocol adapters", () => {
    it("validates the real image request and applies the authoritative fixed output count before hold", () => {
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "prompt_flag",
            selectionMode: "explicit",
            source: "provider_preset",
            defaultValue: "high",
            options: [{ value: "high", label: "高清", effect: { type: "prompt_flag", promptSuffix: "--hd", mutexGroup: "midjourney-quality" } }],
            validation: { status: "VALID", reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" },
        })!;
        const context = {
            bindingId: "binding-mj",
            qualityProfileRevision: profile.profileRevision,
            optionRevision: profile.options[0].optionRevision,
            saleRateCardRevision: "sale-v1",
            selectedQualityValue: "high",
            billableOutputCount: 4,
        };
        const rateCard = { version: 1 as const, revision: "sale-v1", components: [{ id: "image", dimension: "count" as const, unitPrice: "1" }] };
        const usage = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "cat --hd", n: 1, size: "1024x1024" }, rateCard });

        expect(validateSignedImageQualityRequest({ usage, payload: { prompt: "cat --hd", n: 1, size: "1024x1024" }, context, profile, saleRateCardRevision: "sale-v1" })).toMatchObject({ count: "4", resolution: "1024x1024", megapixels: "4.194304" });
        expect(() => validateSignedImageQualityRequest({ usage, payload: { prompt: "cat --sd", n: 1, size: "1024x1024" }, context, profile, saleRateCardRevision: "sale-v1" })).toThrow("画质执行参数与签名不一致");
    });

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

    it("prices image input references independently from output count", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "output", dimension: "count" as const, basis: "IMAGE_OUTPUT" as const, unitPrice: "2" },
                { id: "input", dimension: "inputImageCount" as const, basis: "IMAGE_INPUT" as const, unitPrice: "0.5" },
            ],
        };
        const withoutReference = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", n: 2, size: "1024x1024" }, rateCard });
        const withReferences = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", n: 2, size: "1024x1024", image_urls: ["a", "b", "c"] }, rateCard });

        expect(withoutReference.inputImageCount).toBe("0");
        expect(withReferences.inputImageCount).toBe("3");
        expect(calculateProviderUsageCost(rateCard, withReferences)).toBe("5.5");
    });

    it.each([
        [0, "0"],
        [1, "0"],
        [2, "0.5"],
        [5, "2"],
    ])("applies one free Seedream reference before charging %i input images", (references, expected) => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "input", dimension: "inputImageCount" as const, basis: "IMAGE_INPUT" as const, unitPrice: "0.5", freeQuantity: "1" }],
        };
        const usage = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", image_urls: Array.from({ length: references }, (_, index) => `image-${index}`) }, rateCard });

        expect(calculateProviderUsageCost(rateCard, usage)).toBe(expected);
    });

    it("does not leak a provider-specific free reference allowance to Qwen", () => {
        const rateCard = { version: 1 as const, components: [{ id: "input", dimension: "inputImageCount" as const, basis: "IMAGE_INPUT" as const, unitPrice: "0.5" }] };
        const usage = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", image_urls: ["image-0"] }, rateCard });

        expect(calculateProviderUsageCost(rateCard, usage)).toBe("0.5");
    });

    it("selects exactly one output image tier from canonical dimensions", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "normal", dimension: "count" as const, basis: "IMAGE_OUTPUT" as const, unitPrice: "1", when: { megapixelTier: "normal" }, megapixelThreshold: "2.36" },
                { id: "large", dimension: "count" as const, basis: "IMAGE_LARGE" as const, unitPrice: "2", when: { megapixelTier: "large" }, megapixelThreshold: "2.36" },
            ],
        };
        const normal = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", n: 1, size: "1536x1536" }, rateCard });
        const large = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", n: 1, size: "2048x2048" }, rateCard });

        expect(normal.megapixelTier).toBe("normal");
        expect(large.megapixelTier).toBe("large");
        expect(calculateProviderUsageCost(rateCard, normal)).toBe("1");
        expect(calculateProviderUsageCost(rateCard, large)).toBe("2");
    });

    it("keeps Seedream's exact 2.61 megapixel threshold in the normal tier", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "normal", dimension: "count" as const, basis: "IMAGE_OUTPUT" as const, unitPrice: "1", when: { megapixelTier: "normal" }, megapixelThreshold: "2.61" },
                { id: "large", dimension: "count" as const, basis: "IMAGE_LARGE" as const, unitPrice: "2", when: { megapixelTier: "large" }, megapixelThreshold: "2.61" },
            ],
        };
        const boundary = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture", n: 1, size: "2610x1000" }, rateCard });

        expect(boundary.megapixelTier).toBe("normal");
        expect(calculateProviderUsageCost(rateCard, boundary)).toBe("1");
    });

    it("holds Seedream at the large tier when size is missing and settles downward from actual output size", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                {
                    id: "normal",
                    dimension: "count" as const,
                    basis: "IMAGE_OUTPUT" as const,
                    unitPrice: "1",
                    operationScope: "standalone_image_generation" as const,
                    when: { megapixelTier: "normal" },
                    megapixelThreshold: "2.61",
                    missingMegapixelTier: "large" as const,
                },
                {
                    id: "large",
                    dimension: "count" as const,
                    basis: "IMAGE_LARGE" as const,
                    unitPrice: "2",
                    operationScope: "standalone_image_generation" as const,
                    when: { megapixelTier: "large" },
                    megapixelThreshold: "2.61",
                    missingMegapixelTier: "large" as const,
                },
            ],
        };
        const requestUsage = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture" }, rateCard });
        const actualUsage = deriveProxyBillableUsage({ capability: "image", requestUsage, payload: { data: [{ url: "https://example.com/output.png", size: "1536x1536" }] } })!;

        expect(requestUsage).toMatchObject({ operationScope: "standalone_image_generation", megapixelTier: "large" });
        expect(calculateProviderUsageCost(rateCard, requestUsage)).toBe("2");
        expect(actualUsage).toMatchObject({ resolution: "1536x1536", megapixelTier: "normal" });
        expect(calculateProviderUsageCost(rateCard, actualUsage)).toBe("1");
    });

    it("does not downgrade a large image hold when actual output size is absent", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "normal", dimension: "count" as const, unitPrice: "1", operationScope: "standalone_image_generation" as const, when: { megapixelTier: "normal" }, megapixelThreshold: "2.61", missingMegapixelTier: "large" as const },
                { id: "large", dimension: "count" as const, unitPrice: "2", operationScope: "standalone_image_generation" as const, when: { megapixelTier: "large" }, megapixelThreshold: "2.61", missingMegapixelTier: "large" as const },
            ],
        };
        const requestUsage = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture" }, rateCard });
        const actualUsage = deriveProxyBillableUsage({ capability: "image", requestUsage, payload: { data: [{ url: "https://example.com/output.png" }] } })!;

        expect(actualUsage.megapixelTier).toBe("large");
        expect(calculateProviderUsageCost(rateCard, actualUsage)).toBe("2");
    });

    it("keeps a large Seedream settlement when the authoritative output remains above 2.61 MP", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "normal", dimension: "count" as const, unitPrice: "1", operationScope: "standalone_image_generation" as const, when: { megapixelTier: "normal" }, megapixelThreshold: "2.61", missingMegapixelTier: "large" as const },
                { id: "large", dimension: "count" as const, unitPrice: "2", operationScope: "standalone_image_generation" as const, when: { megapixelTier: "large" }, megapixelThreshold: "2.61", missingMegapixelTier: "large" as const },
            ],
        };
        const requestUsage = normalizeProxyBillableRequest({ capability: "image", payload: { prompt: "fixture" }, rateCard });
        const actualUsage = deriveProxyBillableUsage({ capability: "image", requestUsage, payload: { data: [{ url: "https://example.com/output.png", width: 2048, height: 2048 }] } })!;

        expect(actualUsage).toMatchObject({ resolution: "2048x2048", megapixelTier: "large" });
        expect(calculateProviderUsageCost(rateCard, actualUsage)).toBe("2");
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

    it.each(["480", "480p", "720", "720p", "1080", "1080p"])("freezes canonical Seedance resolution for %s", (resolution) => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "duration", dimension: "durationSeconds" as const, unitPrice: "1", when: { resolution: `${resolution.replace(/p$/, "")}p`, billingBasis: "default" } }],
        };
        expect(normalizeProxyBillableRequest({ capability: "video", payload: { duration: 5, resolution }, rateCard })).toMatchObject({ resolution: `${resolution.replace(/p$/, "")}p`, billingBasis: "default", hasReferenceVideo: false });
    });

    it("freezes with_video_input only for an actual reference video", () => {
        const rateCard = { version: 1 as const, components: [{ id: "duration", dimension: "durationSeconds" as const, unitPrice: "1", when: { resolution: "1080p", billingBasis: "with_video_input" } }] };
        const defaultRateCard = { ...rateCard, components: [{ ...rateCard.components[0], when: { resolution: "1080p", billingBasis: "default" } }] };
        const video = normalizeProxyBillableRequest({ capability: "video", payload: { duration: 5, resolution: "1080p", content: [{ type: "video_url", role: "reference_video", video_url: { url: "https://example.com/input.mp4" } }] }, rateCard });
        const image = normalizeProxyBillableRequest({
            capability: "video",
            payload: { duration: 5, resolution: "1080p", content: [{ type: "image_url", role: "reference_image", image_url: { url: "https://example.com/input.png" } }] },
            rateCard: defaultRateCard,
        });
        const audio = normalizeProxyBillableRequest({ capability: "video", payload: { duration: 5, resolution: "1080p", reference_audios: ["https://example.com/input.mp3"] }, rateCard: defaultRateCard });
        expect(video).toMatchObject({ billingBasis: "with_video_input", hasReferenceVideo: true });
        expect(image).toMatchObject({ billingBasis: "default", hasReferenceVideo: false });
        expect(audio).toMatchObject({ billingBasis: "default", hasReferenceVideo: false });
    });

    it("estimates Seedance token hold usage from requested output geometry", () => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "default-720", dimension: "outputTokens" as const, unitPrice: "4", per: "1000000", when: { billingBasis: "default", resolution: "720p" } }],
        };

        expect(normalizeProxyBillableRequest({ capability: "video", payload: { duration: 5, ratio: "16:9", resolution: "720p" }, rateCard })).toMatchObject({
            outputTokens: "108000",
            durationSeconds: "5",
            resolution: "720p",
            billingBasis: "default",
        });
    });

    it("uses the official Seedance 2.0 ceiling for hold and ignores forged client duration", () => {
        const rateCard = {
            version: 1 as const,
            components: [{ id: "video-720", dimension: "outputTokens" as const, unitPrice: "5", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } }],
        };
        const payload = { duration: 5, ratio: "16:9", resolution: "720p", reference_videos: ["https://example.com/input.mp4"] };

        const inputLimits = { seedanceModelFamily: "seedance-2.0" as const, safeVideoFrame: { width: "1680", height: "720" }, videoBillingContext: { hasReferenceVideo: true } };
        expect(normalizeProxyBillableRequest({ capability: "video", payload, rateCard, inputLimits })).toMatchObject({ outputTokens: "567000", billingBasis: "with_video_input" });
        expect(normalizeProxyBillableRequest({ capability: "video", payload: { ...payload, input_video_duration_sec: 1 }, rateCard, inputLimits })).toMatchObject({ outputTokens: "567000", billingBasis: "with_video_input" });
    });

    it("separates a trusted 10s estimate from the Seedance 2.5 30s hold", () => {
        const rateCard = { version: 1 as const, revision: "sale-r1", components: [{ id: "video-720", dimension: "outputTokens" as const, unitPrice: "5", per: "1000000", when: { billingBasis: "with_video_input", resolution: "720p" } }] };
        const inputLimits = {
            seedanceModelFamily: "seedance-2.5" as const,
            safeVideoFrame: { width: "1680", height: "720" },
            videoBillingContext: { hasReferenceVideo: true, verifiedInputVideoDurationSeconds: "10", referenceVideoDurationSource: "server-probed" as const },
        };
        const usage = normalizeProxyBillableRequest({ capability: "video", payload: { duration: 5, ratio: "16:9", resolution: "720p", reference_videos: ["https://example.com/input.mp4"] }, rateCard, inputLimits });

        expect(usage).toMatchObject({ outputTokens: "992250", inputVideoDurationSeconds: "10", billingBasis: "with_video_input" });
        expect(videoTokenBillingRequestContext({ usage, rateCard, inputLimits })).toEqual({
            pricingBasis: "video_token",
            billingBasis: "with_video_input",
            resolution: "720p",
            requestedOutputDurationSeconds: "5",
            hasReferenceVideo: true,
            verifiedInputVideoDurationSeconds: "10",
            referenceVideoDurationSource: "server-probed",
            estimatePixelWidth: "1680",
            estimatePixelHeight: "720",
            estimatedTokens: "425250",
            estimateStatus: "CONSERVATIVE_ESTIMATE",
            holdTokens: "992250",
            holdInputVideoDurationSeconds: "30",
            holdPixelWidth: "1680",
            holdPixelHeight: "720",
            saleRateCardRevision: expect.stringContaining("rate-card-v1:"),
        });
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
        expect(accumulator.finish()).toMatchObject({ source: "actual", inputTokens: "7", cachedInputTokens: "12", cacheCreationTokens: "3", outputTokens: "0" });
        accumulator.push(new TextEncoder().encode('data: {"type":"message_delta","usage":{"output_tokens":2}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n'));
        expect(accumulator.finish()).toMatchObject({ source: "actual", inputTokens: "7", cachedInputTokens: "12", cacheCreationTokens: "3", outputTokens: "4" });
    });

    it("prices authoritative cache creation and server-side tool counts", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "input", dimension: "inputTokens" as const, basis: "TOKEN_INPUT" as const, unitPrice: "1", per: "1000000" },
                { id: "cache-write", dimension: "cacheCreationTokens" as const, basis: "CACHE_CREATION" as const, unitPrice: "1.25", per: "1000000" },
                { id: "tools", dimension: "serverToolCalls" as const, basis: "SERVER_TOOL_CALL" as const, unitPrice: "2" },
            ],
        };
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 8 }, rateCard });
        const actual = deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { usage: { input_tokens: 7, output_tokens: 1, cache_creation_input_tokens: 3, cache_read_input_tokens: 0, num_server_side_tools_used: 2 } } })!;

        expect(actual).toMatchObject({ inputTokens: "7", cacheCreationTokens: "3", serverToolCalls: "2" });
        expect(calculateProviderUsageCost(rateCard, actual)).toBe("4.00001075");
    });

    it("does not silently settle cache creation as zero when authoritative usage omits it", () => {
        const rateCard = { version: 1 as const, components: [{ id: "cache-write", dimension: "cacheCreationTokens" as const, basis: "CACHE_CREATION" as const, unitPrice: "1", per: "1000000" }] };
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 8 }, rateCard });
        const actual = deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { usage: { input_tokens: 7, output_tokens: 1 } } })!;

        expect(actual.cacheCreationTokens).toBeUndefined();
        expect(() => calculateProviderUsageCost(rateCard, actual)).toThrow("cacheCreationTokens");
    });

    it("selects the long-context tier from authoritative input tokens", () => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "normal", dimension: "inputTokens" as const, basis: "TOKEN_INPUT" as const, unitPrice: "1", per: "1000000", when: { contextTier: "normal" }, contextThresholdTokens: "200000" },
                { id: "long", dimension: "inputTokens" as const, basis: "TOKEN_INPUT" as const, unitPrice: "2", per: "1000000", when: { contextTier: "long" }, contextThresholdTokens: "200000" },
            ],
        };
        const requestUsage = normalizeProxyBillableRequest({ capability: "text", payload: { prompt: "fixture", max_tokens: 8 }, rateCard });
        const normal = deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { usage: { input_tokens: 199999, output_tokens: 1 } } })!;
        const long = deriveProxyBillableUsage({ capability: "text", requestUsage, payload: { usage: { input_tokens: 200000, output_tokens: 1 } } })!;

        expect(normal.contextTier).toBe("normal");
        expect(long.contextTier).toBe("long");
        expect(calculateProviderUsageCost(rateCard, normal)).toBe("0.199999");
        expect(calculateProviderUsageCost(rateCard, long)).toBe("0.4");
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

    it("prices authoritative Seedance tokens with an exact basis and resolution match", () => {
        const costRateCard = {
            version: 1 as const,
            components: [
                { id: "default-720", dimension: "outputTokens" as const, unitPrice: "6.9", per: "1000000", when: { billingBasis: "default", resolution: "720p" } },
                { id: "video-1080", dimension: "outputTokens" as const, unitPrice: "4.65", per: "1000000", when: { billingBasis: "with_video_input", resolution: "1080p" } },
            ],
        };
        const actual = normalizeAuthoritativeVideoUsage({
            requestUsage: { capability: "video", source: "request", resolution: "1080p", billingBasis: "with_video_input", hasReferenceVideo: true },
            payload: { usage: { completion_tokens: 411300, total_tokens: 411300 }, duration_sec: 5 },
            costRateCard,
        });
        expect(actual).toMatchObject({ source: "actual", outputTokens: "411300", totalTokens: "411300", durationSeconds: "5", resolution: "1080p", billingBasis: "with_video_input", hasReferenceVideo: true });
        expect(calculateProviderUsageCost(costRateCard, actual!)).toBe("1.912545");
    });

    it("rejects missing usage, wrong tiers, and missing Lite duration without zero fallback", () => {
        const token = { id: "default-720", dimension: "outputTokens" as const, unitPrice: "6.9", per: "1000000", when: { billingBasis: "default", resolution: "720p" } };
        const requestUsage = { capability: "video" as const, source: "request" as const, resolution: "720p", billingBasis: "default" as const, hasReferenceVideo: false };
        expect(() => normalizeAuthoritativeVideoUsage({ requestUsage, payload: { status: "succeeded" }, costRateCard: { version: 1, components: [token] } })).toThrowError(expect.objectContaining({ code: "AUTHORITATIVE_USAGE_MISSING" }));
        expect(normalizeAuthoritativeVideoUsage({ requestUsage, payload: { usage: { completion_tokens: 0 } }, costRateCard: { version: 1, components: [token] } })).toMatchObject({ outputTokens: "0" });
        expect(() => normalizeAuthoritativeVideoUsage({ requestUsage: { ...requestUsage, resolution: "1080p" }, payload: { usage: { completion_tokens: 0 } }, costRateCard: { version: 1, components: [token] } })).toThrowError(
            expect.objectContaining({ code: "AUTHORITATIVE_PRICING_DIMENSION_MISSING" }),
        );
        expect(() =>
            normalizeAuthoritativeVideoUsage({
                requestUsage,
                payload: { usage: { completion_tokens: 100 } },
                costRateCard: { version: 1, components: [token, { id: "video-second-stage:resolution=720p", dimension: "durationSeconds", unitPrice: "0.00625", per: "1", when: { resolution: "720p" } }] },
            }),
        ).toThrowError(expect.objectContaining({ code: "AUTHORITATIVE_DURATION_MISSING" }));
        expect(() =>
            normalizeAuthoritativeVideoUsage({
                requestUsage,
                payload: { usage: { completion_tokens: 100 }, duration_sec: 5 },
                costRateCard: { version: 1, components: [token, { id: "video-second-stage:resolution=1080p", dimension: "durationSeconds", unitPrice: "0.01", per: "1", when: { resolution: "1080p" } }] },
            }),
        ).toThrowError(expect.objectContaining({ code: "AUTHORITATIVE_PRICING_DIMENSION_MISSING" }));
        expect(AuthoritativeVideoUsageError).toBeTypeOf("function");
    });

    it("adds the Lite second-stage charge from delivered output duration only", () => {
        const requestUsage = { capability: "video" as const, source: "request" as const, resolution: "720p", billingBasis: "default" as const, hasReferenceVideo: false };
        const costRateCard = {
            version: 1 as const,
            components: [
                { id: "video-token:billingbasis=default,resolution=720p", dimension: "outputTokens" as const, unitPrice: "4", per: "1000000", when: { billingBasis: "default", resolution: "720p" } },
                { id: "video-second-stage:resolution=720p", dimension: "durationSeconds" as const, unitPrice: "0.125", per: "1", when: { resolution: "720p" } },
            ],
        };
        const actual = normalizeAuthoritativeVideoUsage({
            requestUsage,
            payload: { usage: { completion_tokens: 500000 }, duration_sec: 5, input_video_duration_sec: 30 },
            costRateCard,
        });

        expect(actual).toMatchObject({ outputTokens: "500000", durationSeconds: "5", inputVideoDurationSeconds: "30" });
        expect(calculateProviderUsageCost(costRateCard, actual!)).toBe("2.625");
    });

    it("does not switch an ordinary per-second video to token billing merely because usage is present", () => {
        expect(
            normalizeAuthoritativeVideoUsage({
                requestUsage: { capability: "video", source: "request", resolution: "720p", durationSeconds: "5" },
                payload: { usage: { completion_tokens: 411300 }, duration_sec: 5 },
                costRateCard: { version: 1, components: [{ id: "duration", dimension: "durationSeconds", unitPrice: "0.2", per: "1", when: { resolution: "720p" } }] },
            }),
        ).toBeUndefined();
    });
});
