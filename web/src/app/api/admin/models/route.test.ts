import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isSafeOutboundUrl: vi.fn(async () => true), getAuthSettings: vi.fn() }));
const savedChannel = { id: "saved", name: "已保存", baseUrl: "https://api.example.com/v1", apiKey: "test-secret-value", apiFormat: "openai", models: [], enabled: true };

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "admin", role: "admin", status: "active", adminPermissions: ["upstream.manage"] })) }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/security", () => ({ isSafeOutboundUrl: mocks.isSafeOutboundUrl }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string | URL, init?: RequestInit) => fetch(url, init) }));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));

import { POST } from "./route";
import { DEFAULT_SYSTEM_PRICING_POLICY } from "@/lib/billing/pricing-policy";

describe("admin models route", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.isSafeOutboundUrl.mockClear();
        mocks.isSafeOutboundUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({ systemChannels: [savedChannel], logicalModels: [] });
        savedChannel.apiKey = "test-secret-value";
        (globalThis as typeof globalThis & { __vozebProModelFetchCooldowns?: Map<string, number> }).__vozebProModelFetchCooldowns?.clear();
    });

    it("keeps the complete DFLOP key-visible catalog and enriches it with public metadata", async () => {
        const fetchMock = vi.fn(async (url: string | URL) => {
            if (String(url).endsWith("/api/v1/config/currency")) return Response.json({ unit: "points", points_per_cny: 60, usd_to_cny_peg: 6.74, points_per_usd: 404.4 });
            return String(url).endsWith("/api/v1/models/public")
                ? Response.json({
                      models: [
                          { id: "opaque-image", display_name: "Opaque Image", callable: true, category: "image", endpoint_type: "images_generations", image_ratios: ["1:1"], price_per_image: 0.1 },
                          { id: "voice-clone-pro", callable: true, endpoint_type: "audio_voices" },
                          { id: "suno-v5", callable: true, endpoint_type: "music_generations" },
                          { id: "unavailable", callable: false, endpoint_type: null, supported_protocols: ["openai_chat"] },
                          { id: "public-only", callable: true, endpoint_type: null, supported_protocols: ["openai_chat"] },
                      ],
                  })
                : Response.json({ data: [{ id: "opaque-image" }, { id: "voice-clone-pro" }, { id: "suno-v5" }, { id: "unavailable" }, { id: "registry-missing" }] });
        });
        vi.stubGlobal("fetch", fetchMock);
        const response = await POST(request({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", protocol: "dflop" }));
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.models).toHaveLength(5);
        expect(payload.models).toEqual(expect.arrayContaining(["opaque-image", "voice-clone-pro", "suno-v5", "unavailable", "registry-missing"]));
        expect(payload.models).not.toContain("public-only");
        expect(payload).toMatchObject({
            modelCapabilities: { "opaque-image": "image", "voice-clone-pro": "audio", "registry-missing": "text" },
            modelConfigs: { "voice-clone-pro": { createPath: "/audio/voices" } },
            modelDiscovery: {
                "opaque-image": { kind: "image", callable: true, matched: true, routable: true },
                "voice-clone-pro": { kind: "audio", callable: true, matched: true, routable: true },
                "suno-v5": { kind: "other", callable: true, matched: true, routable: false },
                unavailable: { kind: "text", callable: false, matched: true, routable: false },
                "registry-missing": { kind: "text", matched: false, routable: true },
            },
            discoveryStats: { upstreamModels: 5, publicRegistry: 5, matched: 4, unmatched: 1, callable: 3, text: 2, image: 1, video: 0, audio: 1, other: 1, filtered: 2 },
            discoveredCount: 5,
            totalCount: 5,
        });
        expect(payload.modelDiscovery["opaque-image"].upstreamMetadata).toMatchObject({
            displayName: "Opaque Image",
            generationParameters: { aspectRatios: ["1:1"] },
            providerPricingProfile: { status: "READY", dimensions: [expect.objectContaining({ kind: "IMAGE_OUTPUT", effectiveValue: "0.1" })] },
        });
        expect(payload.syncStats).toMatchObject({ created: 3, metadataFallbacks: 1 });
        expect(payload.pricingPolicyPatch).toMatchObject({ dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15" });
        expect(payload.pricingSync).toMatchObject({ stats: { models: 5, pricingProfiles: 4, missingPricing: 4 } });
        expect(fetchMock).toHaveBeenCalledWith("https://api.dflop.top/v1/models", expect.objectContaining({ headers: { authorization: "Bearer secret" } }));
        expect(fetchMock).toHaveBeenCalledWith("https://api.dflop.top/api/v1/models/public", expect.objectContaining({ cache: "no-store", headers: { accept: "application/json", "user-agent": "HOTX-AI-DFLOP-Discovery" } }));
        expect(fetchMock).toHaveBeenCalledWith("https://api.dflop.top/api/v1/config/currency", expect.objectContaining({ cache: "no-store", headers: { accept: "application/json", "user-agent": "HOTX-AI-DFLOP-Discovery" } }));
    });

    it("falls back to the key-visible DFLOP catalog when public metadata cannot be fetched", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string | URL) => (String(url).endsWith("/public") ? Response.json({}, { status: 503 }) : Response.json({ data: [{ id: "fallback-chat" }, { id: "fallback-video" }] }))),
        );
        const response = await POST(request({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", protocol: "dflop" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            models: ["fallback-chat", "fallback-video"],
            modelCapabilities: { "fallback-chat": "text", "fallback-video": "video" },
            discoveryStats: { upstreamModels: 2, publicRegistry: 0, matched: 0, unmatched: 2, text: 1, video: 1, filtered: 0 },
            warning: expect.stringContaining("公共模型元数据不可用"),
        });
    });

    it("derives below-cost counts from the preview logical-model diagnostics", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            systemChannels: [savedChannel],
            logicalModels: [],
            pricingPolicy: { ...DEFAULT_SYSTEM_PRICING_POLICY, markupMultiplier: "0.9", version: "preview-policy" },
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string | URL) => {
                if (String(url).endsWith("/api/v1/models/public")) return Response.json({ models: [{ id: "image-priced", category: "image", endpoint_type: "images_generations", callable: true, price_per_image: "80" }] });
                if (String(url).endsWith("/api/v1/config/currency")) return Response.json({ unit: "points", points_per_cny: 60 });
                return Response.json({ data: [{ id: "image-priced" }] });
            }),
        );

        const response = await POST(request({ channelId: "saved", baseUrl: "https://api.dflop.top/v1", protocol: "dflop" }));

        expect(await response.json()).toMatchObject({ pricingSync: { stats: { belowCostWarnings: 1 } } });
    });

    it("falls back when the DFLOP public endpoint returns an invalid registry shape", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string | URL) => (String(url).endsWith("/public") ? Response.json({ data: [] }) : Response.json({ data: [{ id: "fallback-chat" }] }))),
        );

        const response = await POST(request({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", protocol: "dflop" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ models: ["fallback-chat"], warning: expect.stringContaining("公共模型元数据不可用") });
    });

    it("does not use the public DFLOP registry when the API-key catalog request fails", async () => {
        const fetchMock = vi.fn(async () => Response.json({ error: { message: "invalid api key" } }, { status: 401 }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ baseUrl: "https://api.dflop.top/v1", apiKey: "bad-secret", protocol: "dflop" }));

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "invalid api key" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("https://api.dflop.top/v1/models", expect.anything());
    });

    it("uses the saved server-side API key when the client sends only channelId", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-test" }] }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);
        const response = await POST(request({ channelId: "saved" }));
        expect(await response.json()).toMatchObject({ models: ["gpt-test"], modelCapabilities: { "gpt-test": "text" }, discoveredCount: 1, totalCount: 1 });
        expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/models", expect.objectContaining({ headers: { authorization: "Bearer test-secret-value" } }));
    });

    it("loads a keyless Stable Diffusion model catalog without authentication", async () => {
        const fetchMock = vi.fn(async () => Response.json([{ model_name: "sdxl", title: "SDXL" }]));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ baseUrl: "https://sd.example.com", apiKey: "", protocol: "stable-diffusion", authMode: "none" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ models: ["SDXL"] });
        expect(fetchMock).toHaveBeenCalledWith("https://sd.example.com/sdapi/v1/sd-models", expect.objectContaining({ headers: {} }));
    });

    it("classifies opaque models from the selected protocol catalog", async () => {
        const fetchMock = vi.fn(async () => Response.json({ data: [{ id: "opaque-seedance-model", object: "model" }] }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ baseUrl: "https://video.example.com", apiKey: "secret", protocol: "seedance" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            models: ["opaque-seedance-model"],
            modelCapabilities: { "opaque-seedance-model": "video" },
            modelConfigs: { "opaque-seedance-model": { capability: "video", protocol: "seedance", createPath: "/contents/generations/tasks" } },
        });
        expect(fetchMock).toHaveBeenCalledWith("https://video.example.com/models", expect.any(Object));
    });

    it("loads every paginated provider model page and returns capability metadata", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ data: [{ id: "writer-v1", type: "text" }], has_more: true, last_id: "writer-v1" }))
            .mockResolvedValueOnce(Response.json({ data: [{ id: "image-v1", type: "image" }], has_more: false }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved" }));
        const payload = await response.json();

        expect(payload).toMatchObject({ models: ["image-v1", "writer-v1"], modelCapabilities: { "image-v1": "image", "writer-v1": "text" }, discoveredCount: 2, totalCount: 2 });
        expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/models?after=writer-v1");
    });

    it("does not add embeddings, rerankers, OCR, STT, or moderation models to the creative catalog", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json({
                    data: [
                        { id: "gpt-4.1" },
                        { id: "text-embedding-3-small" },
                        { id: "bge-reranker-v2-m3" },
                        { id: "dots.ocr" },
                        { id: "gcp-speech-to-text", capability: "audio" },
                        { id: "whisper-1", capability: "audio" },
                        { id: "omni-moderation-latest" },
                        { id: "llama-3.1-nemoguard-8b-topic-control" },
                        { id: "tts-1", capability: "audio" },
                    ],
                }),
            ),
        );

        const response = await POST(request({ channelId: "saved" }));

        expect(await response.json()).toMatchObject({ models: ["gpt-4.1", "tts-1"], modelCapabilities: { "gpt-4.1": "text", "tts-1": "audio" }, discoveredCount: 2, totalCount: 2 });
    });

    it("merges the complete Agnes official catalog when its models endpoint only returns video", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ data: [{ id: "agnes-video-v2.0", type: "video" }] })),
        );

        const response = await POST(request({ channelId: "saved", baseUrl: "https://apihub.agnes-ai.com/v1" }));
        const payload = await response.json();

        expect(payload.models).toEqual(expect.arrayContaining(["agnes-2.0-flash", "agnes-image-2.0-flash", "agnes-image-2.1-flash", "agnes-video-v2.0"]));
        expect(payload.modelCapabilities).toMatchObject({ "agnes-2.0-flash": "text", "agnes-image-2.0-flash": "image", "agnes-image-2.1-flash": "image", "agnes-video-v2.0": "video" });
        expect(payload).toMatchObject({
            provider: "agnes",
            recommendedConfig: { textModel: "agnes-2.0-flash", imageModel: "agnes-image-2.1-flash", videoModel: "agnes-video-v2.0" },
            modelConfigs: { "agnes-video-v2.0": { capability: "video", createPath: "/videos", queryPath: "/agnesapi?video_id=:task_id" } },
        });
    });

    it("keeps manually configured models when the provider returns a partial catalog", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ data: [{ id: "video-only", type: "video" }] })),
        );

        const response = await POST(request({ channelId: "saved", configuredModels: ["manual-text"], modelCapabilities: { "manual-text": "text" } }));

        expect(await response.json()).toMatchObject({ models: ["manual-text", "video-only"], modelCapabilities: { "manual-text": "text", "video-only": "video" }, discoveredCount: 1, totalCount: 2 });
    });

    it("merges company-specific text and video catalog paths", async () => {
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
            const value = String(url);
            if (value.endsWith("/v1/text-models")) return Response.json({ data: { text: ["openai-text"] } });
            if (value.endsWith("/v1/video-models")) return Response.json({ data: { video: [{ id: "sd2.0", endpoint: "/videos", query_path: "/videos/:task_id" }] } });
            return Response.json({ detail: "Not Found" }, { status: 404 });
        });
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved", modelCatalogPaths: ["/v1/text-models", "/v1/video-models"] }));

        expect(await response.json()).toMatchObject({
            models: ["openai-text", "sd2.0"],
            modelCapabilities: { "openai-text": "text", "sd2.0": "video" },
            modelConfigs: { "sd2.0": { capability: "video", createPath: "/videos", queryPath: "/videos/:task_id" } },
        });
    });

    it("accepts a same-origin /v1/models path after validating only the channel base URL", async () => {
        const fetchMock = vi.fn(async () => Response.json({ data: [{ id: "same-origin-model" }] }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved", modelCatalogPaths: ["/v1/models"] }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ models: ["same-origin-model"] });
        expect(mocks.isSafeOutboundUrl).toHaveBeenCalledTimes(1);
        expect(mocks.isSafeOutboundUrl).toHaveBeenCalledWith("https://api.example.com/v1");
        expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/models", expect.any(Object));
    });

    it("rejects a model catalog path on another origin", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved", modelCatalogPaths: ["https://other.example.com/v1/models"] }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "模型目录路径必须与 Base URL 同源" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("applies capability-level custom protocol operations to newly discovered models", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ data: { image: ["opaque-image"], video: ["opaque-video"] } })),
        );

        const response = await POST(
            request({
                channelId: "saved",
                protocol: "custom",
                modelCatalogPaths: ["/v1/models"],
                operationConfigs: {
                    image: { capability: "image", protocol: "custom", createPath: "/render", requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}"}', resultField: "image.url", source: "manual" },
                    video: { capability: "video", protocol: "custom", createPath: "/jobs", queryPath: "/jobs/:task_id", requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}"}', resultField: "video.url", source: "manual" },
                },
            }),
        );

        expect(await response.json()).toMatchObject({
            modelConfigs: {
                "opaque-image": { capability: "image", protocol: "custom", createPath: "/render", resultField: "image.url" },
                "opaque-video": { capability: "video", protocol: "custom", createPath: "/jobs", queryPath: "/jobs/:task_id", resultField: "video.url" },
            },
        });
    });

    it("keeps mixed root groups and model maps from one provider response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json({
                    text_models: [{ id: "openai-text", api_format: "openai", endpoint: "/chat/completions" }],
                    models: { "sd2.0": { capability: "video", protocol: "seedance", endpoint: "/videos", query_path: "/videos/:task_id" } },
                }),
            ),
        );

        const response = await POST(request({ channelId: "saved" }));

        expect(await response.json()).toMatchObject({
            models: ["openai-text", "sd2.0"],
            modelCapabilities: { "openai-text": "text", "sd2.0": "video" },
            modelConfigs: {
                "openai-text": { capability: "text", apiFormat: "openai", createPath: "/chat/completions" },
                "sd2.0": { capability: "video", protocol: "seedance", createPath: "/videos", queryPath: "/videos/:task_id" },
            },
        });
    });

    it("returns the complete built-in GlobalAiOpc vendor catalog without requesting an unavailable models endpoint", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(
            request({
                channelId: "saved",
                baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                protocol: "auto",
            }),
        );
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.models).toEqual(expect.arrayContaining(["gpt-4.1", "gemini-3.1-pro-preview", "gpt-image-2", "happyhorse-1.0-i2v", "videos_stable", "videos_stable_fast"]));
        expect(payload.globalAiOpcPresets).toEqual(expect.arrayContaining(["text-openai-chat", "text-gemini-native", "image-gpt-image-2", "video-happyhorse-i2v", "video-videos"]));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the documented Yumeng v2 model preset without downgrading to v1", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ baseUrl: "https://yumeng.example.com/kyyReactApiServer", apiKey: "yumeng-secret", protocol: "yumeng" }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.models).toHaveLength(26);
        expect(payload.models).toContain("seedream_5.0Pro");
        expect(payload.models).toContain("KlingO3");
        expect(payload.catalogSupported).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("pulls Yumeng models only from an explicitly configured v2 catalog", async () => {
        const fetchMock = vi.fn(async () =>
            Response.json({
                data: [
                    { id: "seedream_5.0Pro", capability: "image" },
                    { id: "seedance-2.5", capability: "video" },
                ],
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(
            request({
                baseUrl: "https://yumeng.example.com/kyyReactApiServer",
                apiKey: "yumeng-secret",
                protocol: "yumeng",
                modelCatalogPaths: ["/kyyReactApiServer/v2/model-center/models"],
            }),
        );
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.models).toEqual(expect.arrayContaining(["seedream_5.0Pro", "seedance-2.5"]));
        expect(payload.modelConfigs).toMatchObject({
            "seedream_5.0pro": { capability: "image", protocol: "yumeng", createPath: "/kyyReactApiServer/v2/model-center/tasks", queryPath: "/kyyReactApiServer/v2/model-center/tasks/:task_id" },
            "seedance-2.5": { capability: "video", protocol: "yumeng", createPath: "/kyyReactApiServer/v2/model-center/tasks", queryPath: "/kyyReactApiServer/v2/model-center/tasks/:task_id", supportsReferenceVideo: true },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("https://yumeng.example.com/kyyReactApiServer/v2/model-center/models", expect.objectContaining({ headers: { authorization: "Bearer yumeng-secret" } }));
    });

    it("redacts an API key echoed by the upstream error", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid test-secret-value" } }), { status: 401, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved" }));
        const payload = await response.json();
        expect(payload.error).toContain("[REDACTED]");
        expect(JSON.stringify(payload)).not.toContain("test-secret-value");
    });

    it("rejects provider business errors returned with HTTP 200", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: "204", msg: "登录验证失败" }), { status: 200, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved" }));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "登录验证失败" });
    });

    it("explains how to configure video providers without a model catalog", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ message: "No handler found for GET /kyyReactApiServer/v1/models" }), { status: 404, headers: { "content-type": "application/json" } })),
        );

        const response = await POST(request({ channelId: "saved" }));

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "该上游未提供模型列表接口，请在高级设置的“模型列表”手动填写模型名称；手工模型会在后续拉取时保留。" });
    });

    it("returns an explicit timeout diagnosis", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))),
        );
        const response = await POST(request({ channelId: "saved" }));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "拉取模型超时，请稍后重试" });
    });

    it("rejects an encrypted storage value before calling the provider", async () => {
        savedChannel.apiKey = "vozeb-pro-secret:v1:iv.tag.payload";
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "请先填写 Base URL 和 API Key" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/admin/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
