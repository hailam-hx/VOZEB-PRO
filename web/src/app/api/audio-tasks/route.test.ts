import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createAudioTask: vi.fn(),
    getAuthSettings: vi.fn(),
    scheduleGenerationTask: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user" })) }));
vi.mock("@/lib/auth/store", () => {
    class AuthInputError extends Error {
        status = 400;
    }
    return {
        AuthInputError,
        getAuthSettings: mocks.getAuthSettings,
        defaultSettings: {
            systemChannels: [],
            logicalModels: [],
            defaultModels: { audioModel: "" },
            generationConcurrency: { audio: 1 },
            generationDefaults: { audioVoice: "alloy", audioFormat: "mp3" },
        },
        isAuthInputError: (error: unknown) => error instanceof AuthInputError,
        refundUserPoints: vi.fn(),
    };
});
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: vi.fn(async (_userId, _type, _staleMs, _limit, handler) => handler()), linkStoredGenerationTask: vi.fn() }));
vi.mock("@/lib/server/security", () => ({
    checkGenerationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 })),
    rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/server/audio-task-store", () => ({
    createAudioTask: mocks.createAudioTask,
    getAudioTask: vi.fn(),
    transitionAudioTask: vi.fn(),
    updateAudioTask: vi.fn(),
}));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));

import { POST } from "./route";

describe("audio task model routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("skips an incompatible binding and creates the task with the compatible profile", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"] }), generationParameters({ voices: ["alloy"] })]));
        mocks.createAudioTask.mockImplementation(async (input) => ({ ...input, id: "audio-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));

        const response = await POST(audioRequest({ model: "audio", voice: "alloy", format: "auto" }));

        expect(response.status).toBe(200);
        expect(mocks.createAudioTask).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ channelId: "two", logicalModel: "audio", generationParameters: expect.objectContaining({ voices: ["alloy"] }) }) }));
    });

    it("rejects unsupported audio preferences before creating or scheduling a task", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"] }), generationParameters({ voices: ["echo"] })]));

        const response = await POST(audioRequest({ model: "audio", voice: "alloy", format: "auto" }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("音色 alloy");
        expect(mocks.createAudioTask).not.toHaveBeenCalled();
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
    });

    it("rejects a forged client model when the backend has no audio default", async () => {
        mocks.getAuthSettings.mockResolvedValue({ systemChannels: [], logicalModels: [], defaultModels: { audioModel: "" }, generationConcurrency: { audio: 1 }, generationDefaults: { audioVoice: "alloy", audioFormat: "mp3" } });
        const response = await POST(
            new Request("http://localhost/api/audio-tasks", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ config: { model: "forged-audio" }, prompt: "Generate narration" }),
            }),
        );

        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("音频任务参数不完整或渠道不支持");
        expect(mocks.createAudioTask).not.toHaveBeenCalled();
    });

    it("persists binding-specific Auto voice, format, and speed instead of incompatible global defaults", async () => {
        mocks.getAuthSettings.mockResolvedValue(
            audioSettings([generationParameters({ voices: ["nova"], formats: ["wav"], speedRange: { min: 0.5, max: 2 } }), generationParameters({ voices: ["echo"], formats: ["flac"], speedRange: { min: 0.75, max: 0.9 } })]),
        );
        mocks.createAudioTask.mockImplementation(async (input) => ({ ...input, id: "audio-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));

        const response = await POST(audioRequest({ model: "audio", voice: "auto", format: "auto", speed: "auto" }));

        expect(response.status).toBe(200);
        expect(mocks.createAudioTask).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ channelId: "one", voice: "nova", format: "wav", speed: "0.5" }),
                candidateConfigs: [expect.objectContaining({ channelId: "two", voice: "echo", format: "flac", speed: "0.75" })],
            }),
        );
    });
});

function audioRequest(config: Record<string, unknown>) {
    return new Request("http://localhost/api/audio-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, prompt: "Generate narration" }) });
}

function generationParameters(patch: Record<string, unknown>) {
    return {
        referenceInputs: [],
        aspectRatios: [],
        pixelSizes: [],
        supportsCustomSize: false,
        qualities: [],
        resolutions: [],
        durationSeconds: [],
        videoReferenceModes: [],
        voices: [],
        formats: [],
        ...patch,
    };
}

function audioSettings(profiles: Record<string, unknown>[]) {
    const systemChannels = ["one", "two"].map((id) => ({ id, name: id, baseUrl: `https://${id}.example.com`, apiKey: "secret", apiFormat: "openai" as const, models: [`audio-${id}`], enabled: true }));
    return {
        systemChannels,
        logicalModels: [
            {
                id: "audio",
                name: "Audio",
                capability: "audio" as const,
                enabled: true,
                bindings: systemChannels.map((channel, index) => ({ id: channel.id, channelId: channel.id, upstreamModel: channel.models[0], enabled: true, priority: index + 1, generationParameters: profiles[index] })),
            },
        ],
        defaultModels: { audioModel: "audio" },
        generationConcurrency: { audio: 1 },
        generationDefaults: { audioVoice: "alloy", audioFormat: "mp3" },
    };
}
