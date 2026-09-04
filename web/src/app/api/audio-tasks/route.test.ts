import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createAudioTask: vi.fn(),
    getAuthSettings: vi.fn(),
    scheduleGenerationTask: vi.fn(),
    checkGenerationRateLimit: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    transitionAudioTask: vi.fn(),
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
vi.mock("@/lib/server/generation-task-store", () => ({
    withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit,
    getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest,
    linkStoredGenerationTask: vi.fn(),
}));
vi.mock("@/lib/server/security", () => ({
    checkGenerationRateLimit: mocks.checkGenerationRateLimit,
    rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })),
}));
vi.mock("@/lib/server/audio-task-store", () => ({
    createAudioTask: mocks.createAudioTask,
    getAudioTask: vi.fn(),
    transitionAudioTask: mocks.transitionAudioTask,
    updateAudioTask: vi.fn(),
}));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));

import { POST } from "./route";

describe("audio task model routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 });
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(null);
        mocks.transitionAudioTask.mockImplementation(async (task, _statuses, patch) => ({ ...task, ...patch }));
    });

    it("skips an incompatible binding and creates the task with the compatible profile", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"] }), generationParameters({ voices: ["alloy"] })]));
        mocks.createAudioTask.mockImplementation(async (input) => ({ ...input, id: "audio-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "alloy" }, format: "auto" }));

        expect(response.status).toBe(200);
        expect(mocks.createAudioTask).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ channelId: "two", logicalModel: "audio", generationParameters: expect.objectContaining({ voices: ["alloy"] }) }) }));
    });

    it("rejects unsupported audio preferences before creating or scheduling a task", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"] }), generationParameters({ voices: ["echo"] })]));

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "alloy" }, format: "auto" }));

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

    it("persists stable preset selection and applies speed only where the binding permits it", async () => {
        mocks.getAuthSettings.mockResolvedValue(
            audioSettings([
                generationParameters({ voices: ["nova"], formats: ["wav"], speedRange: { min: 0.5, max: 2 }, speedAppliesTo: "cloned" }),
                generationParameters({ voices: ["nova"], formats: ["flac"], speedRange: { min: 0.75, max: 0.9 }, speedAppliesTo: "all" }),
            ]),
        );
        mocks.createAudioTask.mockImplementation(async (input) => ({ ...input, id: "audio-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "nova" }, format: "auto", speed: "0.8" }));

        expect(response.status).toBe(200);
        expect(mocks.createAudioTask).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ channelId: "one", voice: "nova", voiceSelection: { type: "preset", voiceId: "nova" }, format: "wav" }),
                candidateConfigs: [expect.objectContaining({ channelId: "two", voice: "nova", format: "flac", speed: "0.8" })],
            }),
        );
        expect(mocks.createAudioTask.mock.calls[0][0].config.speed).toBeUndefined();
    });

    it("resumes the same request after a safe pre-submission capability failure", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"] }), generationParameters({ voices: ["alloy"] })]));
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue({
            id: "audio-failed",
            userId: "user",
            status: "error",
            createdAt: 1,
            updatedAt: 1,
            config: { baseUrl: "https://two.example.com", apiKey: "", apiFormat: "openai", model: "audio-two" },
            prompt: "Generate narration",
            error: "没有兼容当前生成参数的音频渠道：当前模型不支持音色 private-voice",
        });

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "alloy" }, format: "auto" }, "Generate narration", { clientRequestId: "preview-one" }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ task: { id: "audio-failed", status: "pending" } });
        expect(mocks.createAudioTask).not.toHaveBeenCalled();
    });

    it("rejects legacy raw voices and counts the prompt with Unicode code points", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"], maxCharacters: 3 }), generationParameters({ voices: ["nova"], maxCharacters: 3 })]));

        const legacy = await POST(audioRequest({ model: "audio", voice: "nova" }));
        expect(legacy.status).toBe(400);
        expect(mocks.createAudioTask).not.toHaveBeenCalled();

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "nova" } }, "A😀中X"));
        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("3");
    });

    it("does not truncate a valid prompt when the binding has no character limit", async () => {
        mocks.getAuthSettings.mockResolvedValue(audioSettings([generationParameters({ voices: ["nova"] }), generationParameters({ voices: ["nova"] })]));
        mocks.createAudioTask.mockImplementation(async (input) => ({ ...input, id: "audio-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));
        const prompt = "声".repeat(20_001);

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "nova" } }, prompt));

        expect(response.status).toBe(200);
        expect(mocks.createAudioTask).toHaveBeenCalledWith(expect.objectContaining({ prompt }));
    });

    it("enforces the existing audio generation rate limit before task creation", async () => {
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

        const response = await POST(audioRequest({ model: "audio", voiceSelection: { type: "preset", voiceId: "nova" } }));

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.createAudioTask).not.toHaveBeenCalled();
    });
});

function audioRequest(config: Record<string, unknown>, prompt = "Generate narration", context?: Record<string, unknown>) {
    return new Request("http://localhost/api/audio-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, prompt, context }) });
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
        defaultModels: { audioModel: "audio", voiceCloneModel: "" },
        generationConcurrency: { audio: 1 },
        generationDefaults: { audioVoice: "alloy", audioFormat: "mp3" },
    };
}
