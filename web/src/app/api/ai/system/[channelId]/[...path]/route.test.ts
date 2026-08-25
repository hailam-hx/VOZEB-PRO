import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
    checkMediaProxyRateLimit: vi.fn(),
    consumeUserPoints: vi.fn(),
    getAuthSettings: vi.fn(),
    refundUserPoints: vi.fn(),
    safeUrl: vi.fn(),
    acquire: vi.fn(),
    wrap: vi.fn(),
    release: vi.fn(),
    mediaAccess: vi.fn(),
    taskAccess: vi.fn(),
    reserveUsageBilling: vi.fn(),
    reuseExistingUsageBilling: vi.fn(),
    attachUsageProviderEvidence: vi.fn(),
    releaseUsageBilling: vi.fn(),
    recordUsageProviderAttempt: vi.fn(),
    finishUsageProviderAttempt: vi.fn(),
    settleUsageBilling: vi.fn(),
    settleCancelledUsageBilling: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-one", role: "user", pointsBalance: 5 })) }));
vi.mock("@/lib/auth/store", () => ({
    consumeUserPoints: mocks.consumeUserPoints,
    getAuthSettings: mocks.getAuthSettings,
    isAuthInputError: (error: unknown) => Boolean(error && typeof error === "object" && "status" in error),
    isQuotaExceededError: vi.fn(() => false),
    refundUserPoints: mocks.refundUserPoints,
}));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/media-concurrency", () => ({ acquireMediaConcurrency: mocks.acquire, withMediaConcurrency: mocks.wrap }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string | URL, init?: RequestInit) => fetch(url, init) }));
vi.mock("@/lib/server/generation-media-access", () => ({ authorizeGenerationMediaProxyRequest: mocks.mediaAccess }));
vi.mock("@/lib/server/generation-task-authorization", () => ({ userOwnsGenerationUpstreamTask: mocks.taskAccess }));
vi.mock("@/lib/server/usage-billing-runtime", () => ({
    reserveUsageBilling: mocks.reserveUsageBilling,
    reuseExistingUsageBilling: mocks.reuseExistingUsageBilling,
    attachUsageProviderEvidence: mocks.attachUsageProviderEvidence,
    releaseUsageBilling: mocks.releaseUsageBilling,
    recordUsageProviderAttempt: mocks.recordUsageProviderAttempt,
    finishUsageProviderAttempt: mocks.finishUsageProviderAttempt,
    settleUsageBilling: mocks.settleUsageBilling,
    settleCancelledUsageBilling: mocks.settleCancelledUsageBilling,
}));
vi.mock("@/lib/server/security", () => ({
    checkMediaProxyRateLimit: mocks.checkMediaProxyRateLimit,
    isSafeOutboundUrl: mocks.safeUrl,
    rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })),
}));

import { GET, maxDuration, meteredTextResponseBody, POST, PUT } from "./route";
import { MEDIA_SNIFF_RANGE } from "@/lib/server/media-content-validation";
import { readSystemAiUsageBilling, systemAiBillingHeaders } from "@/lib/server/system-ai-billing";

const context = { params: Promise.resolve({ channelId: "channel-one", path: ["_media"] }) };

describe("system generation proxy runtime", () => {
    it("keeps long image and video submissions alive beyond the framework default", () => {
        expect(maxDuration).toBeGreaterThanOrEqual(40 * 60);
    });
});

