import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    createImageTask: vi.fn(),
    getAuthSettings: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    rate: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
    scheduleGenerationTask: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: mocks.after };
});

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-one", role: "user" })) }));
vi.mock("@/lib/auth/store", () => ({
    getAuthSettings: mocks.getAuthSettings,
    isAuthInputError: vi.fn(() => false),
    refundUserPoints: vi.fn(),
}));
vi.mock("@/lib/server/generation-task-store", () => ({
    getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest,
    linkStoredGenerationTask: vi.fn(),
    withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit,
}));
vi.mock("@/lib/server/security", () => ({
    checkGenerationRateLimit: mocks.rate,
    rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/image-task-store", () => ({
    createImageTask: mocks.createImageTask,
    getImageTask: vi.fn(),
    touchImageTask: vi.fn(),
    transitionImageTask: vi.fn(),
    updateImageTask: vi.fn(),
}));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: vi.fn() }));

import { maxDuration, POST } from "./route";

describe("image task route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(undefined);
        mocks.rate.mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 60_000 });
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "image-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));
    });

    it("keeps background image submission alive past the five minute route default", () => {
        expect(maxDuration).toBeGreaterThanOrEqual(40 * 60);
    });

    it("returns the existing task before settings, rate, and concurrency checks", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue({
            id: "existing-image-task",
            kind: "generation",
            status: "running",
            config: { model: "image-upstream", logicalModel: "image-logical" },
        });

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-VOZEB-PRO-Client-Request-Id": "image-workbench:conversation:slot",
                    "X-VOZEB-PRO-Attempt-No": "3",
                },
                body: JSON.stringify({ prompt: "same request", context: { clientRequestId: "image-workbench:conversation:slot", attemptNo: 3 } }),
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ task: { id: "existing-image-task", status: "running", model: "image-logical" } });
        expect(mocks.getStoredGenerationTaskByRequest).toHaveBeenCalledWith("image", "user-one", "image-workbench:conversation:slot", 3);
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.rate).not.toHaveBeenCalled();
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
    });

    it("skips an incompatible binding and persists the compatible binding profile", async () => {
        mocks.getAuthSettings.mockResolvedValue(imageSettings([generationParameters({ qualities: ["low"] }), generationParameters({ qualities: ["high"] })]));

        const response = await POST(imageRequest({ model: "image", quality: "high", size: "auto" }));

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ channelId: "two", logicalModel: "image", generationParameters: expect.objectContaining({ qualities: ["high"] }) }) }));
        expect(mocks.scheduleGenerationTask).toHaveBeenCalledOnce();
    });

    it("rejects an unsupported concrete image request before task creation or scheduling", async () => {
        mocks.getAuthSettings.mockResolvedValue(imageSettings([generationParameters({ qualities: ["low"] }), generationParameters({ qualities: ["medium"] })]));

        const response = await POST(imageRequest({ model: "image", quality: "high", size: "auto" }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("画质 high");
        expect(mocks.createImageTask).not.toHaveBeenCalled();
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
    });

    it("persists independently resolved Auto options and per-binding image counts", async () => {
        const settings = imageSettings([generationParameters({ aspectRatios: ["1:1"], qualities: ["low"], maxBatchSize: 4 }), generationParameters({ aspectRatios: ["3:4"], qualities: ["medium"], maxBatchSize: 2 })]);
        settings.generationDefaults = { imageQuality: "high", imageSize: "16:9", imageCount: 3 };
        mocks.getAuthSettings.mockResolvedValue(settings);

        const response = await POST(imageRequest({ model: "image", quality: "auto", size: "auto", count: "auto" }));

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ channelId: "one", quality: "low", size: "1:1", count: 3 }),
                candidateConfigs: [expect.objectContaining({ channelId: "two", quality: "medium", size: "3:4", count: 1 })],
            }),
        );
    });
});

function imageRequest(config: Record<string, unknown>) {
    return new Request("http://localhost/api/image-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, prompt: "生成一张图片" }) });
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

function imageSettings(profiles: Record<string, unknown>[]) {
    const systemChannels = ["one", "two"].map((id, index) => ({ id, name: id, baseUrl: `https://${id}.example.com`, apiKey: "secret", apiFormat: "openai" as const, models: [`image-${id}`], enabled: true }));
    return {
        systemChannels,
        logicalModels: [
            {
                id: "image",
                name: "Image",
                capability: "image" as const,
                enabled: true,
                bindings: systemChannels.map((channel, index) => ({ id: channel.id, channelId: channel.id, upstreamModel: channel.models[0], enabled: true, priority: index + 1, generationParameters: profiles[index] })),
            },
        ],
        defaultModels: { imageModel: "image" },
        generationConcurrency: { image: 2 },
        generationDefaults: { imageQuality: "auto", imageSize: "auto", imageCount: 1 },
    };
}
