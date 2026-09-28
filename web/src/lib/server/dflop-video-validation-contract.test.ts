import { describe, expect, it } from "vitest";

import { dflopVideoValidationContract } from "./dflop-video-validation-contract";

describe("DFLOP video validation contract", () => {
    it("keeps Grok text and image-only SKUs distinct", () => {
        expect(dflopVideoValidationContract("grok-imagine-video")).toMatchObject({ caseId: "text-to-video", allowAutoResolution: true, requestBranch: "grok-t2v", blockedReason: "GROK_PRICING_SOURCE_CONFLICT" });
        expect(dflopVideoValidationContract("grok-imagine-video-1.5-preview")).toMatchObject({ caseId: "image-to-video", allowAutoResolution: true, requestBranch: "grok-i2v", blockedReason: "GROK_PRICING_SOURCE_CONFLICT" });
    });

    it.each([
        ["dh-avatar", "avatar", "AVATAR_PRICING_SOURCE_CONFLICT"],
        ["dh-lipsync", "lipsync", "PUBLIC_VIDEO_AND_AUDIO_REQUIRED"],
        ["dh-lipsync-pro", "lipsync", "PUBLIC_VIDEO_AND_AUDIO_REQUIRED"],
        ["dh-lipsync-max", "lipsync", "PUBLIC_VIDEO_AND_AUDIO_REQUIRED"],
        ["dh-motion", "motion", "PUBLIC_VIDEO_AND_PORTRAIT_REQUIRED"],
        ["tvod-subtitle-soft", "subtitle-workflow", "SUBTITLE_RESULT_SCHEMA_UNVERIFIED"],
        ["clip-compose", "clip-compose-workflow", "ASR_PRICE_BOUND_UNVERIFIED"],
    ])("does not mistake %s for generic text-to-video", (modelId, caseId, blockedReason) => {
        expect(dflopVideoValidationContract(modelId)).toMatchObject({ caseId, blockedReason });
    });

    it("leaves ordinary video models on the existing path", () => {
        expect(dflopVideoValidationContract("tvod-kling-video-2.5-turbo")).toBeNull();
    });
});
