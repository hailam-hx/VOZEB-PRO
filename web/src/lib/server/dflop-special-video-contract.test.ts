import { describe, expect, it } from "vitest";

import { buildDflopSpecialVideoSteps, estimateDflopSpecialVideoBound, parseDflopClipAsrId, parseDflopSpecialVideoResult } from "./dflop-special-video-contract";

const fixtures = {
    videoUrl: "https://fixtures.example.com/talking.mp4",
    videoDurationSeconds: "8",
    audioUrl: "https://fixtures.example.com/voice.mp3",
    audioDurationSeconds: "6",
    portraitUrl: "https://fixtures.example.com/person.png",
    avatarId: "avatar-ready",
};

describe("DFLOP special video contract", () => {
    it("uses a pre-provisioned avatar and the driving audio duration", () => {
        expect(buildDflopSpecialVideoSteps("dh-avatar", fixtures)).toEqual({
            kind: "avatar",
            billingDurationSeconds: "6",
            steps: [{ path: "/videos/generations", body: { model: "dh-avatar", avatar: "avatar-ready", audio_url: fixtures.audioUrl, duration: 6 } }],
        });
    });

    it.each(["dh-lipsync", "dh-lipsync-pro", "dh-lipsync-max"])("uses source video and audio for %s", (model) => {
        expect(buildDflopSpecialVideoSteps(model, fixtures)).toMatchObject({
            kind: "lipsync",
            billingDurationSeconds: "6",
            steps: [{ body: { model, source_video_url: fixtures.videoUrl, audio_url: fixtures.audioUrl, duration: 6 } }],
        });
    });

    it("binds motion tier, face count and duration to the source video", () => {
        expect(buildDflopSpecialVideoSteps("dh-motion", { ...fixtures, motionTier: "fast", faceCount: 1 })).toMatchObject({
            kind: "motion",
            billingDurationSeconds: "8",
            tier: "fast",
            steps: [{ body: { model: "dh-motion", source_video_url: fixtures.videoUrl, face_count: 1, resolution: "fast", duration: 8, content: [{ type: "image_url", image_url: { url: fixtures.portraitUrl } }] } }],
        });
    });

    it("requires one portrait for every motion face", () => {
        const urls = [fixtures.portraitUrl, "https://fixtures.example.com/person2.png"];
        expect(buildDflopSpecialVideoSteps("dh-motion", { ...fixtures, motionTier: "standard", faceCount: 2, portraitUrls: urls }).steps[0]?.body).toMatchObject({
            face_count: 2,
            content: urls.map((url) => ({ type: "image_url", image_url: { url } })),
        });
        expect(() => buildDflopSpecialVideoSteps("dh-motion", { ...fixtures, motionTier: "standard", faceCount: 2, portraitUrls: urls.slice(0, 1) })).toThrow("MOTION_PORTRAIT_COUNT_UNVERIFIED");
    });

    it("uses source video and language dimensions for subtitle output", () => {
        expect(buildDflopSpecialVideoSteps("tvod-subtitle-soft", { ...fixtures, sourceLanguage: "zh", targetLanguages: ["en"] })).toMatchObject({
            kind: "subtitle",
            billingDurationSeconds: "8",
            translationCount: 1,
            steps: [{ body: { model: "tvod-subtitle-soft", source_video_url: fixtures.videoUrl, source_language: "zh", target_languages: ["en"] } }],
        });
        expect(() => parseDflopSpecialVideoResult("tvod-subtitle-soft", { status: "succeeded", subtitles: { zh: "https://fixtures.example.com/zh.vtt", en: "https://fixtures.example.com/en.vtt" } })).toThrow("SUBTITLE_RESULT_SCHEMA_UNVERIFIED");
    });

    it("represents clip-compose as ASR followed by compose with the same source", () => {
        expect(buildDflopSpecialVideoSteps("clip-compose", { ...fixtures, templateId: "template-current" })).toMatchObject({
            kind: "clip-compose",
            steps: [
                { path: "/videos/clip-subtitles", body: { video_url: fixtures.videoUrl } },
                { path: "/videos/generations", body: { model: "clip-compose", video_url: fixtures.videoUrl, asr_id: "$ASR_ID", video_style_id: "template-current" } },
            ],
        });
        expect(parseDflopClipAsrId({ asr_id: "asr_current" })).toBe("asr_current");
        expect(() => parseDflopClipAsrId({ segments: [] })).toThrow("ASR_ID_MISSING");
    });

    it("rejects missing duration or unsafe fixture URLs", () => {
        expect(() => buildDflopSpecialVideoSteps("dh-lipsync", { ...fixtures, audioDurationSeconds: "" })).toThrow("AUDIO_DURATION_UNVERIFIED");
        expect(() => buildDflopSpecialVideoSteps("dh-motion", { ...fixtures, motionTier: "fast", videoUrl: "http://localhost:3000/source.mp4" })).toThrow("VIDEO_FIXTURE_UNAVAILABLE");
        expect(() => buildDflopSpecialVideoSteps("dh-avatar", { ...fixtures, avatarId: "" })).toThrow("AVATAR_ASSET_REQUIRED");
        expect(() => buildDflopSpecialVideoSteps("dh-motion", fixtures)).toThrow("MOTION_TIER_UNVERIFIED");
        expect(() => buildDflopSpecialVideoSteps("tvod-subtitle-soft", fixtures)).toThrow("SUBTITLE_LANGUAGE_UNVERIFIED");
    });

    it("uses the motion tier and conversion snapshot for a conservative bound", () => {
        expect(
            estimateDflopSpecialVideoBound({
                contract: buildDflopSpecialVideoSteps("dh-motion", { ...fixtures, motionTier: "fast" }),
                pricing: { status: "READY", raw: { video_price_tiers: { fast: "4.044", standard: "8.088", max: "12.132" }, price_per_video_second: "8.088" }, conversion: { dflopCreditsPerCny: "60", cnyToUsd: "0.15", hotxUsdPerCredit: "1" } },
            }),
        ).toEqual({ ok: true, estimatedProviderCost: { amount: "32.352", currency: "DFLOP_CREDITS", unit: "task" }, estimatedCredits: "0.08088", pricingSource: "PUBLIC_REGISTRY_MOTION_TIER" });
    });

    it("counts one ASR and each translation pass, and refuses unknown pricing", () => {
        const contract = buildDflopSpecialVideoSteps("tvod-subtitle-soft", { ...fixtures, sourceLanguage: "zh", targetLanguages: ["en", "vi"] });
        const pricing = { status: "READY", raw: { video_price_tiers: { asr: "0.06066", translate: "0.04044" } }, conversion: { dflopCreditsPerCny: "60", cnyToUsd: "0.15", hotxUsdPerCredit: "1" } };
        expect(estimateDflopSpecialVideoBound({ contract, pricing })).toMatchObject({ ok: true, estimatedProviderCost: { amount: "1.13232" }, estimatedCredits: "0.0028308" });
        expect(estimateDflopSpecialVideoBound({ contract, pricing: { ...pricing, raw: {} } })).toEqual({ ok: false, reasonCode: "SPECIAL_PRICING_INCOMPLETE" });
    });

    it("snapshots the documented zero-cost ASR step and the registry-priced compose step separately", () => {
        const contract = buildDflopSpecialVideoSteps("clip-compose", { ...fixtures, templateId: "template-current" });
        expect(estimateDflopSpecialVideoBound({ contract, pricing: { status: "READY", raw: { price_per_video_task: "48" }, conversion: { dflopCreditsPerCny: "60", cnyToUsd: "0.15", hotxUsdPerCredit: "1" } } })).toEqual({
            ok: true,
            estimatedProviderCost: { amount: "48", currency: "DFLOP_CREDITS", unit: "task" },
            estimatedCredits: "0.12",
            pricingSource: "PUBLIC_REGISTRY_COMPOSE_AND_OFFICIAL_ASR_ZERO",
            stepCosts: [
                { step: "ASR", amount: "0", source: "DFLOP_DIGITAL_HUMAN_API_DOCS_CURRENT_ZERO" },
                { step: "COMPOSE", amount: "48", source: "PUBLIC_REGISTRY_PRICE_PER_VIDEO_TASK" },
            ],
        });
    });

    it("refuses an undocumented subtitle terminal response and conflicting avatar pricing", () => {
        expect(() => parseDflopSpecialVideoResult("tvod-subtitle-soft", { status: "succeeded", video_url: "https://fixtures.example.com/result.mp4" })).toThrow("SUBTITLE_RESULT_SCHEMA_UNVERIFIED");
        const contract = buildDflopSpecialVideoSteps("dh-avatar", fixtures);
        expect(estimateDflopSpecialVideoBound({ contract, pricing: { status: "READY", raw: { price_per_video_second: "3.6" }, conversion: { dflopCreditsPerCny: "60", cnyToUsd: "0.15", hotxUsdPerCredit: "1" } } })).toEqual({
            ok: false,
            reasonCode: "AVATAR_PRICING_SOURCE_CONFLICT",
        });
    });
});
