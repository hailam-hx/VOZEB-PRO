import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProfile: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/server/voice-profile-store", () => ({ getVoiceProfileForUser: mocks.getProfile }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.fetch }));

import { listAudioPresetVoices, resolveAudioVoiceCandidates } from "./audio-voice-service";

describe("audio voice resolution", () => {
    beforeEach(() => vi.clearAllMocks());

    it("validates static presets independently for every speech binding", async () => {
        const candidates = [candidate("one", { voices: ["alloy"], voiceCatalog: "static" }), candidate("two", { voices: ["nova"], voiceCatalog: "static" })];

        const resolved = await resolveAudioVoiceCandidates({ userId: "user-one", selection: { type: "preset", voiceId: "nova" }, candidates, origin: "http://internal" });

        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({ channelId: "two", voice: "nova", voiceSelection: { type: "preset", voiceId: "nova" } });
    });

    it("pins cloned speech to its owning ready profile channel and never returns the provider id publicly", async () => {
        mocks.getProfile.mockResolvedValue({ id: "profile-one", userId: "user-one", name: "My Voice", status: "ready", channelId: "two", providerVoiceId: "provider-secret" });
        const candidates = [candidate("one", { supportsClonedVoices: true }), candidate("two", { supportsClonedVoices: true })];

        const resolved = await resolveAudioVoiceCandidates({ userId: "user-one", selection: { type: "profile", voiceProfileId: "profile-one" }, candidates, origin: "http://internal" });

        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({ channelId: "two", voice: "provider-secret", voiceSelection: { type: "profile", voiceProfileId: "profile-one" }, voiceDisplayName: "My Voice" });
        expect(JSON.stringify(resolved[0].voiceSelection)).not.toContain("provider-secret");
    });

    it("loads provider presets from the exact configured catalog path without a timed server cache", async () => {
        mocks.fetch.mockResolvedValue(
            Response.json({
                voices: [{ id: "private", name: "Private" }],
                presets: [{ id: "alloy", name: "Alloy" }],
            }),
        );
        const voices = await listAudioPresetVoices({ candidates: [candidate("one", { voiceCatalog: "provider" }, "/voice/catalog")], origin: "http://internal", cookie: "session=one", userId: "user-one" });

        expect(voices).toEqual([{ id: "alloy", name: "Alloy" }]);
        expect(mocks.fetch).toHaveBeenCalledWith("http://internal/api/ai/system/one/voice/catalog", expect.objectContaining({ cache: "no-store" }));
    });

    it("never accepts cloned voice entries or generic catalog arrays as public presets", async () => {
        mocks.fetch.mockResolvedValueOnce(Response.json({ voices: [{ id: "private", name: "Private" }], presets: [] })).mockResolvedValueOnce(Response.json({ data: [{ id: "also-private", name: "Also private" }] }));

        const first = await listAudioPresetVoices({ candidates: [candidate("one", { voiceCatalog: "provider" }, "/voice/catalog")], origin: "http://internal", userId: "user-one" });
        const second = await listAudioPresetVoices({ candidates: [candidate("two", { voiceCatalog: "provider" }, "/voice/catalog")], origin: "http://internal", userId: "user-one" });

        expect(first).toEqual([]);
        expect(second).toEqual([]);
    });

    it("keeps usable bindings when another provider catalog is temporarily unavailable", async () => {
        mocks.fetch.mockRejectedValueOnce(new Error("network unavailable"));

        const voices = await listAudioPresetVoices({ candidates: [candidate("one", { voiceCatalog: "provider" }, "/voice/catalog"), candidate("two", { voices: ["nova"], voiceCatalog: "static" })], origin: "http://internal", userId: "user-one" });

        expect(voices).toEqual([{ id: "nova", name: "nova" }]);
    });
});

function candidate(channelId: string, generationParameters: Record<string, unknown>, catalogPath = "") {
    return {
        apiSource: "system" as const,
        baseUrl: `/api/ai/system/${channelId}`,
        apiKey: "system" as const,
        apiFormat: "openai" as const,
        model: "voice-tts-pro",
        logicalModel: "speech",
        channelId,
        generationParameters: { audioOperation: "speech", voices: [], formats: ["mp3"], ...generationParameters },
        advancedConfig: { catalogPath },
    };
}
