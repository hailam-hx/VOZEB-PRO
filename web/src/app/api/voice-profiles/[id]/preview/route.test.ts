import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), profile: vi.fn(), settings: vi.fn(), fetch: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/server/voice-profile-store", () => ({ getVoiceProfileForUser: mocks.profile }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.fetch, resolveInternalOrigin: () => "http://internal" }));
vi.mock("@/lib/server/public-request-origin", () => ({ resolvePublicRequestOrigin: () => "https://vozeb.example" }));
vi.mock("@/lib/server/reference-asset-access", () => ({ createSignedReferenceAssetUrl: mocks.sign }));

import { GET, POST } from "./route";

describe("voice profile preview route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one" });
        mocks.settings.mockResolvedValue(settings());
        mocks.sign.mockReturnValue("https://vozeb.example/api/reference-assets/persistent/audio/preview.mp3?signature=signed");
    });

    it("returns a cached owner-scoped preview without exposing storage internals", async () => {
        mocks.profile.mockResolvedValue(profile({ previewStorageKey: "persistent/audio/preview.mp3" }));
        const response = await GET(request(), context());
        await expect(response.json()).resolves.toEqual({ code: 0, data: { cached: true, url: "https://vozeb.example/api/reference-assets/persistent/audio/preview.mp3?signature=signed" }, msg: "" });
        expect(mocks.sign).toHaveBeenCalledWith("persistent/audio/preview.mp3", "https://vozeb.example");
    });

    it("estimates the configured speech price and submits an explicit profile selection after confirmation", async () => {
        mocks.profile.mockResolvedValue(profile());
        const estimate = await GET(request(), context());
        await expect(estimate.json()).resolves.toMatchObject({ code: 0, data: { cached: false, locale: "zh-CN", estimatedPoints: 0.13 } });

        mocks.fetch.mockResolvedValue(Response.json({ task: { id: "audio-one", status: "pending", model: "speech" } }));
        const submitted = await POST(new Request(request().url, { method: "POST", headers: { cookie: "session=one" }, body: JSON.stringify({ locale: "zh-CN", confirmed: true }) }), context());
        expect(submitted.status).toBe(200);
        expect(JSON.parse(String(mocks.fetch.mock.calls[0][1].body))).toMatchObject({ config: { model: "speech", voiceSelection: { type: "profile", voiceProfileId: "profile-one" } }, source: "voice-profile-preview:profile-one" });
    });
});

function request() {
    return new Request("https://vozeb.example/api/voice-profiles/profile-one/preview?locale=zh-CN");
}
function context() {
    return { params: Promise.resolve({ id: "profile-one" }) };
}
function profile(patch = {}) {
    return { id: "profile-one", userId: "user-one", name: "我的声音", status: "ready", channelId: "channel-one", providerVoiceId: "secret", updatedAt: "2026-09-03T00:00:00.000Z", ...patch };
}
function settings() {
    return {
        defaultModels: { audioModel: "speech", voiceCloneModel: "clone" },
        generationDefaults: { audioVoice: "alloy", audioFormat: "mp3" },
        systemChannels: [{ id: "channel-one", name: "Dflop", baseUrl: "https://provider.example", apiKey: "secret", apiFormat: "openai", models: ["tts"], enabled: true }],
        logicalModels: [
            {
                id: "speech",
                name: "Speech",
                capability: "audio",
                enabled: true,
                saleRateCard: {
                    version: 1,
                    components: [
                        { id: "request", dimension: "request", unitPrice: "0.1" },
                        { id: "characters", dimension: "characters", unitPrice: "0.01" },
                    ],
                },
                bindings: [
                    {
                        id: "binding-one",
                        channelId: "channel-one",
                        upstreamModel: "tts",
                        enabled: true,
                        priority: 1,
                        generationParameters: {
                            audioOperation: "speech",
                            supportsClonedVoices: true,
                            referenceInputs: [],
                            aspectRatios: [],
                            pixelSizes: [],
                            supportsCustomSize: false,
                            qualities: [],
                            resolutions: [],
                            durationSeconds: [],
                            videoReferenceModes: [],
                            voices: ["alloy"],
                            formats: ["mp3"],
                        },
                    },
                ],
            },
        ],
    };
}
