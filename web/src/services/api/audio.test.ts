import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(async () => undefined), syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/services/file-storage", () => ({ uploadMediaFile: vi.fn() }));
vi.mock("@/stores/use-config-store", () => ({
    resolveModelRequestConfig: vi.fn((config: Record<string, unknown>, model: string) => ({ ...config, model, apiSource: "system" })),
}));

import { createAudioGenerationTask, requestAudioGeneration, waitForAudioGenerationTask } from "./audio";
import type { AiConfig } from "@/stores/use-config-store";

const config = {
    model: "voice",
    audioModel: "voice",
    audioFormat: "mp3",
    audioInstructions: "",
    audioVoice: { type: "preset", voiceId: "alloy" },
    audioSpeed: "1",
} as AiConfig;

describe("audio API service", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("uses the trusted server audio task flow without sending channel secrets", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ task: { id: "task-1", status: "pending", model: "voice" } }))
            .mockResolvedValueOnce(json({ task: { id: "task-1", status: "success", model: "voice", result: { url: "/api/reference-assets/audio", mimeType: "audio/mpeg" } } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await requestAudioGeneration(config, "测试语音");
        const createInit = fetchMock.mock.calls[0][1] as RequestInit;
        const createBody = JSON.parse(String(createInit.body)) as { config: Record<string, unknown> };

        expect(result.blob.type).toBe("audio/mpeg");
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/audio-tasks", "/api/audio-tasks/task-1", "/api/reference-assets/audio"]);
        expect(createBody.config).toMatchObject({ model: "voice", voiceSelection: { type: "preset", voiceId: "alloy" }, format: "mp3", speed: "1" });
        expect(createBody.config).not.toHaveProperty("apiKey");
        expect(createBody.config).not.toHaveProperty("baseUrl");
        expect(createBody.config).not.toHaveProperty("advancedConfig");
    });

    it("cancels the server task when the caller aborts", async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            if (url === "/api/audio-tasks" && init?.method === "POST") {
                controller.abort();
                return json({ task: { id: "task-2", status: "pending", model: "voice" } });
            }
            if (url === "/api/audio-tasks/task-2" && init?.method === "PATCH") return json({ task: { id: "task-2", status: "cancelled", model: "voice" } });
            throw new Error(`unexpected fetch ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(requestAudioGeneration(config, "测试取消", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(fetchMock).toHaveBeenCalledWith("/api/audio-tasks/task-2", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }));
    });

    it("can persist the created task and resume polling after the page reloads", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ task: { id: "task-resume", status: "running", model: "voice" } }))
            .mockResolvedValueOnce(json({ task: { id: "task-resume", status: "success", model: "voice", result: { url: "/api/reference-assets/resumed-audio", mimeType: "audio/mpeg" } } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
        vi.stubGlobal("fetch", fetchMock);

        const task = await createAudioGenerationTask(config, "刷新后继续", { source: "canvas", surface: "canvas", projectId: "canvas-one", clientRequestId: "canvas-audio:one" });
        const createBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
        const result = await waitForAudioGenerationTask(config, task);

        expect(task).toMatchObject({ id: "task-resume", model: "voice" });
        expect(createBody).toMatchObject({ source: "canvas", context: { surface: "canvas", projectId: "canvas-one", clientRequestId: "canvas-audio:one" } });
        expect(result.url).toBe("/api/reference-assets/resumed-audio");
    });

    it("stops polling when an uncertain upstream submission fails", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ task: { id: "audio-failed", status: "error", model: "voice", error: "音频提交结果无法确认" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(waitForAudioGenerationTask(config, { id: "audio-failed", status: "running", model: "voice" })).rejects.toThrow("音频提交结果无法确认");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("continues the same audio task after a transient polling connection failure", async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce(json({ task: { id: "audio-transient-poll", status: "success", model: "voice", result: { url: "/api/reference-assets/transient-poll.mp3", mimeType: "audio/mpeg" } } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
        vi.stubGlobal("fetch", fetchMock);

        const observed = waitForAudioGenerationTask(config, { id: "audio-transient-poll", status: "running", model: "voice" }).then(
            (value) => ({ value }),
            (error) => ({ error }),
        );
        await vi.advanceTimersByTimeAsync(1800);

        await expect(observed).resolves.toMatchObject({ value: { url: "/api/reference-assets/transient-poll.mp3" } });
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/audio-tasks/audio-transient-poll", "/api/audio-tasks/audio-transient-poll", "/api/reference-assets/transient-poll.mp3"]);
    });

    it("retries the stored audio result after a transient media connection failure", async () => {
        vi.useFakeTimers();
        const completedTask = () => json({ task: { id: "audio-transient-media", status: "success", model: "voice", result: { url: "/api/reference-assets/transient-media.mp3", mimeType: "audio/mpeg" } } });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(completedTask())
            .mockRejectedValueOnce(new TypeError("Failed to fetch"))
            .mockResolvedValueOnce(completedTask())
            .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
        vi.stubGlobal("fetch", fetchMock);

        const observed = waitForAudioGenerationTask(config, { id: "audio-transient-media", status: "running", model: "voice" }).then(
            (value) => ({ value }),
            (error) => ({ error }),
        );
        await vi.advanceTimersByTimeAsync(1800);

        await expect(observed).resolves.toMatchObject({ value: { url: "/api/reference-assets/transient-media.mp3" } });
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/audio-tasks/audio-transient-media", "/api/reference-assets/transient-media.mp3", "/api/audio-tasks/audio-transient-media", "/api/reference-assets/transient-media.mp3"]);
    });
});

function json(value: unknown) {
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
