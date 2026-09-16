import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    createTextTask: vi.fn(),
    getAuthSettings: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    rate: vi.fn(),
    resolveAgentTextTaskContext: vi.fn(),
    scheduleGenerationTask: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-one" })) }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings, isAuthInputError: vi.fn(() => false) }));
vi.mock("@/lib/server/agent-run-store", () => ({ resolveAgentTextTaskContext: mocks.resolveAgentTextTaskContext }));
vi.mock("@/lib/server/generation-task-store", () => ({ getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest, withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit }));
vi.mock("@/lib/server/security", () => ({ checkGenerationRateLimit: mocks.rate, rateLimitHeaders: vi.fn(() => ({})) }));
vi.mock("@/lib/server/text-task-store", () => ({ createTextTask: mocks.createTextTask }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: vi.fn() }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn((origin: string) => origin) }));

import { POST } from "./route";

describe("text task route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.rate.mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 60_000 });
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.resolveAgentTextTaskContext.mockResolvedValue({ runId: "run-one", parentTaskId: "script", clientRequestId: "agent:script:1:1", attemptNo: 1 });
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue(null);
        mocks.getAuthSettings.mockResolvedValue(settings());
        mocks.createTextTask.mockImplementation(async (input) => ({ ...input, id: "text-new", status: "pending", createdAt: 1, updatedAt: 1 }));
    });

    it("returns the existing Agent child for the same stable request identity", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue({
            id: "text-existing",
            userId: "user-one",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            config: { baseUrl: "https://text.example.com", apiKey: "system", apiFormat: "openai", model: "text-upstream", logicalModel: "text" },
            messages: [{ role: "user", content: "write the script" }],
        });

        const response = await POST(request("write the script"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ task: { id: "text-existing", status: "running", model: "text" } });
        expect(mocks.getStoredGenerationTaskByRequest).toHaveBeenCalledWith("text", "user-one", "agent:script:1:1", 1);
        expect(mocks.createTextTask).not.toHaveBeenCalled();
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
    });

    it("rejects a stable request identity reused with different text", async () => {
        mocks.getStoredGenerationTaskByRequest.mockResolvedValue({
            id: "text-existing",
            userId: "user-one",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            config: { baseUrl: "https://text.example.com", apiKey: "system", apiFormat: "openai", model: "text-upstream", logicalModel: "text" },
            messages: [{ role: "user", content: "original script" }],
        });

        const response = await POST(request("changed script"));

        expect(response.status).toBe(409);
        expect(mocks.createTextTask).not.toHaveBeenCalled();
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
    });

    it("rejects a conflicting task returned by an atomic create race", async () => {
        mocks.createTextTask.mockResolvedValue({
            id: "text-existing",
            userId: "user-one",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            config: { baseUrl: "https://text.example.com", apiKey: "system", apiFormat: "openai", model: "text-upstream", logicalModel: "text" },
            messages: [{ role: "user", content: "other content" }],
        });

        const response = await POST(request("write the script"));

        expect(response.status).toBe(409);
        expect(mocks.scheduleGenerationTask).not.toHaveBeenCalled();
    });
});

function request(content: string) {
    return new Request("http://localhost/api/text-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { model: "text" }, messages: [{ role: "user", content }], context: { runId: "run-one", parentTaskId: "script", executionId: "execution-one" } }),
    });
}

function settings() {
    return {
        systemChannels: [{ id: "text-channel", name: "Text", baseUrl: "https://text.example.com", apiKey: "secret", apiFormat: "openai", models: ["text-upstream"], enabled: true }],
        logicalModels: [{ id: "text", name: "Text", capability: "text", enabled: true, bindings: [{ id: "text-binding", channelId: "text-channel", upstreamModel: "text-upstream", enabled: true, priority: 1 }] }],
        defaultModels: { textModel: "text" },
        generationConcurrency: { text: 2 },
    };
}
