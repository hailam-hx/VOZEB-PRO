import { describe, expect, it } from "vitest";

import { classifyTextStreamTermination, structuredRootError } from "./text-stream-diagnostics";

describe("text stream transport diagnostics", () => {
    it.each([
        { expected: "application_abort", error: new DOMException("cancelled", "AbortError") },
        { expected: "body_timeout", error: Object.assign(new TypeError("terminated"), { cause: { name: "BodyTimeoutError", code: "UND_ERR_BODY_TIMEOUT", message: "body timed out" } }) },
        { expected: "socket_reset", error: Object.assign(new TypeError("terminated"), { cause: { name: "SocketError", code: "ECONNRESET", message: "socket reset" } }) },
        { expected: "read_error", error: new Error("decoder failed") },
    ])("classifies $expected independently of public failure semantics", ({ expected, error }) => {
        expect(classifyTextStreamTermination(error)).toBe(expected);
    });

    it("distinguishes a configured body deadline from an application cancellation", () => {
        const controller = new AbortController();
        controller.abort(Object.assign(new Error("configured deadline"), { name: "TimeoutError", stage: "idle" }));
        expect(classifyTextStreamTermination(new TypeError("terminated"), controller.signal)).toBe("body_timeout");
    });

    it("preserves structured error fields while redacting credential-shaped values", () => {
        const error = Object.assign(new Error("GET https://example.test/path?token=private-token authorization=BearerSecret"), {
            errno: -54,
            syscall: "read",
            cause: { name: "SocketError", message: "api_key=private-key", code: "UND_ERR_SOCKET", errno: -104, syscall: "read" },
        });
        expect(structuredRootError(error)).toEqual({
            name: "Error",
            message: "GET [redacted-url] authorization=[redacted]",
            errno: -54,
            syscall: "read",
            cause: { name: "SocketError", message: "api_key=[redacted]", code: "UND_ERR_SOCKET", errno: -104, syscall: "read" },
        });
    });
});
