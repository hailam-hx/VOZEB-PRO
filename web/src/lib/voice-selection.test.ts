import { describe, expect, it } from "vitest";

import { normalizeVoiceSelection, resolveAudioTaskSource, unicodeCodePointCount } from "./voice-selection";

describe("voice selection contract", () => {
    it("accepts only explicit preset or profile selections", () => {
        expect(normalizeVoiceSelection({ type: "preset", voiceId: "alloy" })).toEqual({ type: "preset", voiceId: "alloy" });
        expect(normalizeVoiceSelection({ type: "profile", voiceProfileId: "profile-one" })).toEqual({ type: "profile", voiceProfileId: "profile-one" });
        expect(normalizeVoiceSelection("alloy")).toBeNull();
        expect(normalizeVoiceSelection({ type: "profile", voiceId: "provider-secret" })).toBeNull();
    });

    it("counts Unicode code points instead of UTF-16 units", () => {
        expect(unicodeCodePointCount("A😀中")).toBe(3);
    });

    it("preserves preview markers only for the explicitly selected profile", () => {
        expect(resolveAudioTaskSource("voice-profile-preview:profile-one", { type: "profile", voiceProfileId: "profile-one" })).toBe("voice-profile-preview:profile-one");
        expect(resolveAudioTaskSource("voice-profile-preview:other", { type: "profile", voiceProfileId: "profile-one" })).toBe("");
        expect(resolveAudioTaskSource("voice-profile-preview:profile-one", { type: "preset", voiceId: "alloy" })).toBe("");
    });
});
