import { describe, expect, it } from "vitest";

import { applyAgentGenerationCapability, shouldShowVideoFrameControls } from "./creative-composer-video-mode";

describe("shouldShowVideoFrameControls", () => {
    it("shows first and last frame slots for explicit video mode", () => {
        expect(shouldShowVideoFrameControls("video", { video: { referenceMode: "first_last" } })).toBe(true);
    });

    it("shows frame slots when Agent parameters explicitly select video", () => {
        expect(shouldShowVideoFrameControls("agent", { mode: "video", video: { referenceMode: "first_frame" } })).toBe(true);
        expect(shouldShowVideoFrameControls("agent", { mode: "image", video: { referenceMode: "first_last" } })).toBe(false);
        expect(shouldShowVideoFrameControls("agent", { mode: "video", video: { referenceMode: "reference" } })).toBe(false);
    });

    it("ignores stale video preferences after switching to another explicit mode", () => {
        expect(shouldShowVideoFrameControls("image", { mode: "video", video: { referenceMode: "first_last" } })).toBe(false);
        expect(shouldShowVideoFrameControls("audio", { video: { referenceMode: "first_frame" } })).toBe(false);
    });

    it("makes Smart Reference the default when Agent switches to video", () => {
        expect(applyAgentGenerationCapability("agent", "video", { image: { quality: "high" } })).toEqual({
            mode: "video",
            image: { quality: "high" },
            video: { referenceMode: "reference" },
        });
    });

    it("makes Smart Reference the default when entering explicit video mode", () => {
        expect(applyAgentGenerationCapability("video", "video", { mode: "video" })).toEqual({
            mode: "video",
            video: { referenceMode: "reference" },
        });
    });

    it("keeps an existing video reference mode and its frame assignments", () => {
        expect(
            applyAgentGenerationCapability("agent", "video", {
                video: { referenceMode: "first_last", firstFrameAssetId: "first", lastFrameAssetId: "last" },
            }),
        ).toEqual({
            mode: "video",
            video: { referenceMode: "first_last", firstFrameAssetId: "first", lastFrameAssetId: "last" },
        });
    });

    it("clears stale frame assignments when applying the Smart Reference default", () => {
        expect(
            applyAgentGenerationCapability("agent", "video", {
                video: { firstFrameAssetId: "first", lastFrameAssetId: "last" },
            }),
        ).toEqual({ mode: "video", video: { referenceMode: "reference" } });
    });

    it("does not change preferences outside Agent mode when another capability is edited", () => {
        expect(applyAgentGenerationCapability("image", "video", { mode: "image" })).toEqual({ mode: "image" });
    });
});
