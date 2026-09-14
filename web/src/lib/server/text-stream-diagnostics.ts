import type { TextStreamProtocol } from "./text-stream-protocol";

export type TextStreamDiagnosticContext = {
    source: "text_task_adapter" | "system_proxy_upstream";
    runId?: string;
    taskId?: string;
    parentTaskId?: string;
    attemptId?: string;
    attemptNo?: number;
    channelId?: string;
    provider?: string;
    model?: string;
};

export type TextStreamConnectionTermination = "normal_eof" | "protocol_terminal" | "application_abort" | "socket_reset" | "body_timeout" | "read_error" | "provider_error";

export function createTextStreamDiagnostics(protocol: TextStreamProtocol, context?: TextStreamDiagnosticContext) {
    if (!context || !textStreamDiagnosticsEnabled()) return undefined;
    const startedAt = Date.now();
    let lastUpstreamFrameAt: number | undefined;
    let lastTextDeltaAt: number | undefined;
    let framesReceived = 0;
    let bytesReceived = 0;
    let finishReason: string | undefined;
    let terminalSeen = false;
    let doneMarkerSeen = false;
    let usageSeen = false;
    let finished = false;

    const snapshot = () => ({
        ...context,
        protocol,
        startedAt,
        lastUpstreamFrameAt,
        lastTextDeltaAt,
        framesReceived,
        bytesReceived,
        finishReason,
        terminalSeen,
        doneMarkerSeen,
        usageSeen,
    });

    return {
        byte(chunk: Uint8Array) {
            bytesReceived += chunk.byteLength;
        },
        frame(frame: string) {
            const observedAt = Date.now();
            const metadata = inspectFrame(frame, protocol);
            framesReceived += 1;
            lastUpstreamFrameAt = observedAt;
            if (metadata.textDelta) lastTextDeltaAt = observedAt;
            if (metadata.finishReason) finishReason = metadata.finishReason;
            terminalSeen ||= metadata.terminalSeen;
            doneMarkerSeen ||= metadata.doneMarkerSeen;
            usageSeen ||= metadata.usageSeen;
            console.info("Text stream frame diagnostic", {
                ...snapshot(),
                sequence: framesReceived,
                observedAt,
                frameBytes: new TextEncoder().encode(frame).byteLength,
                eventType: metadata.eventType,
                textDelta: metadata.textDelta,
            });
        },
        finish(connectionTermination: TextStreamConnectionTermination, error?: unknown, signal?: AbortSignal) {
            if (finished) return;
            finished = true;
            const entry = {
                ...snapshot(),
                event: "text_stream_transport",
                connectionTermination,
                elapsedMs: Date.now() - startedAt,
                ...(error === undefined ? {} : { rootError: structuredRootError(error) }),
                ...(signal?.aborted ? { abort: { aborted: true, reason: structuredRootError(signal.reason), stage: errorField(signal.reason, "stage") } } : {}),
            };
            if (["socket_reset", "body_timeout", "read_error", "application_abort", "provider_error"].includes(connectionTermination)) console.warn("Text stream transport diagnostic", entry);
            else console.info("Text stream transport diagnostic", entry);
        },
        sawProtocolTerminal() {
            return doneMarkerSeen || terminalSeen;
        },
    };
}

export function textStreamDiagnosticsEnabled() {
    return process.env.NODE_ENV !== "test" || process.env.VOZEB_PRO_TEXT_STREAM_DIAGNOSTICS_TEST === "1";
}

