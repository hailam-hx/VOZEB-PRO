import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), settings: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/server/audio-voice-service", () => ({ listAudioPresetVoices: mocks.list }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: () => "http://internal" }));

import { GET } from "./route";

describe("audio preset catalog route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one" });
        mocks.list.mockResolvedValue([{ id: "alloy", name: "Alloy" }]);
        mocks.settings.mockResolvedValue(settings());
    });

    it("returns only presets for the requested logical speech model", async () => {
        const response = await GET(new Request("https://vozeb.example/api/audio-voices/presets?model=speech", { headers: { cookie: "session=one" } }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ code: 0, data: { voices: [{ id: "alloy", name: "Alloy" }] }, msg: "" });
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", cookie: "session=one", candidates: [expect.objectContaining({ channelId: "speech-channel" })] }));
    });

    it("does not expose a clone-only model as a TTS catalog", async () => {
        const response = await GET(new Request("https://vozeb.example/api/audio-voices/presets?model=clone"));
        expect(response.status).toBe(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});

function settings() {
    const channels = ["speech-channel", "clone-channel"].map((id) => ({ id, name: id, baseUrl: "https://provider.example", apiKey: "secret", apiFormat: "openai" as const, models: [id], enabled: true }));
    return {
        systemChannels: channels,
        logicalModels: [
            { id: "speech", name: "Speech", capability: "audio", enabled: true, bindings: [{ id: "speech-binding", channelId: "speech-channel", upstreamModel: "speech-channel", enabled: true, priority: 1, generationParameters: parameters("speech") }] },
            { id: "clone", name: "Clone", capability: "audio", enabled: true, bindings: [{ id: "clone-binding", channelId: "clone-channel", upstreamModel: "clone-channel", enabled: true, priority: 1, generationParameters: parameters("voice-clone") }] },
        ],
        defaultModels: { audioModel: "speech", voiceCloneModel: "clone" },
    };
}

function parameters(audioOperation: "speech" | "voice-clone") {
    return { audioOperation, referenceInputs: [], aspectRatios: [], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: [], durationSeconds: [], videoReferenceModes: [], voices: ["alloy"], formats: ["mp3"] };
}
