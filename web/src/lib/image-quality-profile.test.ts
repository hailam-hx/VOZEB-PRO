import { describe, expect, it } from "vitest";
import { imageQualityOptionRevision, imageQualityProfileRevision, normalizeImageQualityProfile, normalizeMidjourneyQualityFlag, publicLogicalImageQualityProfile } from "./image-quality-profile";

const validation = { status: "VALID" as const, reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" };

describe("image quality profile domain", () => {
    it("parses prompt flag profiles and assigns semantic revisions", () => {
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "prompt_flag",
            selectionMode: "explicit",
            source: "provider_preset",
            defaultValue: "standard",
            options: [
                { value: "standard", label: "标准", effect: { type: "prompt_flag", promptSuffix: "--sd", mutexGroup: "midjourney-quality" } },
                { value: "high", label: "高清", effect: { type: "prompt_flag", promptSuffix: "--hd", mutexGroup: "midjourney-quality" } },
            ],
            validation,
        });

        expect(profile).toMatchObject({ controlType: "prompt_flag", selectionMode: "explicit", defaultValue: "standard" });
        expect(profile?.profileRevision).toMatch(/^image-quality-profile-v1:/);
        expect(profile?.options[0]?.optionRevision).toMatch(/^image-quality-option-v1:/);
    });

    it("parses explicit resolution tiers with exact mappings", () => {
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "resolution_tier",
            selectionMode: "explicit",
            source: "provider_preset",
            options: [{ value: "1k", label: "1K", effect: { type: "resolution_tier", resolutionTier: "1k", exactSizes: ["1024x1024"], sizeByAspectRatio: { "1:1": "1024x1024" } } }],
            validation,
        });
        expect(profile?.options[0]?.effect).toEqual({ type: "resolution_tier", resolutionTier: "1k", exactSizes: ["1024x1024"], sizeByAspectRatio: { "1:1": "1024x1024" } });
    });

    it("parses derived pixel tiers and none profiles", () => {
        const derived = normalizeImageQualityProfile({
            version: 1,
            controlType: "pixel_tier",
            selectionMode: "derived",
            source: "structured_upstream",
            options: [
                { value: "normal", label: "标准像素", effect: { type: "pixel_tier", pixelTier: "normal", maxMegapixels: "2.61" } },
                { value: "large", label: "大像素", effect: { type: "pixel_tier", pixelTier: "large", minMegapixels: "2.61" } },
            ],
            validation,
        });
        const none = normalizeImageQualityProfile({ version: 1, controlType: "none", selectionMode: "none", source: "none", options: [], validation });
        expect(derived?.selectionMode).toBe("derived");
        expect(none).toMatchObject({ controlType: "none", selectionMode: "none", options: [] });
    });

    it("rejects malformed or internally inconsistent profiles", () => {
        expect(normalizeImageQualityProfile({ version: 1, controlType: "prompt_flag", selectionMode: "explicit", source: "manual", options: [], validation })).toBeUndefined();
        expect(
            normalizeImageQualityProfile({
                version: 1,
                controlType: "resolution_tier",
                selectionMode: "explicit",
                source: "manual",
                options: [{ value: "1k", label: "1K", effect: { type: "prompt_flag", promptSuffix: "--sd", mutexGroup: "midjourney-quality" } }],
                validation,
            }),
        ).toBeUndefined();
    });

    it("keeps revisions stable for labels and changes them for executable semantics", () => {
        const effect = { type: "prompt_flag" as const, promptSuffix: "--sd" as const, mutexGroup: "midjourney-quality" as const };
        expect(imageQualityOptionRevision({ value: "standard", label: "标准", effect })).toBe(imageQualityOptionRevision({ value: "standard", label: "Standard", effect }));
        expect(imageQualityOptionRevision({ value: "standard", label: "标准", effect })).not.toBe(imageQualityOptionRevision({ value: "standard", label: "标准", effect: { ...effect, promptSuffix: "--hd" } }));
        expect(imageQualityProfileRevision({ controlType: "prompt_flag", selectionMode: "explicit", defaultValue: "standard", options: [{ value: "standard", label: "标准", effect }] })).toBe(
            imageQualityProfileRevision({ controlType: "prompt_flag", selectionMode: "explicit", defaultValue: "standard", options: [{ value: "standard", label: "Standard", effect }] }),
        );
    });

    it("redacts target binding ids from public logical profiles", () => {
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "model_variant",
            selectionMode: "explicit",
            source: "manual",
            options: [
                { value: "standard", label: "标准", effect: { type: "model_variant", targetBindingId: "secret-binding-a" } },
                { value: "high", label: "高清", effect: { type: "model_variant", targetBindingId: "secret-binding-b" } },
            ],
            validation,
        })!;
        const publicProfile = publicLogicalImageQualityProfile([{ id: "binding-a", imageQualityProfile: profile }]);
        expect(JSON.stringify(publicProfile)).not.toContain("secret-binding");
        expect(publicProfile?.options.map((option) => option.value)).toEqual(["standard", "high"]);
    });
});

describe("normalizeMidjourneyQualityFlag", () => {
    it.each([
        ["a cat", "--sd", "a cat --sd"],
        ["a cat", "--hd", "a cat --hd"],
        ["a cat --sd", "--hd", "a cat --hd"],
        ["a cat --hd", "--sd", "a cat --sd"],
        ["a cat --sd --sd", "--sd", "a cat --sd"],
        ["a cat --sd --hd", "--hd", "a cat --hd"],
        ["a --style raw cat", "--hd", "a --style raw cat --hd"],
        ["the --sdf file", "--sd", "the --sdf file --sd"],
    ] as const)("normalizes %s with %s", (prompt, selected, expected) => {
        expect(normalizeMidjourneyQualityFlag(prompt, selected)).toBe(expected);
        expect(normalizeMidjourneyQualityFlag(expected, selected)).toBe(expected);
    });
});