describe("system media proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.checkMediaProxyRateLimit.mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000 });
        mocks.safeUrl.mockResolvedValue(true);
        mocks.release.mockReset();
        mocks.acquire.mockReturnValue({ release: mocks.release });
        mocks.wrap.mockImplementation((response: Response) => response);
        mocks.mediaAccess.mockReset().mockResolvedValue(true);
        mocks.taskAccess.mockReset().mockResolvedValue(true);
        mocks.reserveUsageBilling.mockReset().mockResolvedValue({
            holdId: "hold-one",
            userId: "user-one",
            businessId: "text-task:one",
            requestFingerprint: "a".repeat(64),
            snapshot: { version: 1, requestUsage: { capability: "text", source: "request", inputTokens: "5", maxOutputTokens: "128" }, reserve: { usage: { capability: "text", source: "reserve_fallback", inputTokens: "5", outputTokens: "128" } } },
        });
        mocks.reuseExistingUsageBilling.mockReset().mockResolvedValue(undefined);
        mocks.recordUsageProviderAttempt.mockReset().mockResolvedValue({});
        mocks.attachUsageProviderEvidence.mockReset().mockResolvedValue({});
        mocks.releaseUsageBilling.mockReset().mockResolvedValue({});
        mocks.finishUsageProviderAttempt.mockReset().mockResolvedValue({});
        mocks.settleUsageBilling.mockReset().mockResolvedValue({});
        mocks.settleCancelledUsageBilling.mockReset().mockResolvedValue({});
        mocks.getAuthSettings.mockResolvedValue({
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: [] }],
        });
    });

    it("reserves and records the routed attempt before a signed upstream create", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                {
                    id: "writer",
                    name: "写作",
                    capability: "text",
                    enabled: true,
                    saleRateCard: {
                        version: 1,
                        components: [
                            { id: "output", dimension: "outputTokens", unitPrice: "0.001" },
                            { id: "input", dimension: "inputTokens", unitPrice: "0.001" },
                        ],
                    },
                    bindings: [
                        {
                            id: "writer-binding",
                            channelId: "channel-one",
                            upstreamModel: "vendor-text",
                            enabled: true,
                            priority: 1,
                            costRateCard: {
                                version: 1,
                                components: [
                                    { id: "output", dimension: "outputTokens", unitPrice: "0.0005" },
                                    { id: "input", dimension: "inputTokens", unitPrice: "0.0005" },
                                ],
                            },
                            providerCostUnit: { kind: "fiat", currency: "USD" },
                            capabilityProfile: { maxOutputTokens: 128, supportsIdempotency: true },
                        },
                    ],
                },
            ],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-text"] }],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });
        const request = new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...signedUsageHeaders(body),
            },
            body,
        });

        const response = await POST(request, textContext());

        expect(mocks.reserveUsageBilling).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", businessId: "text-task:one", requestFingerprint: "a".repeat(64), logicalModelId: "writer" }));
        expect(mocks.recordUsageProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 1, status: "pending", bindingId: "writer-binding", providerIdempotencyKey: "text-task:one:attempt:1" }));
        expect(mocks.recordUsageProviderAttempt.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
        expect(readSystemAiUsageBilling(response.headers)).toEqual({ holdId: "hold-one", attemptNumber: 1, requestFingerprint: "a".repeat(64) });
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });

    it("rejects an unsigned create before reserving or contacting upstream", async () => {
        mocks.getAuthSettings.mockResolvedValue(pricedTextSettings());
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "must not run" } }] }));

        const response = await POST(unsignedChatRequest({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 }), textContext());

        expect(response.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.reserveUsageBilling).not.toHaveBeenCalled();
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });

    it("rejects an invalid usage signature before reserving or contacting upstream", async () => {
        mocks.getAuthSettings.mockResolvedValue(pricedTextSettings());
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "must not run" } }] }));
        const body = JSON.stringify({ model: "vendor-text", messages: [], max_tokens: 128 });
        const headers = new Headers({
            "content-type": "application/json",
            ...signedUsageHeaders(body),
        });
        headers.set("x-vozeb-pro-points-signature", "invalid");

        const response = await POST(new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers, body }), textContext());

        expect(response.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.reserveUsageBilling).not.toHaveBeenCalled();
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });

    it("does not recreate a replayed provider attempt without explicit idempotency support", async () => {
        mocks.getAuthSettings.mockResolvedValue(pricedTextSettings());
        mocks.recordUsageProviderAttempt.mockResolvedValueOnce({ applied: false, attempt: { providerIdempotencySupported: false } });
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });

        const response = await POST(new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...signedUsageHeaders(body, false) }, body }), textContext());

        expect(response.status, JSON.stringify(await response.clone().json())).toBe(409);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("replays the exact create only with the original supported provider idempotency key", async () => {
        mocks.getAuthSettings.mockResolvedValue(pricedTextSettings());
        mocks.recordUsageProviderAttempt.mockResolvedValueOnce({ applied: false, attempt: { providerIdempotencySupported: true, providerIdempotencyKey: "text-task:one:attempt:1" } });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });

        const response = await POST(new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...signedUsageHeaders(body) }, body }), textContext());

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("rejects a signed create when its canonical query changes", async () => {
        const settings = pricedTextSettings();
        Object.assign(settings.systemChannels[0], { advancedConfig: { createPath: "/chat/completions?region=us&mode=fast", editPath: "/chat/completions?region=eu&mode=fast" } });
        mocks.getAuthSettings.mockResolvedValue(settings);
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });
        const request = new Request("http://localhost/api/ai/system/channel-one/chat/completions?region=eu&mode=fast", {
            method: "POST",
            headers: { "content-type": "application/json", ...signedUsageHeaders(body, true, { canonicalQuery: "region=us&mode=fast" }) },
            body,
        });

        const response = await POST(request, textContext());

        expect(response.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts an exact replay after deterministic query canonicalization", async () => {
        const settings = pricedTextSettings();
        Object.assign(settings.systemChannels[0], { advancedConfig: { createPath: "/chat/completions?region=us&label=a%20b" } });
        mocks.getAuthSettings.mockResolvedValue(settings);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });
        const request = new Request("http://localhost/api/ai/system/channel-one/chat/completions?region=us&label=a%20b", {
            method: "POST",
            headers: { "content-type": "application/json", ...signedUsageHeaders(body, true, { canonicalQuery: "region=us&label=a+b" }) },
            body,
        });

        const response = await POST(request, textContext());

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("uses the frozen hold sale snapshot on failover even when current sale pricing is removed", async () => {
        const settings = pricedTextSettings();
        delete (settings.logicalModels[0] as { saleRateCard?: unknown }).saleRateCard;
        mocks.getAuthSettings.mockResolvedValue(settings);
        const frozen = await mocks.reserveUsageBilling();
        mocks.reserveUsageBilling.mockClear();
        mocks.reuseExistingUsageBilling.mockResolvedValueOnce(frozen);
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });

        const response = await POST(new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...signedUsageHeaders(body) }, body }), textContext());

        expect(response.status).toBe(200);
        expect(mocks.reserveUsageBilling).not.toHaveBeenCalled();
    });

    it("rejects signed create replay across a changed user, path, or exact body", async () => {
        mocks.getAuthSettings.mockResolvedValue(pricedTextSettings());
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "original" }], max_tokens: 128 });
        const changedBody = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "changed" }], max_tokens: 128 });
        const requests = [
            new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...signedUsageHeaders(body, true, { userId: "user-two" }) }, body }),
            new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
                method: "POST",
                headers: { "content-type": "application/json", ...signedUsageHeaders(body, true, { canonicalPath: "/api/ai/system/channel-one/responses" }) },
                body,
            }),
            new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...signedUsageHeaders(body) }, body: changedBody }),
        ];

        for (const request of requests) expect((await POST(request, textContext())).status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("persists text stream usage evidence without settling before runtime validation", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                {
                    id: "writer",
                    name: "写作",
                    capability: "text",
                    enabled: true,
                    saleRateCard: {
                        version: 1,
                        components: [
                            { id: "output", dimension: "outputTokens", unitPrice: "0.001" },
                            { id: "input", dimension: "inputTokens", unitPrice: "0.001" },
                        ],
                    },
                    bindings: [
                        {
                            id: "writer-binding",
                            channelId: "channel-one",
                            upstreamModel: "vendor-text",
                            enabled: true,
                            priority: 1,
                            costRateCard: {
                                version: 1,
                                components: [
                                    { id: "output", dimension: "outputTokens", unitPrice: "0.0005" },
                                    { id: "input", dimension: "inputTokens", unitPrice: "0.0005" },
                                ],
                            },
                            providerCostUnit: { kind: "fiat", currency: "USD" },
                            capabilityProfile: { maxOutputTokens: 128, supportsIdempotency: true },
                        },
                    ],
                },
            ],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-text"] }],
        });
        const encoder = new TextEncoder();
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'));
                        controller.enqueue(encoder.encode('data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n'));
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        controller.close();
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            ),
        );
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });
        const request = new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...signedUsageHeaders(body),
            },
            body,
        });

        const response = await POST(request, textContext());
        expect(mocks.settleUsageBilling).not.toHaveBeenCalled();
        const streamed = await response.text();

        expect(response.status, streamed).toBe(200);
        expect(mocks.reserveUsageBilling).toHaveBeenCalledOnce();
        expect(mocks.attachUsageProviderEvidence).toHaveBeenCalledWith(expect.objectContaining({ attemptNumber: 1, usage: expect.objectContaining({ source: "actual", inputTokens: "5", outputTokens: "2" }) }));
        expect(mocks.finishUsageProviderAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
        expect(mocks.settleUsageBilling).not.toHaveBeenCalled();
    });

    it("settles accepted user cancellation even when the upstream cancel hook throws", async () => {
        const upstream = new ReadableStream<Uint8Array>({
            cancel() {
                throw new Error("cancel failed");
            },
        });
        const stream = meteredTextResponseBody(upstream, (await mocks.reserveUsageBilling())!, 1);

        await expect(stream.cancel()).rejects.toThrow("cancel failed");
        expect(mocks.finishUsageProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
        expect(mocks.settleCancelledUsageBilling).toHaveBeenCalledOnce();
    });

    it("classifies a provider stream read failure as failed and releases the hold", async () => {
        const upstream = new ReadableStream<Uint8Array>({
            pull() {
                throw new Error("read failed");
            },
        });
        const stream = meteredTextResponseBody(upstream, (await mocks.reserveUsageBilling())!, 1);

        await expect(stream.getReader().read()).rejects.toThrow("read failed");
        expect(mocks.finishUsageProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
        expect(mocks.releaseUsageBilling).toHaveBeenCalledOnce();
        expect(mocks.settleCancelledUsageBilling).not.toHaveBeenCalled();
    });

    it("retains available usage evidence when an HTTP attempt fails", async () => {
        mocks.getAuthSettings.mockResolvedValue(pricedTextSettings());
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "failed" }, usage: { prompt_tokens: 5, completion_tokens: 2 } }, { status: 500 }));
        const body = JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }], max_tokens: 128 });

        const response = await POST(new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...signedUsageHeaders(body) }, body }), textContext());

        expect(response.status).toBe(500);
        expect(mocks.finishUsageProviderAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", normalizedUsage: expect.objectContaining({ source: "actual", inputTokens: "5", outputTokens: "2" }) }));
    });

    it("blocks authenticated media requests when the rate limit is exhausted", async () => {
        mocks.checkMediaProxyRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
        const fetchMock = vi.spyOn(globalThis, "fetch");

        const response = await GET(request(), context);

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects media urls that were not authorized by a server-owned generation task", async () => {
        mocks.mediaAccess.mockResolvedValue(false);
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const response = await GET(request(), context);
        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects oversized upstream media", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { headers: { "content-length": String(300 * 1024 * 1024 + 1) } }));

        const response = await GET(request(), context);

        expect(response.status).toBe(413);
    });

    it("forces private caching for channel media", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(pngBytes(), { headers: { "cache-control": "public, max-age=86400", "content-type": "text/html" } }));

        const response = await GET(request(), context);

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, max-age=600");
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("accepts octet-stream media and rejects executable bodies", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response(pngBytes(), { headers: { "content-type": "application/octet-stream" } }))
            .mockResolvedValueOnce(new Response(unsafeBody("<!doctype html><script>alert(1)</script>"), { headers: { "content-type": "image/png" } }));

        const accepted = await GET(request(), context);
        const rejected = await GET(request(), context);

        expect(accepted.status).toBe(200);
        expect(accepted.headers.get("content-type")).toBe("image/png");
        expect(rejected.status).toBe(415);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("probes the file signature before serving a non-zero range", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response(mp4Bytes(), { status: 206, headers: { "content-type": "application/octet-stream" } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "content-type": "text/html" } }));

        const response = await GET(request("https://cdn.example.com/video.mp4", { range: "bytes=100-" }), context);

        expect(response.status).toBe(206);
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("range")).toBe(MEDIA_SNIFF_RANGE);
        expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("range")).toBe(`bytes=100-${100 + 32 * 1024 * 1024 - 1}`);
        expect(response.headers.get("content-type")).toBe("video/mp4");
    });

    it("checks every media redirect before fetching the next hop", async () => {
        mocks.safeUrl.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.png" } }));

        const response = await GET(request(), context);

        expect(response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses Bearer authentication for GlobalAiOpc media even when its API format is Gemini", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer",
                    apiKey: "secret",
                    apiFormat: "gemini",
                    models: [],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "video-seedance-x1" },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(mp4Bytes(), { headers: { "content-type": "application/octet-stream" } }));

        const response = await GET(request("/v1/result/task-one"), context);

        expect(response.status).toBe(200);
        const [, init] = fetchMock.mock.calls[0];
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/v1/result/task-one");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
    });
});

