import { describe, expect, it } from "vitest";

import { normalizeGenerationConcurrency, normalizeGenerationDefaults } from "./store-normalizers";

describe("generation default normalization", () => {
    it("preserves administrator-defined video quality and positive duration", () => {
        expect(normalizeGenerationDefaults({ videoQuality: "1440", videoSeconds: 60 })).toMatchObject({ videoQuality: "1440", videoSeconds: 60 });
        expect(normalizeGenerationDefaults({ videoQuality: "2K", videoSeconds: -1 })).toMatchObject({ videoQuality: "2K", videoSeconds: -1 });
    });

    it("falls back only when the configured video duration is nonpositive", () => {
        expect(normalizeGenerationDefaults({ videoSeconds: 0 }).videoSeconds).toBe(5);
        expect(normalizeGenerationDefaults({ videoSeconds: 1.5 }).videoSeconds).toBe(1.5);
    });

    it("preserves every generation-default Auto sentinel", () => {
        expect(normalizeGenerationDefaults({ imageSize: "auto", imageQuality: "auto", videoQuality: "auto", videoSeconds: -1, audioVoice: "auto", audioFormat: "auto" })).toMatchObject({
            imageSize: "auto",
            imageQuality: "auto",
            videoQuality: "auto",
            videoSeconds: -1,
            audioVoice: "auto",
            audioFormat: "auto",
        });
    });

    it("preserves configured ratio and exact-size defaults without a platform allowlist", () => {
        expect(normalizeGenerationDefaults({ imageSize: "5:4" }).imageSize).toBe("5:4");
        expect(normalizeGenerationDefaults({ imageSize: " 1024 × 768 " }).imageSize).toBe("1024x768");
    });

    it("preserves arbitrary provider defaults and fractional duration", () => {
        expect(normalizeGenerationDefaults({ imageQuality: "ultra", videoQuality: "2K", videoSeconds: 1.5, audioVoice: "narrator", audioFormat: "m4a" })).toMatchObject({
            imageQuality: "ultra",
            videoQuality: "2K",
            videoSeconds: 1.5,
            audioVoice: "narrator",
            audioFormat: "m4a",
        });
    });

    it("preserves administrator-defined positive concurrency without platform ceilings", () => {
        expect(normalizeGenerationConcurrency({ agent: 11, image: 12, video: 6, audio: 13, text: 21, render: 7 })).toEqual({ agent: 11, image: 12, video: 6, audio: 13, text: 21, render: 7 });
    });
});
