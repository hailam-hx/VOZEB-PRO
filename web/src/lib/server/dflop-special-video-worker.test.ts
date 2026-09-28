import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "./video-validation-fingerprint";

import { postDflopSpecialVideoStep, submitDflopSpecialVideoSteps } from "./dflop-special-video-worker";

describe("DFLOP special validation worker", () => {
    it("posts to the DFLOP V1 path with Bearer auth and one stable generation key", async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "task-1", status: "queued" }), { headers: { "content-type": "application/json" } }));
        const body = { model: "dh-lipsync", source_video_url: "https://fixtures.example/source.mp4" };
        expect(await postDflopSpecialVideoStep({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", step: { path: "/videos/generations", body }, idempotencyKey: "validation:item", fetcher })).toMatchObject({ id: "task-1" });
        expect(fetcher).toHaveBeenCalledWith(
            "https://api.dflop.top/v1/videos/generations",
            expect.objectContaining({ method: "POST", body: JSON.stringify(body), headers: expect.objectContaining({ Authorization: "Bearer secret", "Idempotency-Key": "validation:item" }) }),
        );
    });
    it("submits a lipsync request once with its reserved request snapshot and stable idempotency key", async () => {
        const steps = [{ path: "/videos/generations", body: { model: "dh-lipsync", source_video_url: "https://fixtures.example/video.mp4", audio_url: "https://fixtures.example/audio.mp3", duration: 6 } }];
        const send = vi.fn(async () => ({ id: "task-1", status: "queued" }));
        const result = await submitDflopSpecialVideoSteps({ steps, expectedDigest: createHash("sha256").update(canonicalJson(steps)).digest("hex"), idempotencyKey: "validation:item", send });
        expect(result).toEqual({ taskId: "task-1", status: "queued" });
        expect(send).toHaveBeenCalledWith(steps[0], "validation:item");
    });

    it("chains ASR to compose and does not reuse the compose key for ASR", async () => {
        const steps = [
            { path: "/videos/clip-subtitles", body: { video_url: "https://fixtures.example/video.mp4" } },
            { path: "/videos/generations", body: { model: "clip-compose", asr_id: "$ASR_ID", video_style_id: "template" } },
        ];
        const send = vi.fn().mockResolvedValueOnce({ asr_id: "asr-1" }).mockResolvedValueOnce({ id: "task-2", status: "queued" });
        expect(await submitDflopSpecialVideoSteps({ steps, expectedDigest: createHash("sha256").update(canonicalJson(steps)).digest("hex"), idempotencyKey: "validation:item", send })).toEqual({ taskId: "task-2", status: "queued" });
        expect(send.mock.calls[0]).toEqual([steps[0], undefined]);
        expect(send.mock.calls[1]).toEqual([{ ...steps[1], body: { ...steps[1]!.body, asr_id: "asr-1" } }, "validation:item"]);
    });

    it("refuses a drifted request before sending any paid task", async () => {
        const send = vi.fn();
        await expect(submitDflopSpecialVideoSteps({ steps: [{ path: "/videos/generations", body: { model: "dh-motion" } }], expectedDigest: "different", idempotencyKey: "validation:item", send })).rejects.toThrow("VALIDATION_EXECUTION_SNAPSHOT_CHANGED");
        expect(send).not.toHaveBeenCalled();
    });
});