describe("GlobalAiOpc native text proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.taskAccess.mockReset().mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("gemini-text", "text", "gemini-3.1-pro-preview")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "http://apillm.globalaiopc.com/gw_llm_power",
                    apiKey: "secret",
                    apiFormat: "gemini",
                    models: ["gemini-3.1-pro-preview"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "text-gemini-native" },
                },
            ],
        });
    });

    it("maps internal Chat calls to Gemini native paths, payloads, and Bearer authentication", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] }), { headers: { "content-type": "application/json" } }));

        const response = await POST(chatRequest({ model: "gemini-3.1-pro-preview", messages: [{ role: "user", content: "hello" }] }), textContext());

        expect(response.status).toBe(200);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://apillm.globalaiopc.com/gw_llm_power/v1/models/gemini-3.1-pro-preview:generateContent");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
        expect(JSON.parse(String(init?.body))).toMatchObject({ contents: [{ role: "user", parts: [{ text: "hello" }] }] });
        expect(await response.json()).toMatchObject({ choices: [{ message: { role: "assistant", content: "OK" } }] });
    });

    it("charges text calls with the logical model id instead of the upstream alias", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("writer", "text", "vendor-text")],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-text"] }],
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));

        const response = await POST(chatRequest({ model: "vendor-text", messages: [{ role: "user", content: "hello" }] }), textContext());

        expect(response.status).toBe(200);
        expect(mocks.reserveUsageBilling).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", logicalModelId: "writer" }));
    });

    it("uses the validated preferred logical model and stable idempotency key when aliases are shared", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                { ...logicalModel("writer-basic", "text", "vendor-shared"), bindings: [{ ...logicalModel("writer-basic", "text", "vendor-shared").bindings[0], id: "basic" }] },
                { ...logicalModel("writer-pro", "text", "vendor-shared"), bindings: [{ ...logicalModel("writer-pro", "text", "vendor-shared").bindings[0], id: "pro" }] },
            ],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-shared"] }],
        });
        mocks.recordUsageProviderAttempt.mockResolvedValueOnce({ applied: false, attempt: { providerIdempotencySupported: true, providerIdempotencyKey: "text-task:test:attempt:1" } });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const body = JSON.stringify({ model: "vendor-shared", messages: [{ role: "user", content: "hello" }] });
        const request = new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "idempotency-key": "upstream-request-one",
                "x-client-request-id": "client-request-one",
                ...signedModelHeaders("http://localhost/api/ai/system/channel-one/chat/completions", body, "writer-pro", "vendor-shared", "text", "pro"),
            },
            body,
        });

        const response = await POST(request, textContext());
        expect(response.status).toBe(200);
        expect(mocks.reserveUsageBilling).toHaveBeenCalledWith(expect.objectContaining({ logicalModelId: "writer-pro" }));
        const upstreamHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
        expect(upstreamHeaders.get("idempotency-key")).toBe("text-task:test:attempt:1");
        expect(upstreamHeaders.get("x-client-request-id")).toBe("text-task:test:attempt:1");
    });

    it("rejects a legacy business-only signature without contacting upstream", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("writer", "text", "vendor-text")],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-text"] }],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const createRequest = () =>
            new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
                method: "POST",
                headers: { "content-type": "application/json", "x-vozeb-pro-logical-model": "writer", "x-vozeb-pro-points-idempotency-key": "forged-client-key" },
                body: JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content: "hello" }] }),
            });

        expect((await POST(createRequest(), textContext())).status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a legacy business signature before payload replay can reach billing", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("writer", "text", "vendor-text")],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-text"] }],
        });
        let firstIdentity: { key: string; fingerprint: string } | undefined;
        mocks.consumeUserPoints.mockImplementation(async (_userId, _model, _amount, _usageKind, key: string, fingerprint: string) => {
            if (!firstIdentity) firstIdentity = { key, fingerprint };
            else if (firstIdentity.key === key && firstIdentity.fingerprint !== fingerprint) throw Object.assign(new Error("积分幂等键对应的消费参数不一致"), { status: 409 });
            return undefined;
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const billingHeaders = systemAiBillingHeaders("writer", "task-one", "vendor-text");
        const createRequest = (content: string) =>
            new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
                method: "POST",
                headers: { "content-type": "application/json", ...billingHeaders },
                body: JSON.stringify({ model: "vendor-text", messages: [{ role: "user", content }] }),
            });

        const first = await POST(createRequest("first"), textContext());
        const second = await POST(createRequest("changed"), textContext());

        expect(first.status).toBe(401);
        expect(second.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("routes GlobalAiOpc media models from one catalog channel to the matching service endpoint", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("videos-model", "video", "videos_stable")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["happyhorse-1.0-i2v", "videos_stable"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPresets: ["video-happyhorse-i2v", "video-videos"] },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "task" }), { headers: { "content-type": "application/json" } }));

        const response = await POST(chatRequest({ model: "videos_stable", prompt: "hello" }), { params: Promise.resolve({ channelId: "channel-one", path: ["videos", "videos"] }) });

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/kyyReactApiServer/v1/videos/videos");
    });

    it("keeps the GlobalAiOpc service prefix and v1 version when polling a video task", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("videos-model", "video", "videos_stable")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["videos_stable"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "video-videos" },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "video-one", status: "processing" }), { headers: { "content-type": "application/json" } }));

        const response = await GET(new Request("http://localhost/api/ai/system/channel-one/result/video-one", { headers: systemModelHeaders("videos-model", "videos_stable") }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["result", "video-one"] }),
        });

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/kyyReactApiServer/v1/result/video-one");
    });

    it("maps internal Chat calls to Claude Messages and leaves Responses for Chat fallback", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("claude-text", "text", "claude-opus-4-6")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "http://apillm.globalaiopc.com/gw_llm_power",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["claude-opus-4-6"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "text-claude-native" },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }), { headers: { "content-type": "application/json" } }));

        const response = await POST(chatRequest({ model: "claude-opus-4-6", messages: [{ role: "user", content: "hello" }] }), textContext());

        expect(fetchMock.mock.calls[0][0]).toBe("http://apillm.globalaiopc.com/gw_llm_power/v1/messages");
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: "claude-opus-4-6", messages: [{ role: "user", content: "hello" }] });
        expect(await response.json()).toMatchObject({ choices: [{ message: { role: "assistant", content: "OK" } }] });

        fetchMock.mockClear();
        const fallback = await POST(new Request("http://localhost/api/ai/system/channel-one/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-4-6", input: "hello" }) }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["responses"] }),
        });
        expect(fallback.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("Agnes video polling proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.taskAccess.mockReset().mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("agnes-video", "video", "agnes-video-v2.0")],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://apihub.agnes-ai.com/v1", apiKey: "secret", apiFormat: "openai", models: ["agnes-video-v2.0"] }],
        });
    });

    it("queries the documented root agnesapi endpoint instead of nesting it under v1", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "video-one", status: "processing" }));

        const response = await GET(new Request("http://localhost/api/ai/system/channel-one/agnesapi?video_id=video-one", { headers: systemModelHeaders("agnes-video", "agnes-video-v2.0") }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["agnesapi"] }),
        });

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://apihub.agnes-ai.com/agnesapi?video_id=video-one");
        expect(mocks.taskAccess).toHaveBeenCalledWith({ userId: "user-one", capability: "video", channelId: "channel-one", upstreamModel: "agnes-video-v2.0", upstreamTaskId: "video-one" });
    });

    it("does not forward another user's upstream task", async () => {
        mocks.taskAccess.mockResolvedValue(false);
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const response = await GET(new Request("http://localhost/api/ai/system/channel-one/agnesapi?video_id=other", { headers: systemModelHeaders("agnes-video", "agnes-video-v2.0") }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["agnesapi"] }),
        });
        expect(response.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("Stable Diffusion proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("image-local", "image", "sdxl")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://sd.example.com",
                    apiKey: "",
                    apiFormat: "openai",
                    models: ["sdxl"],
                    advancedConfig: { protocol: "stable-diffusion", authMode: "none", createPath: "/sdapi/v1/txt2img" },
                },
            ],
        });
    });

    it("keeps the sdapi path literal and omits authentication", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ images: ["image-base64"] }));
        const url = "http://localhost/api/ai/system/channel-one/sdapi/v1/txt2img";
        const body = JSON.stringify({ prompt: "test", width: 1024, height: 1024 });
        const response = await POST(
            new Request(url, {
                method: "POST",
                headers: { "content-type": "application/json", ...signedModelHeaders(url, body, "image-local", "sdxl", "image", "image-local-binding") },
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["sdapi", "v1", "txt2img"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://sd.example.com/sdapi/v1/txt2img");
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBeNull();
    });
});

