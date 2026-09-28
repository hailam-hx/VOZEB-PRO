import { describe, expect, it } from "vitest";

import { trustedVideoBillingContext } from "./video-billing-context";

describe("trusted reference-video billing context", () => {
    it("sums every verified video with Decimal and excludes image and audio references", () => {
        expect(
            trustedVideoBillingContext([
                { type: "video", url: "https://example.com/a.mp4", trustedDurationMs: 1234, durationSource: "server-probed" },
                { type: "image", url: "https://example.com/a.png", trustedDurationMs: 99_999, durationSource: "server-probed" },
                { type: "audio", url: "https://example.com/a.mp3", trustedDurationMs: 99_999, durationSource: "server-probed" },
                { type: "video", url: "https://example.com/b.mp4", trustedDurationMs: 2345, durationSource: "server-probed" },
            ]),
        ).toEqual({ hasReferenceVideo: true, verifiedInputVideoDurationSeconds: "3.579", referenceVideoDurationSource: "server-probed" });
    });

    it("marks duration unknown when any referenced video lacks trusted metadata", () => {
        expect(
            trustedVideoBillingContext([
                { type: "video", url: "https://example.com/a.mp4", trustedDurationMs: 1234, durationSource: "server-probed" },
                { type: "video", url: "https://example.com/b.mp4" },
            ]),
        ).toEqual({ hasReferenceVideo: true });
        expect(trustedVideoBillingContext([{ type: "image", url: "https://example.com/a.png" }])).toEqual({ hasReferenceVideo: false });
    });
});
