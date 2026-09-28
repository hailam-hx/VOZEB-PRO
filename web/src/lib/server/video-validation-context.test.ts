import { describe, expect, it } from "vitest";

import type { LogicalModelBinding } from "@/lib/auth/store-types";
import { resolveMinimumVideoValidationContext } from "./video-validation-context";

function binding(): LogicalModelBinding {
    return {
        id: "binding",
        channelId: "channel",
        upstreamModel: "video",
        enabled: true,
        priority: 1,
        generationParameters: {
            referenceInputs: ["image"],
            aspectRatios: ["9:16", "16:9"],
            pixelSizes: [],
            supportsCustomSize: false,
            qualities: [],
            resolutions: ["480", "720", "1080"],
            durationMode: "discrete",
            durationSeconds: [10, 5],
            videoReferenceModes: ["first_frame", "first_last"],
            voices: [],
            formats: [],
        },
        costRateCard: {
            version: 1,
            components: [
                { id: "720", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.2268", when: { resolution: "720p" } },
                { id: "1080", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.56133", when: { resolution: "1080p" } },
            ],
        },
    };
}

describe("minimum video validation context", () => {
    it("chooses the minimum executable priced parameters", () => {
        expect(resolveMinimumVideoValidationContext({ binding: binding(), referenceMode: "text", runtimeOptions: { generateAudio: true, watermark: true } })).toMatchObject({
            ok: true,
            context: {
                count: "1",
                durationSeconds: "5",
                resolution: "720p",
                aspectRatio: "16:9",
                generateAudio: false,
                watermark: false,
                references: [],
            },
        });
    });

    it("assigns distinct fixture roles for first and last frames", () => {
        expect(resolveMinimumVideoValidationContext({ binding: binding(), referenceMode: "first_last" })).toMatchObject({
            ok: true,
            context: { references: [{ role: "first_frame" }, { role: "last_frame" }] },
        });
    });

    it("rejects a profile without an executable priced resolution", () => {
        const input = binding();
        input.costRateCard = { version: 1, components: [{ id: "4k", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "1", when: { resolution: "4k" } }] };
        expect(resolveMinimumVideoValidationContext({ binding: input, referenceMode: "text" })).toEqual({ ok: false, reasonCode: "COST_NOT_ESTIMATABLE" });
    });

    it("reports the missing budget bound for token billing", () => {
        const input = binding();
        input.costRateCard = { version: 1, components: [{ id: "tokens", dimension: "outputTokens", basis: "VIDEO_TOKEN", unitPrice: "6.9", per: "1000000", when: { billingBasis: "default", resolution: "720p" } }] };
        expect(resolveMinimumVideoValidationContext({ binding: input, referenceMode: "text" })).toEqual({ ok: false, reasonCode: "BUDGET_BOUND_UNAVAILABLE" });
    });

    it("uses provider auto resolution when the profile has no explicit resolution and every price component is resolution independent", () => {
        const input = binding();
        input.generationParameters!.resolutions = [];
        input.costRateCard = { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.015" }] };
        expect(resolveMinimumVideoValidationContext({ binding: input, referenceMode: "text", allowAutoResolution: true })).toMatchObject({ ok: true, context: { resolution: "" }, selectionReasons: expect.arrayContaining(["PROVIDER_AUTO_RESOLUTION"]) });
    });

    it("does not assume auto resolution when any price component needs an explicit tier", () => {
        const input = binding();
        input.generationParameters!.resolutions = [];
        expect(resolveMinimumVideoValidationContext({ binding: input, referenceMode: "text" })).toEqual({ ok: false, reasonCode: "COST_NOT_ESTIMATABLE" });
    });
});