describe("VOZEB recommended video proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.taskAccess.mockReset().mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("vozeb-video", "video", "Seedance 2.0-fast-720p")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://new.aiym.ink/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["Seedance 2.0-fast-720p"],
                    advancedConfig: {
                        protocol: "vozeb-recommended",
                        createPath: "/v1/videos/generations",
                        imageToVideoPath: "/v1/videos/generations",
                        queryPath: "/v1/videos/generations/:task_id",
                        modelConfigs: {
                            "seedance 2.0-fast-720p": {
                                capability: "video",
                                protocol: "vozeb-recommended",
                                createPath: "/v1/videos/generations",
                                queryPath: "/v1/videos/generations/:task_id",
                            },
                        },
                    },
                },
            ],
        });
    });

    it("keeps one v1 prefix for JSON creation and polling", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(Response.json({ id: "video-one", task_id: "video-one", status: "queued" }))
            .mockResolvedValueOnce(Response.json({ id: "video-one", status: "completed", metadata: { url: "https://new.aiym.ink/v1/video-media/video-one.mp4" } }));
        const createUrl = "http://localhost/api/ai/system/channel-one/v1/videos/generations";
        const body = JSON.stringify({ model: "Seedance 2.0-fast-720p", prompt: "test", duration: 5, generate_audio: false });
        const headers = { "content-type": "application/json", ...signedModelHeaders(createUrl, body, "vozeb-video", "Seedance 2.0-fast-720p", "video", "vozeb-video-binding") };
        const createResponse = await POST(
            new Request(createUrl, {
                method: "POST",
                headers,
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["v1", "videos", "generations"] }) },
        );
        const queryResponse = await GET(new Request("http://localhost/api/ai/system/channel-one/v1/videos/generations/video-one", { headers }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["v1", "videos", "generations", "video-one"] }),
        });

        expect(createResponse.status).toBe(200);
        expect(queryResponse.status).toBe(200);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://new.aiym.ink/v1/videos/generations", "https://new.aiym.ink/v1/videos/generations/video-one"]);
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("content-type")).toBe("application/json");
    });
});

