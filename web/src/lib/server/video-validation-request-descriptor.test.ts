import { describe, expect, it, vi } from "vitest";

import { captureVideoValidationRequest, createUpstream } from "./video-generation-application";

const channel = {
    model: "video-fixture",
    baseUrl: "https://api.dflop.top/v1",
    apiKey: "test-only",
    apiFormat: "openai",
    advancedConfig: {
        protocol: "dflop",
        createPath: "/videos/generations",
        queryPath: "/videos/generations/:task_id",
        requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}"}',
        statusField: "status",
        resultField: "video_url",
    },
} as never;
const raw = { size: "16:9", vquality: "720p", videoSeconds: "5", videoGenerateAudio: false, videoWatermark: false };

describe("video validation prepared request identity", () => {
    it("captures the adapter's real JSON payload without any provider request", async () => {
        const outbound = vi.spyOn(globalThis, "fetch");
        try {
            const first = await captureVideoValidationRequest({ channel, raw, references: [], multipliers: {} as never, idempotencyKey: "key-a" });
            const same = await captureVideoValidationRequest({ channel, raw, references: [], multipliers: {} as never, idempotencyKey: "key-b" });
            const changed = await captureVideoValidationRequest({ channel, raw: { ...raw, videoSeconds: "10" }, references: [], multipliers: {} as never, idempotencyKey: "key-a" });
            expect(first).toMatch(/^[a-f0-9]{64}$/);
            expect(same).toBe(first);
            expect(changed).not.toBe(first);
            expect(outbound).not.toHaveBeenCalled();
        } finally {
            outbound.mockRestore();
        }
    });

    it("rejects a changed payload before proxy or provider submission", async () => {
        const digest = await captureVideoValidationRequest({ channel, raw, references: [], multipliers: {} as never, idempotencyKey: "key" });
        const outbound = vi.spyOn(globalThis, "fetch");
        try {
            await expect(
                createUpstream("test", "http://localhost", "", channel, "A simple static scene with gentle natural motion.", { ...raw, videoSeconds: "10" }, [], {} as never, "request", "", 1, "", {
                    mode: "validation",
                    idempotencyKey: "key",
                    expectedPayloadDigest: digest,
                }),
            ).rejects.toThrow("VALIDATION_EXECUTION_SNAPSHOT_CHANGED");
            expect(outbound).not.toHaveBeenCalled();
        } finally {
            outbound.mockRestore();
        }
    });
});
