import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createImage: vi.fn(),
    createVideo: vi.fn(),
    createAudio: vi.fn(),
    createText: vi.fn(),
    read: vi.fn(),
    prepare: vi.fn(),
    bind: vi.fn(),
    mark: vi.fn(),
}));

vi.mock("@/lib/server/image-task-application", () => ({ POST: mocks.createImage }));
vi.mock("@/lib/server/video-generation-application", () => ({ POST: mocks.createVideo }));
vi.mock("@/lib/server/audio-task-application", () => ({ POST: mocks.createAudio }));
vi.mock("@/lib/server/text-task-application", () => ({ POST: mocks.createText }));
vi.mock("@/app/api/image-tasks/[id]/route", () => ({ GET: mocks.read }));
vi.mock("@/app/api/video-tasks/[id]/route", () => ({ GET: mocks.read }));
vi.mock("@/app/api/audio-tasks/[id]/route", () => ({ GET: mocks.read }));
vi.mock("@/app/api/text-tasks/[id]/route", () => ({ GET: mocks.read }));
vi.mock("@/lib/server/agent-runtime-repository", () => ({
    agentTaskEntityId: (planId: string, taskKey: string) => `${planId}:${taskKey}`,
    prepareDurableAgentToolCall: mocks.prepare,
    bindDurableAgentToolCallGeneration: mocks.bind,
    markDurableAgentToolCall: mocks.mark,
}));

import { createAgentGenerationTask, GenerationApplicationError } from "./generation-application-service";

const input = {
    type: "image" as const,
    origin: "http://localhost",
    headers: { cookie: "session=one", "content-type": "application/json" },
    body: { prompt: "A" },
    runId: "run-1",
    planVersion: 1,
    taskKey: "image-1",
    idempotencyKey: "request:image-1:1:1",
};

describe("generation application service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prepare.mockResolvedValue({ id: "tool-1", status: "created", input: input.body });
        mocks.bind.mockResolvedValue(undefined);
        mocks.mark.mockResolvedValue(undefined);
    });

    it("reuses the generation already accepted for a durable tool call", async () => {
        mocks.prepare.mockResolvedValue({ id: "tool-1", status: "accepted", generationTaskId: "generation-1", input: input.body });

        await expect(createAgentGenerationTask(input)).resolves.toEqual({ task: { id: "generation-1" } });
        expect(mocks.createImage).not.toHaveBeenCalled();
    });

    it("prepares identity before creation and binds the returned generation", async () => {
        mocks.createImage.mockResolvedValue(Response.json({ task: { id: "generation-2" } }));

        await expect(createAgentGenerationTask(input)).resolves.toMatchObject({ task: { id: "generation-2" } });
        expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.createImage.mock.invocationCallOrder[0]);
        expect(mocks.bind).toHaveBeenCalledWith("tool-1", "generation-2");
    });

    it("records an unknown acceptance outcome and never reports it as a safe rejection", async () => {
        mocks.createImage.mockRejectedValue(new Error("connection reset"));

        const promise = createAgentGenerationTask(input);
        await expect(promise).rejects.toMatchObject({ outcome: "unknown" });
        await expect(promise).rejects.toBeInstanceOf(GenerationApplicationError);
        expect(mocks.mark).toHaveBeenCalledWith("tool-1", "unknown", "connection reset");
    });
});