describe("Gemini Veo native video proxy", () => {
    const model = "veo-3.1-generate-preview";

    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.taskAccess.mockReset().mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: { videoQuality: { "720": 2 }, videoSeconds: { "6": 3 } },
            logicalModels: [logicalModel("gemini-video", "video", model)],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://generativelanguage.googleapis.com", apiKey: "gemini-secret", apiFormat: "gemini", models: [model], advancedConfig: { protocol: "gemini" } }],
        });
    });

    it("forwards Gemini creation and operation polling with x-goog-api-key and video billing", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(Response.json({ name: `models/${model}/operations/operation-one`, done: false }))
            .mockResolvedValueOnce(Response.json({ done: false }));
        const createUrl = `http://localhost/api/ai/system/channel-one/models/${model}:predictLongRunning`;
        const body = JSON.stringify({ instances: [{ prompt: "A test video" }], parameters: { durationSeconds: 6, resolution: "720p" } });
        const headers = { "content-type": "application/json", ...signedModelHeaders(createUrl, body, "gemini-video", model, "video", "gemini-video-binding") };
        const createResponse = await POST(
            new Request(createUrl, {
                method: "POST",
                headers,
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["models", `${model}:predictLongRunning`] }) },
        );
        const queryResponse = await GET(new Request(`http://localhost/api/ai/system/channel-one/models/${model}/operations/operation-one`, { headers }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["models", model, "operations", "operation-one"] }),
        });

        expect(createResponse.status).toBe(200);
        expect(queryResponse.status).toBe(200);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`, `https://generativelanguage.googleapis.com/v1beta/models/${model}/operations/operation-one`]);
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("x-goog-api-key")).toBe("gemini-secret");
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBeNull();
        expect(mocks.reserveUsageBilling).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", logicalModelId: "gemini-video" }));
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });
});

