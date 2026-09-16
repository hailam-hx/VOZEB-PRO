import { describe, expect, it } from "vitest";

import { classifyTextStreamTermination, createTextStreamDiagnostics, structuredRootError, type TextStreamTransportDiagnostic } from "./text-stream-diagnostics";

describe("text stream transport diagnostics", () => {
    it.each([
        { expected: "application_abort", error: new DOMException("cancelled", "AbortError") },
        { expected: "application_abort", error: Object.assign(new Error("ResponseAborted"), { name: "ResponseAborted" }) },
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

    it.each([
        {
            name: "DONE followed by normal EOF",
            frames: ["[DONE]"],
            requestedTermination: "normal_eof" as const,
            expectedTermination: "normal_eof" as const,
        },
        {
            name: "DONE followed by a late response abort",
            frames: ["[DONE]"],
            requestedTermination: "application_abort" as const,
            expectedTermination: "protocol_terminal" as const,
            abort: true,
        },
        {
            name: "finish reason, usage and DONE followed by a late response abort",
            frames: ['{"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}', '{"usage":{"prompt_tokens":5,"completion_tokens":2}}', "[DONE]"],
            requestedTermination: "application_abort" as const,
            expectedTermination: "protocol_terminal" as const,
            abort: true,
        },
        {
            name: "abort before finish reason",
            frames: [] as string[],
            requestedTermination: "application_abort" as const,
            expectedTermination: "application_abort" as const,
            abort: true,
        },
        {
            name: "abort after partial text",
            frames: ['{"choices":[{"delta":{"content":"partial"}}]}'],
            requestedTermination: "application_abort" as const,
            expectedTermination: "application_abort" as const,
            abort: true,
        },
    ])("classifies $name from the effective protocol lifecycle", ({ frames, requestedTermination, expectedTermination, abort }) => {
        let result: TextStreamTransportDiagnostic | undefined;
        const controller = new AbortController();
        const diagnostics = createTextStreamDiagnostics("chat", { source: "system_proxy_upstream", taskId: "fixture" }, (diagnostic) => {
            result = diagnostic;
        });
        for (const frame of frames) diagnostics?.frame(frame);
        const error = Object.assign(new Error("ResponseAborted"), { name: "ResponseAborted" });
        if (abort) controller.abort(error);

        diagnostics?.finish(requestedTermination, abort ? error : undefined, controller.signal);

        expect(result).toMatchObject({
            connectionTermination: expectedTermination,
            terminalSeen: frames.includes("[DONE]") || frames.some((frame) => frame.includes("finish_reason")),
            doneMarkerSeen: frames.includes("[DONE]"),
            usageSeen: frames.some((frame) => frame.includes('"usage"')),
            ...(abort ? { rootError: { name: "ResponseAborted" }, abort: { aborted: true, reason: { name: "ResponseAborted" } } } : {}),
        });
    });
});
