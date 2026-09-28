import { describe, expect, it } from "vitest";

import { deriveDflopImageQualityProfile, resolveDflopImageExecutionSize } from "./dflop-image-quality-profile";
import { normalizeImageQualityProfile } from "./image-quality-profile";

describe("DFLOP image quality profile derivation", () => {
    it.each([
        ["1:1", "1920x1920"],
        ["16:9", "2560x1440"],
        ["9:16", "1440x2560"],
        ["2:3", "1568x2352"],
    ])("normalizes Seedream 5.0 ratio %s to an executable upstream size", (ratio, expected) => {
        expect(resolveDflopImageExecutionSize("doubao-seedream-5-0-260128", ratio)).toBe(expected);
    });

    it("maps audited Qwen Pro ratios to executable exact sizes", () => {
        expect(resolveDflopImageExecutionSize("qwen-image-3.0-pro", "1:1", "1k")).toBe("1024x1024");
        expect(resolveDflopImageExecutionSize("qwen-image-3.0-pro", "1:1", "2k")).toBe("2048x2048");
        expect(resolveDflopImageExecutionSize("doubao-seedream-5-0-260128", "1024x1024")).toBeUndefined();
    });

    it.each(["tvod-midjourney-v7", "tvod-midjourney-v8.1"])("uses the audited prompt flag preset for %s", (modelId) => {
        const profile = deriveDflopImageQualityProfile({ modelId, syncedAt: "2026-09-25T00:00:00.000Z" });
        expect(profile).toMatchObject({ source: "provider_preset", controlType: "prompt_flag", selectionMode: "explicit", defaultValue: "standard" });
        expect(profile.options.map((option) => [option.value, option.effect])).toEqual([
            ["standard", { type: "prompt_flag", promptSuffix: "--sd", mutexGroup: "midjourney-quality" }],
            ["high", { type: "prompt_flag", promptSuffix: "--hd", mutexGroup: "midjourney-quality" }],
        ]);
    });

    it("uses audited Qwen exact size allowlists and ratio mappings", () => {
        const profile = deriveDflopImageQualityProfile({ modelId: "qwen-image-3.0-pro" });
        expect(profile.options.map((option) => option.effect)).toEqual([
            expect.objectContaining({ type: "resolution_tier", resolutionTier: "1k", sizeByAspectRatio: expect.objectContaining({ "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024" }) }),
            expect.objectContaining({ type: "resolution_tier", resolutionTier: "2k", sizeByAspectRatio: expect.objectContaining({ "1:1": "2048x2048" }) }),
        ]);
    });

    it("derives Seedream pixel tiers from the synchronized pricing threshold", () => {
        const profile = deriveDflopImageQualityProfile({
            modelId: "doubao-seedream-5-0-pro-260628",
            providerPricingProfile: { metadata: { imageLargeThresholdMegapixels: "2.61" } },
        });
        expect(profile).toMatchObject({ source: "provider_preset", controlType: "pixel_tier", selectionMode: "derived" });
        expect(profile.options.map((option) => option.effect)).toEqual([
            { type: "pixel_tier", pixelTier: "normal", maxMegapixels: "2.61" },
            { type: "pixel_tier", pixelTier: "large", minMegapixels: "2.61" },
        ]);
        expect(resolveDflopImageExecutionSize("doubao-seedream-5-0-pro-260628", "16:9")).toMatch(/^\d+x\d+$/);
    });

    it("blocks Seedream when the authoritative pricing threshold is missing", () => {
        expect(deriveDflopImageQualityProfile({ modelId: "doubao-seedream-5-0-pro-260628" }).validation).toMatchObject({ status: "NEEDS_REVIEW", reasons: [expect.objectContaining({ severity: "blocking" })] });
    });

    it.each(["grok-imagine-quality", "gpt-image-flare", "qwen-something-else", "my-seedream-copy"])("does not merge or guess a profile for %s", (modelId) => {
        expect(deriveDflopImageQualityProfile({ modelId })).toMatchObject({ source: "none", controlType: "none", selectionMode: "none", options: [] });
    });

    it("preserves a manual profile and records a changed upstream candidate as drift", () => {
        const manual = normalizeImageQualityProfile({
            version: 1,
            controlType: "request_parameter",
            selectionMode: "explicit",
            source: "manual",
            defaultValue: "standard",
            options: [{ value: "standard", label: "标准", effect: { type: "request_parameter", requestParameter: { name: "quality", value: "standard" } } }],
            validation: { status: "VALID", reasons: [], validatedAt: "2026-09-24T00:00:00.000Z" },
        })!;
        const profile = deriveDflopImageQualityProfile({ modelId: "tvod-midjourney-v7", currentProfile: manual, syncedAt: "2026-09-25T00:00:00.000Z" });
        expect(profile).toMatchObject({ source: "manual", validation: { status: "DRIFT" }, upstreamCandidate: { source: "provider_preset", controlType: "prompt_flag" } });
        expect(profile.options[0].effect.type).toBe("request_parameter");
    });
});
