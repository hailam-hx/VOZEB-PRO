import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transition: vi.fn() }));

vi.mock("@/lib/server/audio-task-store", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/audio-task-store")>();
    return { ...actual, transitionAudioTask: mocks.transition };
});

import { retryAudioTaskAfterCapabilityChange } from "./audio-task-capability-retry";

describe("audio task capability retry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transition.mockImplementation(async (task, _statuses, patch) => ({ ...task, ...patch }));
    });

    it("resumes a failed pre-submission capability check with freshly resolved candidates", async () => {
        const task = audioTask({ status: "error", error: "没有兼容当前生成参数的音频渠道：当前模型不支持音色 private-voice" });
        const config = { ...task.config, voice: "private-voice", format: "mp3" };

        const retried = await retryAudioTaskAfterCapabilityChange(task, config, []);

        expect(retried).toMatchObject({ status: "pending", error: "", config });
        expect(mocks.transition).toHaveBeenCalledWith(
            task,
            ["error"],
            expect.objectContaining({ status: "pending", error: "", config, candidateConfigs: [] }),
            expect.objectContaining({ executionPhase: "created", nextPollAt: expect.any(Number), lastUpstreamStatus: "capability_retry" }),
        );
    });

    it("does not retry an uncertain submission or an unrefunded charge", async () => {
        await expect(retryAudioTaskAfterCapabilityChange(audioTask({ status: "error", error: "音频任务创建结果未知", upstream: { id: "upstream", createPath: "/audio/speech" } }), audioTask().config, [])).resolves.toBeNull();
        await expect(retryAudioTaskAfterCapabilityChange(audioTask({ status: "error", error: "没有兼容当前生成参数的音频渠道", billing: { pointsCost: 1, pointsRecordId: "charge", refunded: false } }), audioTask().config, [])).resolves.toBeNull();
        expect(mocks.transition).not.toHaveBeenCalled();
    });
});

function audioTask(patch: Record<string, unknown> = {}) {
    return {
        id: "audio-one",
        userId: "user-one",
        status: "pending" as const,
        createdAt: 1,
        updatedAt: 1,
        config: { baseUrl: "https://provider.example", apiKey: "secret", apiFormat: "openai" as const, model: "voice-tts-pro" },
        prompt: "你好",
        ...patch,
    };
}