describe("Yumeng v2 model-center proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("yumeng-image", "image", "seedream_5.0Pro")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "http://token.myairealm.com/",
                    apiKey: "yumeng-secret",
                    apiFormat: "openai",
                    models: ["seedream_5.0Pro"],
                    advancedConfig: {
                        protocol: "yumeng",
                        modelConfigs: { "seedream_5.0pro": { capability: "image", protocol: "yumeng", createPath: "/kyyReactApiServer/v2/model-center/tasks", queryPath: "/kyyReactApiServer/v2/model-center/tasks/:task_id" } },
                    },
                },
            ],
        });
    });

    it("keeps the v2 path literal instead of inserting v1", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "yumeng-task", status: "queued" }));
        const url = "http://localhost/api/ai/system/channel-one/kyyReactApiServer/v2/model-center/tasks";
        const body = JSON.stringify({ model: "seedream_5.0Pro", prompt: "test" });
        const response = await POST(
            new Request(url, {
                method: "POST",
                headers: { "content-type": "application/json", ...signedModelHeaders(url, body, "yumeng-image", "seedream_5.0Pro", "image", "yumeng-image-binding") },
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["kyyReactApiServer", "v2", "model-center", "tasks"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/kyyReactApiServer/v2/model-center/tasks");
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer yumeng-secret");
    });

    it("does not duplicate a path prefix already present in the channel Base URL", async () => {
        const settings = await mocks.getAuthSettings();
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: settings.systemChannels.map((channel: { baseUrl: string }) => ({ ...channel, baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer" })),
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "yumeng-task", status: "queued" }));
        const url = "http://localhost/api/ai/system/channel-one/kyyReactApiServer/v2/model-center/tasks";
        const body = JSON.stringify({ model: "seedream_5.0Pro", prompt: "test" });

        const response = await POST(
            new Request(url, {
                method: "POST",
                headers: { "content-type": "application/json", ...signedModelHeaders(url, body, "yumeng-image", "seedream_5.0Pro", "image", "yumeng-image-binding") },
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["kyyReactApiServer", "v2", "model-center", "tasks"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/kyyReactApiServer/v2/model-center/tasks");
    });
});

describe("configured versioned protocol billing", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("seedance-special-video", "video", "sd_2.0_fast_special_720p")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://provider.example/kyyReactApiServer",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["sd_2.0_fast_special_720p"],
                    advancedConfig: {
                        protocol: "seedance-special",
                        modelConfigs: {
                            "sd_2.0_fast_special_720p": {
                                capability: "video",
                                protocol: "seedance-special",
                                createPath: "/v1/seedance-special/videos",
                                queryPath: "/v1/result/:task_id",
                            },
                        },
                    },
                },
            ],
        });
    });

    it("classifies a configured v1 create path from the trusted model header", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ task_id: "seedance-task", status: "queued" }));
        const url = "http://localhost/api/ai/system/channel-one/v1/seedance-special/videos";
        const body = JSON.stringify({ content: [{ type: "text", text: "test" }], duration: 5, ratio: "16:9" });
        const response = await POST(
            new Request(url, {
                method: "POST",
                headers: { "content-type": "application/json", ...signedModelHeaders(url, body, "seedance-special-video", "sd_2.0_fast_special_720p", "video", "seedance-special-video-binding") },
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["v1", "seedance-special", "videos"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://provider.example/kyyReactApiServer/v1/seedance-special/videos");
        expect(mocks.reserveUsageBilling).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", logicalModelId: "seedance-special-video" }));
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });
});

