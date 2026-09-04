import { describe, expect, it } from "vitest";

import { publicAudioTaskError } from "./audio-task-public";

describe("public audio task errors", () => {
    it("never exposes the provider voice id selected through an owned profile", () => {
        const error = publicAudioTaskError({
            error: "当前模型不支持音色 provider-private-voice",
            config: { voice: "provider-private-voice", voiceSelection: { type: "profile", voiceProfileId: "profile-one" } },
        });

        expect(error).toBe("当前模型不支持音色所选声音档案");
        expect(error).not.toContain("provider-private-voice");
    });
});
