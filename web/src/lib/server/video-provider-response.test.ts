import { describe, expect, it } from "vitest";

import { classifyVideoProviderPublicError, readVideoProviderFailureDiagnostic, readVideoProviderUsage } from "./video-provider-response";

describe("readVideoProviderFailureDiagnostic", () => {
    it.each(["nested", "root"])("preserves %s provider error metadata", (shape) => {
        const error = {
            code: "InputVideoSensitiveContentDetected.PolicyViolation",
            message: "The request failed because content[1] is restricted. Request id: request-from-message",
            param: "content[1]",
            type: "BadRequest",
        };
        const payload = shape === "nested" ? { error, request_id: "request-from-body" } : { ...error, request_id: "request-from-body" };

        expect(readVideoProviderFailureDiagnostic(JSON.stringify(payload), 400)).toEqual({
            status: 400,
            message: error.message,
            code: error.code,
            param: error.param,
            type: error.type,
            requestId: "request-from-body",
        });
    });
});

describe("classifyVideoProviderPublicError", () => {
    it("recognizes an overlong video text input without matching other invalid parameters", () => {
        const message = "task failed with status: FAIL, message: create gen_video task failed. ret:-2,msg:invalid params, content[0].text too long: 13836 > 7000 characters (2013)";

        expect(classifyVideoProviderPublicError({ message })).toBe("video_text_too_long");
        expect(classifyVideoProviderPublicError({ message: "invalid params, content[0].image too long" })).toBeUndefined();
        expect(classifyVideoProviderPublicError({ message: "invalid params, content[1].text too long" })).toBeUndefined();
    });

    it("recognizes a rejected output video without matching unrelated sensitive input errors", () => {
        const message = "The request failed because the output video may contain sensitive information. Request id: private-output-request";

        expect(classifyVideoProviderPublicError({ message })).toBe("video_output_sensitive_content");
        expect(classifyVideoProviderPublicError({ message: "The input video may contain sensitive information" })).toBeUndefined();
    });

    it("recognizes the reference-image aspect ratio rejection without matching unrelated image failures", () => {
        const message = "Error while downloading image, error: expected the aspect ratio to be between 0.39 and 2.50, but received image with aspect ratio: 2.65 instead Request id: private-request";

        expect(classifyVideoProviderPublicError({ message })).toBe("video_reference_aspect_ratio_unsupported");
        expect(classifyVideoProviderPublicError({ message: "Error while downloading image, error: image not found" })).toBeUndefined();
    });
});

describe("readVideoProviderUsage", () => {
    it("preserves authoritative zero tokens and decimal duration without coercing missing values", () => {
        expect(readVideoProviderUsage({ usage: { completion_tokens: 0, total_tokens: "0" }, duration_sec: "5.25", input_video_duration_sec: 3, framespersecond: 24 })).toEqual({
            completionTokens: "0",
            totalTokens: "0",
            deliveredDurationSeconds: "5.25",
            inputVideoDurationSeconds: "3",
            framesPerSecond: "24",
            rawUsage: { completion_tokens: 0, total_tokens: "0" },
        });
        expect(readVideoProviderUsage({ status: "succeeded", duration_sec: 5 })).toEqual({ deliveredDurationSeconds: "5" });
    });

    it("rejects unsafe or fractional token counters", () => {
        expect(readVideoProviderUsage({ usage: { completion_tokens: 1.5, total_tokens: Number.MAX_SAFE_INTEGER + 1 } })).toEqual({ rawUsage: { completion_tokens: 1.5, total_tokens: Number.MAX_SAFE_INTEGER + 1 } });
    });
});