describe("custom protocol model routing", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("image-tool", "image", "engine-one")],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://api.example.com/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["engine-one"],
                    advancedConfig: {
                        protocol: "custom",
                        modelConfigs: { "engine-one": { capability: "image", protocol: "custom", createPath: "/jobs/image" } },
                    },
                },
            ],
        });
    });

    it("uses the trusted upstream model header when a custom body has no model field", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ url: "https://cdn.example.com/result.png" }));
        const url = "http://localhost/api/ai/system/channel-one/jobs/image";
        const body = JSON.stringify({ engine: "engine-one", prompt: "test" });
        const response = await POST(
            new Request(url, {
                method: "POST",
                headers: { "content-type": "application/json", ...signedModelHeaders(url, body, "image-tool", "engine-one", "image", "image-tool-binding") },
                body,
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["jobs", "image"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/jobs/image");
        expect(mocks.reserveUsageBilling).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", logicalModelId: "image-tool" }));
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });
});

describe("system proxy authorization", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [logicalModel("writer", "text", "vendor-text")],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "shared-secret", apiFormat: "openai", models: ["vendor-text", "unbound-model"] }],
        });
    });

    it("rejects unknown paths before forwarding or charging", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const response = await POST(chatRequest({ model: "vendor-text" }), { params: Promise.resolve({ channelId: "channel-one", path: ["account", "balance"] }) });

        expect(response.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });

    it("rejects models that exist in the channel catalog but have no logical binding", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const response = await POST(chatRequest({ model: "unbound-model", messages: [] }), textContext());

        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });

    it("rejects unsupported HTTP methods without forwarding or charging", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const response = await PUT(
            new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ model: "vendor-text" }),
            }),
            textContext(),
        );

        expect(response.status).toBe(405);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.consumeUserPoints).not.toHaveBeenCalled();
    });
});

function request(url = "https://cdn.example.com/media.png", headers?: HeadersInit) {
    return new Request(`http://localhost/api/ai/system/channel-one/_media?url=${encodeURIComponent(url)}`, { headers });
}

function textContext() {
    return { params: Promise.resolve({ channelId: "channel-one", path: ["chat", "completions"] }) };
}

function chatRequest(body: unknown) {
    const payload = body as { model?: string };
    const mapping: Record<string, { logicalModelId: string; capability: "text" | "video"; bindingId: string; path: string }> = {
        "gemini-3.1-pro-preview": { logicalModelId: "gemini-text", capability: "text", bindingId: "gemini-text-binding", path: "/chat/completions" },
        "vendor-text": { logicalModelId: "writer", capability: "text", bindingId: "writer-binding", path: "/chat/completions" },
        videos_stable: { logicalModelId: "videos-model", capability: "video", bindingId: "videos-model-binding", path: "/videos/videos" },
        "claude-opus-4-6": { logicalModelId: "claude-text", capability: "text", bindingId: "claude-text-binding", path: "/chat/completions" },
    };
    const selected = mapping[payload.model || ""];
    const serialized = JSON.stringify(body);
    const url = `http://localhost/api/ai/system/channel-one${selected?.path || "/chat/completions"}`;
    const headers = selected ? signedModelHeaders(url, serialized, selected.logicalModelId, payload.model!, selected.capability, selected.bindingId) : {};
    return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: serialized });
}

