import { describe, expect, it } from "vitest";

import { computeSeedanceHoldUsage, estimateSeedanceUsage, resolveSeedanceModelFamily, safeSeedanceFrame, seedanceFrameDimensions } from "./seedance-usage";

describe("Seedance reference-video usage estimates", () => {
    const frame = { width: "1280", height: "720" };

    it("uses verified 10s input for the estimate and the 15s Seedance 2.0 ceiling for hold", () => {
        expect(estimateSeedanceUsage({ outputDurationSeconds: "5", verifiedInputVideoDurationSeconds: "10", frame, hasReferenceVideo: true })).toMatchObject({
            status: "ESTIMATED",
            billingBasis: "with_video_input",
            effectiveInputVideoDurationSeconds: "10",
            tokens: "324000",
        });
        expect(computeSeedanceHoldUsage({ family: "seedance-2.0", outputDurationSeconds: "5", frame, hasReferenceVideo: true })).toMatchObject({ holdInputVideoDurationSeconds: "15", tokens: "432000" });
    });

    it("uses the 30s Seedance 2.5 ceiling without lowering it to the verified duration", () => {
        expect(computeSeedanceHoldUsage({ family: "seedance-2.5", outputDurationSeconds: "5", frame, hasReferenceVideo: true })).toMatchObject({ holdInputVideoDurationSeconds: "30", tokens: "756000" });
    });

    it("applies the overall four-second minimum with Decimal precision", () => {
        expect(estimateSeedanceUsage({ outputDurationSeconds: "5.125", verifiedInputVideoDurationSeconds: "2.001", frame, hasReferenceVideo: true })).toMatchObject({
            effectiveInputVideoDurationSeconds: "4",
            tokens: "197100",
        });
    });

    it("keeps non-video references on the default basis with zero input duration", () => {
        expect(estimateSeedanceUsage({ outputDurationSeconds: "5", frame, hasReferenceVideo: false })).toMatchObject({ status: "ESTIMATED", billingBasis: "default", effectiveInputVideoDurationSeconds: "0", tokens: "108000" });
        expect(computeSeedanceHoldUsage({ family: "seedance-2.0", outputDurationSeconds: "5", frame, hasReferenceVideo: false })).toMatchObject({ holdInputVideoDurationSeconds: "0", tokens: "108000" });
    });

    it("reports unknown reference duration while hold remains computable", () => {
        expect(estimateSeedanceUsage({ outputDurationSeconds: "5", frame, hasReferenceVideo: true })).toEqual({ status: "REFERENCE_DURATION_UNKNOWN", billingBasis: "with_video_input" });
        expect(computeSeedanceHoldUsage({ family: "seedance-2.0", outputDurationSeconds: "5", frame, hasReferenceVideo: true }).tokens).toBe("432000");
    });

    it("marks a safe frame estimate conservative and canonicalizes supported resolutions", () => {
        expect(seedanceFrameDimensions("480", "21:9")).toEqual({ width: "1120", height: "480" });
        expect(seedanceFrameDimensions("720p", "16:9")).toEqual({ width: "1280", height: "720" });
        expect(seedanceFrameDimensions("1080", "9:16")).toEqual({ width: "1080", height: "1920" });
        expect(safeSeedanceFrame("720p", ["16:9", "21:9", "1:1"])).toEqual({ width: "1680", height: "720" });
        expect(estimateSeedanceUsage({ outputDurationSeconds: "5", verifiedInputVideoDurationSeconds: "10", frame: { width: "1680", height: "720" }, hasReferenceVideo: true, conservativeFrame: true })).toMatchObject({
            status: "CONSERVATIVE_ESTIMATE",
            tokens: "425250",
        });
    });

    it("uses the official family-specific 480p frame", () => {
        expect(seedanceFrameDimensions("480p", "16:9", "seedance-2.0")).toEqual({ width: "864", height: "496" });
        expect(seedanceFrameDimensions("480p", "16:9", "seedance-2.5")).toEqual({ width: "854", height: "480" });
        expect(seedanceFrameDimensions("480p", "9:16", "seedance-2.0")).toEqual({ width: "496", height: "864" });
    });

    it("recognizes only the supported Seedance 2.0 and 2.5 model families", () => {
        expect(resolveSeedanceModelFamily("doubao-seedance-2.0-pro")).toBe("seedance-2.0");
        expect(resolveSeedanceModelFamily("seedance-2-5-lite")).toBe("seedance-2.5");
        expect(resolveSeedanceModelFamily("seedance-1.5-pro")).toBeUndefined();
    });
});
