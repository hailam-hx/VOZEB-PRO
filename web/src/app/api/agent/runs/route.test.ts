import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    getLocale: vi.fn(),
    checkRateLimit: vi.fn(),
    countActiveStoredGenerationTasks: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
    runGenerationTaskRecoveryBatch: vi.fn(),
    createAgentRun: vi.fn(),
    getAgentRunByClientRequestId: vi.fn(),
    listAgentRuns: vi.fn(),
    resolveLogicalModelCandidates: vi.fn(),
    resolveBindingImageGenerationCandidates: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("next-intl/server", () => ({ getLocale: mocks.getLocale }));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.runGenerationTaskRecoveryBatch }));
vi.mock("@/lib/server/agent-run-store", () => ({ createAgentRun: mocks.createAgentRun, getAgentRunByClientRequestId: mocks.getAgentRunByClientRequestId, listAgentRuns: mocks.listAgentRuns }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/logical-model-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/logical-model-router")>()), resolveLogicalModelCandidates: mocks.resolveLogicalModelCandidates }));
vi.mock("@/lib/server/capability-constraints", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/capability-constraints")>()), resolveBindingImageGenerationCandidates: mocks.resolveBindingImageGenerationCandidates }));

import { GET, maxDuration, POST } from "./route";
import { ImageQualityResolutionError } from "@/lib/server/image-quality-resolver";

describe("POST /api/agent/runs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user" });
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { agent: 2 }, generationDefaults: { createPromptMaxLength: 4000 } });
        mocks.getLocale.mockResolvedValue("vi");
        mocks.checkRateLimit.mockReturnValue({ allowed: true });
        mocks.countActiveStoredGenerationTasks.mockResolvedValue(0);
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAgentRunByClientRequestId.mockResolvedValue(null);
        mocks.resolveLogicalModelCandidates.mockReturnValue([]);
        mocks.resolveBindingImageGenerationCandidates.mockReturnValue({ candidates: [] });
    });

    it("keeps Agent recovery alive while long media children are running", () => {
        expect(maxDuration).toBeGreaterThanOrEqual(40 * 60);
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await POST(request(validInput()));
        expect(response.status).toBe(401);
    });

    it("enforces chat surface invariants before creating a run", async () => {
        const response = await POST(request({ ...validInput(), projectId: "project" }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ msg: "普通对话不接受项目或快照", data: { publicMessage: "普通对话不接受项目或快照" } });
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("rejects a prompt beyond the administrator-defined character limit", async () => {
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { agent: 2 }, generationDefaults: { createPromptMaxLength: 5 } });
        mocks.createAgentRun.mockResolvedValue({ run: { id: "new-run", userId: "user", clientRequestId: "request-one" }, conversation: { id: "conversation" }, created: true });

        const response = await POST(request({ ...validInput(), prompt: "123456" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ msg: "创作需求不能超过 5 个字符" });
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("returns an existing idempotent run before rate and concurrency checks", async () => {
        mocks.getAgentRunByClientRequestId.mockResolvedValue({ id: "existing-run", userId: "user", clientRequestId: "request-one" });
        const response = await POST(request(validInput()));
        expect(await response.json()).toMatchObject({ data: { run: { id: "existing-run" }, created: false } });
        expect(mocks.checkRateLimit).not.toHaveBeenCalled();
        expect(mocks.withGenerationConcurrencyLimit).not.toHaveBeenCalled();
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("returns typed profile revision metadata before creating an Agent run", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { agent: 2 },
            generationDefaults: { createPromptMaxLength: 4000 },
            logicalModels: [{ id: "image-model", name: "Image", capability: "image", enabled: true, bindings: [] }],
            systemChannels: [],
        });
        mocks.resolveLogicalModelCandidates.mockReturnValue([{ logicalModelId: "image-model" }]);
        mocks.resolveBindingImageGenerationCandidates.mockReturnValue({ candidates: [], error: new ImageQualityResolutionError("QUALITY_PROFILE_CHANGED", "画质配置已更新，请重新确认后提交", "profile-current") });

        const response = await POST(
            request({
                ...validInput(),
                modelIds: ["image-model"],
                preferences: { mode: "image", image: { quality: "high", qualityProfileRevision: "profile-old", qualityOptionRevision: "option-old" } },
            }),
        );

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 409, data: { errorCode: "QUALITY_PROFILE_CHANGED", currentProfileRevision: "profile-current" } });
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("validates image bindings with the selected reference asset count", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationConcurrency: { agent: 2 },
            generationDefaults: { createPromptMaxLength: 4000 },
            logicalModels: [{ id: "kling-expand", name: "可灵扩图", capability: "image", enabled: true, bindings: [] }],
            systemChannels: [],
        });
        mocks.resolveLogicalModelCandidates.mockReturnValue([{ logicalModelId: "kling-expand" }]);
        mocks.resolveBindingImageGenerationCandidates.mockReturnValue({ candidates: [{ logicalModelId: "kling-expand" }] });
        mocks.createAgentRun.mockResolvedValue({ run: { id: "new-run", userId: "user", clientRequestId: "request-one" }, conversation: { id: "conversation" }, created: true });

        const response = await POST(
            request({
                ...validInput(),
                assetIds: ["reference-image"],
                modelIds: ["kling-expand"],
                preferences: { mode: "image" },
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.resolveBindingImageGenerationCandidates).toHaveBeenCalledWith(expect.any(Array), {}, expect.any(Object), 1, false, "生成一张图", expect.any(Function));
    });

    it("creates a pre-scheduled run and queues recovery without a second task update", async () => {
        const run = { id: "new-run", userId: "user", clientRequestId: "request-one" };
        mocks.createAgentRun.mockResolvedValue({ run, conversation: { id: "conversation" }, created: true });
        const response = await POST(request(validInput()));
        expect(await response.json()).toMatchObject({ data: { run: { id: "new-run" }, conversation: { id: "conversation" }, created: true } });
        expect(mocks.createAgentRun).toHaveBeenCalledWith(
            "user",
            {
                ...validInput(),
                originalPrompt: "生成一张图",
                conversationId: undefined,
                projectId: undefined,
                skillIds: [],
                modelIds: [],
                snapshot: undefined,
            },
            "vi",
            undefined,
        );
        expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    });
});

describe("GET /api/agent/runs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user" });
        mocks.listAgentRuns.mockResolvedValue([]);
    });

    it("passes entity filters to the store instead of filtering a fixed in-memory page", async () => {
        const response = await GET(new Request("http://localhost/api/agent/runs?conversationId=conversation-one&projectId=project-one&surface=canvas"));

        expect(response.status).toBe(200);
        expect(mocks.listAgentRuns).toHaveBeenCalledWith({ userId: "user", conversationId: "conversation-one", projectId: "project-one", surface: "canvas", statuses: undefined, limit: 50 });
    });

    it("queries the latest active run directly for workspace recovery", async () => {
        const response = await GET(new Request("http://localhost/api/agent/runs?surface=chat&status=active&limit=1"));

        expect(response.status).toBe(200);
        expect(mocks.listAgentRuns).toHaveBeenCalledWith({ userId: "user", conversationId: "", projectId: "", surface: "chat", statuses: ["planning", "running", "paused"], limit: 1 });
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/agent/runs", { method: "POST", headers: { "content-type": "application/json", cookie: "session=test" }, body: JSON.stringify(body) });
}

function validInput() {
    return { clientRequestId: "request-one", surface: "chat", prompt: "生成一张图", assetIds: [] };
}
