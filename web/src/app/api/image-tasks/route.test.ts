import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogicalModel, LogicalModelBinding, LogicalModelGenerationParameters } from "@/lib/auth/store";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    createImageTask: vi.fn(),
    getAuthSettings: vi.fn(),
    getAgentRun: vi.fn(),
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
vi.mock("@/lib/server/agent-run-store", () => ({ getAgentRun: mocks.getAgentRun }));
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
        mocks.getAgentRun.mockResolvedValue(undefined);
        mocks.rate.mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 60_000 });
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.createImageTask.mockImplementation(async (input) => ({ ...input, id: "image-task", status: "pending", createdAt: Date.now(), updatedAt: Date.now() }));
    });

    it("keeps background image submission alive past the five minute route default", () => {
        expect(maxDuration).toBeGreaterThanOrEqual(40 * 60);
    });

    it("persists the exact original manual prompt and strict provider policy", async () => {
        const original = "  让这个人物慢慢向前走  ";
        mocks.getAgentRun.mockResolvedValue({ id: "manual-run", userId: "user-one", prompt: original.trim(), originalPrompt: original, requestedModelIds: ["image"], manualPromptEnhancementEnabled: false });
        mocks.getAuthSettings.mockResolvedValue(imageSettings([generationParameters({})]));
        const response = await POST(
            new Request("http://localhost/api/image-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: { model: "image" }, prompt: original.trim(), context: { runId: "manual-run" } }) }),
        );
        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: original,
                config: expect.objectContaining({ promptEnhancementDisabled: true, promptAudit: expect.objectContaining({ originalPrompt: original, executionPrompt: original.trim(), manualPromptEnhancementEnabled: false }) }),
            }),
        );
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

    it("returns a structured validation error when every binding requires exactly one reference image", async () => {
        mocks.getAuthSettings.mockResolvedValue(
            imageSettings([generationParameters({ referenceInputs: ["image"], minReferenceImages: 1, maxReferenceImages: 1 }), generationParameters({ referenceInputs: ["image"], minReferenceImages: 1, maxReferenceImages: 1 })]),
        );

        const response = await POST(imageRequest({ model: "image", size: "auto" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ errorCode: "REFERENCE_IMAGE_REQUIRED", category: "validation", retryable: false });
        expect(mocks.createImageTask).not.toHaveBeenCalled();
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
    });

    it("keeps Smart size unresolved while persisting per-binding quality and image counts", async () => {
        const settings = imageSettings([generationParameters({ aspectRatios: ["1:1"], qualities: ["low"], maxBatchSize: 4 }), generationParameters({ aspectRatios: ["3:4"], qualities: ["medium"], maxBatchSize: 2 })]);
        settings.generationDefaults = { imageQuality: "high", imageSize: "16:9", imageCount: 3 };
        mocks.getAuthSettings.mockResolvedValue(settings);

        const response = await POST(imageRequest({ model: "image", quality: "auto", size: "auto", count: "auto" }));

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({ channelId: "one", quality: "low", count: 3 }),
                candidateConfigs: [expect.objectContaining({ channelId: "two", quality: "medium", count: 1 })],
            }),
        );
        const input = mocks.createImageTask.mock.calls[0]?.[0] as { config?: Record<string, unknown>; candidateConfigs?: Array<Record<string, unknown>> };
        expect(input.config).not.toHaveProperty("size");
        expect(input.candidateConfigs?.[0]).not.toHaveProperty("size");
    });

    it("persists binding-specific quality intent and context before scheduling", async () => {
        const settings = imageSettings([generationParameters({ maxBatchSize: 1 }), generationParameters({ maxBatchSize: 1 })]);
        settings.logicalModels[0].saleRateCard = { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1" }] };
        const profile = {
            version: 1 as const,
            controlType: "prompt_flag" as const,
            selectionMode: "explicit" as const,
            source: "provider_preset" as const,
            options: [
                { value: "standard", label: "标准", optionRevision: "ignored", effect: { type: "prompt_flag" as const, promptSuffix: "--sd" as const, mutexGroup: "midjourney-quality" as const } },
                { value: "high", label: "高清", optionRevision: "ignored", effect: { type: "prompt_flag" as const, promptSuffix: "--hd" as const, mutexGroup: "midjourney-quality" as const } },
            ],
            defaultValue: "standard",
            profileRevision: "ignored",
            validation: { status: "VALID" as const, reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" },
        };
        settings.logicalModels[0].bindings[0].imageQualityProfile = profile;
        settings.logicalModels[0].bindings[1].imageQualityProfile = { ...profile, validation: { status: "INVALID" as const, reasons: [{ code: "BAD", message: "不可执行", severity: "blocking" as const }], validatedAt: "2026-09-25T00:00:00.000Z" } };
        mocks.getAuthSettings.mockResolvedValue(settings);

        const response = await POST(imageRequest({ model: "image", quality: "high", count: 1 }));

        expect(response.status).toBe(200);
        expect(mocks.createImageTask).toHaveBeenCalledWith(
            expect.objectContaining({
                imageQualityIntent: expect.objectContaining({ value: "high" }),
                config: expect.objectContaining({ channelId: "one", imageQualityContext: expect.objectContaining({ bindingId: "one", selectedQualityValue: "high", effectivePrompt: "生成一张图片 --hd" }) }),
                candidateConfigs: [],
            }),
        );
    });

    it("returns a typed error and creates no task when every profile is invalid", async () => {
        const settings = imageSettings([generationParameters({ maxBatchSize: 1 }), generationParameters({ maxBatchSize: 1 })]);
        settings.logicalModels[0].saleRateCard = { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1" }] };
        const invalid = {
            version: 1 as const,
            controlType: "prompt_flag" as const,
            selectionMode: "explicit" as const,
            source: "manual" as const,
            options: [
                { value: "standard", label: "标准", optionRevision: "ignored", effect: { type: "prompt_flag" as const, promptSuffix: "--sd" as const, mutexGroup: "midjourney-quality" as const } },
                { value: "high", label: "高清", optionRevision: "ignored", effect: { type: "prompt_flag" as const, promptSuffix: "--hd" as const, mutexGroup: "midjourney-quality" as const } },
            ],
            profileRevision: "ignored",
            validation: { status: "INVALID" as const, reasons: [{ code: "BAD", message: "上游能力已失效", severity: "blocking" as const }], validatedAt: "2026-09-25T00:00:00.000Z" },
        };
        settings.logicalModels[0].bindings.forEach((binding) => (binding.imageQualityProfile = invalid));
        mocks.getAuthSettings.mockResolvedValue(settings);

        const response = await POST(imageRequest({ model: "image", quality: "high", count: 1 }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ errorCode: "QUALITY_CONTEXT_UNRESOLVABLE" });
        expect(mocks.createImageTask).not.toHaveBeenCalled();
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
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

function imageSettings(profiles: LogicalModelGenerationParameters[]) {
    const systemChannels = ["one", "two"].map((id, index) => ({ id, name: id, baseUrl: `https://${id}.example.com`, apiKey: "secret", apiFormat: "openai" as const, models: [`image-${id}`], enabled: true }));
    const bindings: LogicalModelBinding[] = systemChannels.map((channel, index) => ({ id: channel.id, channelId: channel.id, upstreamModel: channel.models[0], enabled: true, priority: index + 1, generationParameters: profiles[index] }));
    const logicalModels: LogicalModel[] = [{ id: "image", name: "Image", capability: "image", enabled: true, bindings }];
    return {
        systemChannels,
        logicalModels,
        defaultModels: { imageModel: "image" },
        generationConcurrency: { image: 2 },
        generationDefaults: { imageQuality: "auto", imageSize: "auto", imageCount: 1 },
    };
}