export function classifyTextStreamTermination(error: unknown, signal?: AbortSignal): TextStreamConnectionTermination {
    const root = structuredRootError(error);
    const fields = [root.name, root.message, root.code, root.cause?.name, root.cause?.message, root.cause?.code].filter(Boolean).join(" ").toUpperCase();
    if (signal?.aborted || root.name === "AbortError" || root.cause?.name === "AbortError" || fields.includes("UND_ERR_ABORTED")) return "application_abort";
    if (fields.includes("UND_ERR_BODY_TIMEOUT") || fields.includes("BODYTIMEOUTERROR") || fields.includes("BODY TIMEOUT") || fields.includes("BODY TIMED OUT")) return "body_timeout";
    if (["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].some((code) => fields.includes(code)) || fields.includes("SOCKETERROR") || fields.includes("SOCKET RESET")) return "socket_reset";
    return "read_error";
}

export function structuredRootError(error: unknown) {
    const value = errorRecord(error);
    const cause = errorRecord(value?.cause);
    return {
        name: errorName(value, error),
        message: redactDiagnosticMessage(errorMessage(value, error)),
        ...(errorString(value, "code") ? { code: errorString(value, "code") } : {}),
        ...(errorScalar(value, "errno") !== undefined ? { errno: errorScalar(value, "errno") } : {}),
        ...(errorString(value, "syscall") ? { syscall: errorString(value, "syscall") } : {}),
        ...(cause
            ? {
                  cause: {
                      name: errorName(cause, value?.cause),
                      message: redactDiagnosticMessage(errorMessage(cause, value?.cause)),
                      ...(errorString(cause, "code") ? { code: errorString(cause, "code") } : {}),
                      ...(errorScalar(cause, "errno") !== undefined ? { errno: errorScalar(cause, "errno") } : {}),
                      ...(errorString(cause, "syscall") ? { syscall: errorString(cause, "syscall") } : {}),
                  },
              }
            : {}),
    };
}

function inspectFrame(frame: string, protocol: TextStreamProtocol) {
    if (frame.trim() === "[DONE]") return { eventType: "done", textDelta: false, terminalSeen: true, doneMarkerSeen: true, usageSeen: false };
    const payload = parseRecord(frame);
    if (!payload) return { eventType: "unparseable", textDelta: false, terminalSeen: false, doneMarkerSeen: false, usageSeen: false };
    const finishReason = providerFinishReason(payload, protocol);
    const eventType = typeof payload.type === "string" ? payload.type : protocol === "chat" ? "chat.chunk" : `${protocol}.chunk`;
    const providerTerminal = ["response.completed", "response.incomplete", "response.failed", "message_stop", "error"].includes(eventType);
    return {
        eventType,
        textDelta: hasTextDelta(payload, protocol),
        finishReason,
        terminalSeen: providerTerminal || Boolean(finishReason) || Boolean(errorRecord(payload.error)),
        doneMarkerSeen: false,
        usageSeen: Boolean(errorRecord(payload.usage) || errorRecord(errorRecord(payload.message)?.usage) || errorRecord(errorRecord(payload.response)?.usage) || errorRecord(payload.usageMetadata)),
    };
}

function providerFinishReason(payload: Record<string, unknown>, protocol: TextStreamProtocol) {
    if (protocol === "chat") return firstString(records(payload.choices).map((choice) => errorRecord(choice)?.finish_reason));
    if (protocol === "gemini") return firstString(records(payload.candidates).map((candidate) => errorRecord(candidate)?.finishReason));
    if (protocol === "claude") return firstString([errorRecord(payload.delta)?.stop_reason, errorRecord(payload.message)?.stop_reason]);
    return firstString([errorRecord(payload.response)?.status, payload.status]);
}

function hasTextDelta(payload: Record<string, unknown>, protocol: TextStreamProtocol) {
    if (protocol === "responses") return payload.type === "response.output_text.delta" && typeof payload.delta === "string" && Boolean(payload.delta);
    if (protocol === "claude") return payload.type === "content_block_delta" && errorRecord(payload.delta)?.type === "text_delta" && Boolean(errorRecord(payload.delta)?.text);
    if (protocol === "gemini") return records(errorRecord(errorRecord(records(payload.candidates)[0])?.content)?.parts).some((part) => typeof errorRecord(part)?.text === "string" && Boolean(errorRecord(part)?.text));
    const content = errorRecord(errorRecord(records(payload.choices)[0])?.delta)?.content;
    return (typeof content === "string" && Boolean(content)) || records(content).some((item) => typeof errorRecord(item)?.text === "string" && Boolean(errorRecord(item)?.text));
}

function redactDiagnosticMessage(value: string) {
    return value
        .replace(/https?:\/\/[^\s,]+/gi, "[redacted-url]")
        .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token|signature|sig)=)[^&\s]*/gi, "$1[redacted]")
        .replace(/(\b(?:authorization|api[_-]?key|token|secret)\b\s*[=:]\s*)([^,\s]+)/gi, "$1[redacted]")
        .replace(/(bearer\s+)[^\s,]+/gi, "$1[redacted]")
        .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]");
}

function parseRecord(value: string) {
    try {
        return errorRecord(JSON.parse(value));
    } catch {
        return undefined;
    }
}

function errorRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function errorName(value: Record<string, unknown> | undefined, original: unknown) {
    return errorString(value, "name") || (original instanceof Error ? original.name : typeof original);
}

function errorMessage(value: Record<string, unknown> | undefined, original: unknown) {
    return errorString(value, "message") || (typeof original === "string" ? original : String(original));
}

function errorString(value: Record<string, unknown> | undefined, key: string) {
    return typeof value?.[key] === "string" ? (value[key] as string) : undefined;
}

function errorScalar(value: Record<string, unknown> | undefined, key: string) {
    const field = value?.[key];
    return typeof field === "string" || typeof field === "number" ? field : undefined;
}

function errorField(value: unknown, key: string) {
    return errorScalar(errorRecord(value), key);
}

function records(value: unknown) {
    return Array.isArray(value) ? value : [];
}

function firstString(values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}
