import { describe, expect, it } from "vitest";

import { readVideoProviderFailureDiagnostic } from "./video-provider-response";

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