function unsignedChatRequest(body: unknown) {
    return new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function signedUsageHeaders(body: string, providerIdempotencySupported = true, overrides: Partial<{ userId: string; canonicalPath: string; canonicalQuery: string }> = {}) {
    return systemAiBillingHeaders(
        "writer",
        {
            userId: overrides.userId || "user-one",
            channelId: "channel-one",
            capability: "text",
            method: "POST",
            canonicalPath: overrides.canonicalPath || "/api/ai/system/channel-one/chat/completions",
            canonicalQuery: overrides.canonicalQuery || "",
            bodyDigest: createHash("sha256").update(body).digest("hex"),
            expiresAtMs: Date.now() + 60_000,
            businessRequestId: "text-task:one",
            requestFingerprint: "a".repeat(64),
            attemptNumber: 1,
            bindingId: "writer-binding",
            providerIdempotencySupported,
            ...(providerIdempotencySupported ? { providerIdempotencyKey: "text-task:one:attempt:1" } : {}),
        },
        "vendor-text",
    );
}

function logicalModel(id: string, capability: "text" | "image" | "video" | "audio", upstreamModel: string) {
    const components =
        capability === "text"
            ? [
                  { id: "input", dimension: "inputTokens" as const, unitPrice: "0.001" },
                  { id: "output", dimension: "outputTokens" as const, unitPrice: "0.001" },
              ]
            : [{ id: "count", dimension: "count" as const, unitPrice: "1" }];
    return {
        id,
        name: id,
        capability,
        enabled: true,
        saleRateCard: { version: 1 as const, components },
        bindings: [
            {
                id: `${id}-binding`,
                channelId: "channel-one",
                upstreamModel,
                enabled: true,
                priority: 1,
                costRateCard: { version: 1 as const, components },
                providerCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                capabilityProfile: capability === "text" ? { maxOutputTokens: 128, supportsIdempotency: true } : { supportsIdempotency: true },
            },
        ],
    };
}

function signedModelHeaders(url: string, body: string, logicalModelId: string, upstreamModel: string, capability: "text" | "image" | "video" | "audio", bindingId: string) {
    const target = new URL(url);
    return systemAiBillingHeaders(
        logicalModelId,
        {
            userId: "user-one",
            channelId: "channel-one",
            capability,
            method: "POST",
            canonicalPath: target.pathname,
            canonicalQuery: target.searchParams.toString(),
            bodyDigest: createHash("sha256").update(body).digest("hex"),
            expiresAtMs: Date.now() + 60_000,
            businessRequestId: `${capability}-task:test`,
            requestFingerprint: createHash("sha256").update(`${logicalModelId}:test`).digest("hex"),
            attemptNumber: 1,
            bindingId,
            providerIdempotencySupported: true,
            providerIdempotencyKey: `${capability}-task:test:attempt:1`,
        },
        upstreamModel,
    );
}

function pricedTextSettings() {
    return {
        generationPointMultipliers: {},
        logicalModels: [
            {
                id: "writer",
                name: "写作",
                capability: "text" as const,
                enabled: true,
                saleRateCard: {
                    version: 1 as const,
                    components: [
                        { id: "input", dimension: "inputTokens" as const, unitPrice: "0.001" },
                        { id: "output", dimension: "outputTokens" as const, unitPrice: "0.001" },
                    ],
                },
                bindings: [
                    {
                        id: "writer-binding",
                        channelId: "channel-one",
                        upstreamModel: "vendor-text",
                        enabled: true,
                        priority: 1,
                        costRateCard: {
                            version: 1 as const,
                            components: [
                                { id: "input", dimension: "inputTokens" as const, unitPrice: "0.0005" },
                                { id: "output", dimension: "outputTokens" as const, unitPrice: "0.0005" },
                            ],
                        },
                        providerCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                        capabilityProfile: { maxOutputTokens: 128, supportsIdempotency: true },
                    },
                ],
            },
        ],
        systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai" as const, models: ["vendor-text"] }],
    };
}

function systemModelHeaders(logicalModelId: string, upstreamModel: string) {
    return { "x-vozeb-pro-logical-model": logicalModelId, "x-vozeb-pro-upstream-model": upstreamModel };
}

function pngBytes() {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
}

function mp4Bytes() {
    return new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]);
}

function unsafeBody(source: string) {
    const bytes = new TextEncoder().encode(source);
    return new ReadableStream<Uint8Array>({
        start(controller) {
            const repeated = new Uint8Array(8 * 1024);
            for (let offset = 0; offset < repeated.length; offset += bytes.length) repeated.set(bytes.subarray(0, Math.min(bytes.length, repeated.length - offset)), offset);
            controller.enqueue(repeated);
        },
    });
}
