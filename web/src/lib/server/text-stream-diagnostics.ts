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

export type SafeProviderStreamError = {
    kind: "provider_error";
    type?: string;
    code?: string;
    message?: string;
    status?: number;
};

export type TextStreamTransportDiagnostic = TextStreamDiagnosticContext & {
    protocol: TextStreamProtocol;
    startedAt: number;
    lastUpstreamFrameAt?: number;
    lastTextDeltaAt?: number;
    maxInterTextGapMs?: number;
    framesReceived: number;
    bytesReceived: number;
    finishReason?: string;
    terminalSeen: boolean;
    doneMarkerSeen: boolean;
    usageSeen: boolean;
    event: "text_stream_transport";
    connectionTermination: TextStreamConnectionTermination;
    elapsedMs: number;
    providerError?: SafeProviderStreamError;
    rootError?: ReturnType<typeof structuredRootError>;
    abort?: { aborted: true; reason: ReturnType<typeof structuredRootError>; stage?: string | number };
};

export function createTextStreamDiagnostics(protocol: TextStreamProtocol, context?: TextStreamDiagnosticContext, onFinish?: (diagnostic: TextStreamTransportDiagnostic) => void) {
    if (!context) return undefined;
    const loggingEnabled = textStreamDiagnosticsEnabled();
    const startedAt = Date.now();
    let lastUpstreamFrameAt: number | undefined;
    let lastTextDeltaAt: number | undefined;
    let maxInterTextGapMs: number | undefined;
    let framesReceived = 0;
    let bytesReceived = 0;
    let finishReason: string | undefined;
    let terminalSeen = false;
    let doneMarkerSeen = false;
    let usageSeen = false;
    let providerError: SafeProviderStreamError | undefined;
    let protocolCompleted = false;
    let finished = false;

    const snapshot = () => ({
        ...context,
        protocol,
        startedAt,
        lastUpstreamFrameAt,
        lastTextDeltaAt,
        maxInterTextGapMs,
        framesReceived,
        bytesReceived,
        finishReason,
        terminalSeen,
        doneMarkerSeen,
        usageSeen,
        ...(providerError ? { providerError } : {}),
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
            if (metadata.textDelta) {
                if (lastTextDeltaAt !== undefined) maxInterTextGapMs = Math.max(maxInterTextGapMs || 0, observedAt - lastTextDeltaAt);
                lastTextDeltaAt = observedAt;
            }
            if (metadata.finishReason) finishReason = metadata.finishReason;
            terminalSeen ||= metadata.terminalSeen;
            doneMarkerSeen ||= metadata.doneMarkerSeen;
            usageSeen ||= metadata.usageSeen;
            providerError = metadata.providerError || providerError;
            protocolCompleted ||= metadata.protocolCompleted;
            if (loggingEnabled)
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
            const effectiveTermination = connectionTermination === "application_abort" && protocolCompleted ? "protocol_terminal" : connectionTermination;
            const entry: TextStreamTransportDiagnostic = {
                ...snapshot(),
                event: "text_stream_transport",
                connectionTermination: effectiveTermination,
                elapsedMs: Date.now() - startedAt,
                ...(error === undefined ? {} : { rootError: structuredRootError(error) }),
                ...(signal?.aborted ? { abort: { aborted: true, reason: structuredRootError(signal.reason), stage: errorField(signal.reason, "stage") } } : {}),
            };
            onFinish?.(entry);
            if (loggingEnabled) {
                if (["socket_reset", "body_timeout", "read_error", "application_abort", "provider_error"].includes(effectiveTermination)) console.warn("Text stream transport diagnostic", entry);
                else console.info("Text stream transport diagnostic", entry);
            }
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
    const signalRoot = signal?.aborted ? structuredRootError(signal.reason) : undefined;
    const signalFields = signalRoot ? [signalRoot.name, signalRoot.message, signalRoot.code, signalRoot.cause?.name, signalRoot.cause?.message, signalRoot.cause?.code].filter(Boolean).join(" ").toUpperCase() : "";
    if (errorField(signal?.reason, "stage") !== undefined || fields.includes("UND_ERR_BODY_TIMEOUT") || fields.includes("BODYTIMEOUTERROR") || fields.includes("BODY TIMEOUT") || fields.includes("BODY TIMED OUT") || signalFields.includes("TIMEOUTERROR"))
        return "body_timeout";
    if (signal?.aborted || [root.name, root.cause?.name].some((name) => name === "AbortError" || name === "ResponseAborted") || fields.includes("UND_ERR_ABORTED")) return "application_abort";
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
    if (frame.trim() === "[DONE]") return { eventType: "done", textDelta: false, terminalSeen: true, doneMarkerSeen: true, usageSeen: false, protocolCompleted: true };
    const payload = parseRecord(frame);
    if (!payload) return { eventType: "unparseable", textDelta: false, terminalSeen: false, doneMarkerSeen: false, usageSeen: false, protocolCompleted: false };
    const finishReason = providerFinishReason(payload, protocol);
    const providerError = extractSafeProviderStreamError(payload);
    const eventType = typeof payload.type === "string" ? payload.type : protocol === "chat" ? "chat.chunk" : `${protocol}.chunk`;
    const providerTerminal = ["response.completed", "response.incomplete", "response.failed", "message_stop", "error"].includes(eventType);
    const protocolCompleted = eventType === "response.completed" || eventType === "message_stop" || (protocol === "gemini" && Boolean(finishReason));
    return {
        eventType,
        textDelta: hasTextDelta(payload, protocol),
        finishReason,
        terminalSeen: providerTerminal || Boolean(finishReason) || Boolean(providerError),
        doneMarkerSeen: false,
        usageSeen: Boolean(errorRecord(payload.usage) || errorRecord(errorRecord(payload.message)?.usage) || errorRecord(errorRecord(payload.response)?.usage) || errorRecord(payload.usageMetadata)),
        protocolCompleted,
        providerError,
    };
}

export function extractSafeProviderStreamError(payload: Record<string, unknown>): SafeProviderStreamError | undefined {
    const response = errorRecord(payload.response);
    const nested = errorRecord(payload.error) || errorRecord(response?.error);
    const eventType = errorString(payload, "type");
    const explicitErrorEvent = eventType === "error" || eventType === "response.error" || eventType === "response.failed";
    const topLevelError = Boolean(errorString(payload, "message") && (errorScalar(payload, "code") !== undefined || providerStatus(payload.status) !== undefined));
    if (!nested && !explicitErrorEvent && !topLevelError) return undefined;

    const type = sanitizeProviderErrorField(errorString(nested, "type") || (explicitErrorEvent ? eventType : undefined));
    const code = sanitizeProviderErrorField(stringScalar(nested?.code) || stringScalar(payload.code) || stringScalar(response?.code));
    const message = sanitizeProviderErrorMessage(errorString(nested, "message") || errorString(payload, "message") || errorString(response, "message"));
    const status = providerStatus(nested?.status) ?? providerStatus(payload.status) ?? providerStatus(response?.status);
    return {
        kind: "provider_error",
        ...(type ? { type } : {}),
        ...(code ? { code } : {}),
        ...(message ? { message } : {}),
        ...(status !== undefined ? { status } : {}),
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

function sanitizeProviderErrorMessage(value: string | undefined) {
    if (!value) return undefined;
    const sanitized = redactDiagnosticMessage(value)
        .replace(/\b(prompt|input|messages|request[\s_-]?body|body)\b\s*[=:].*$/gis, "$1=[redacted]")
        .trim();
    return truncate(sanitized, 500);
}

function sanitizeProviderErrorField(value: string | undefined) {
    if (!value) return undefined;
    const sanitized = redactDiagnosticMessage(value).trim();
    return /^[A-Za-z0-9._:-]+$/.test(sanitized) ? truncate(sanitized, 160) : undefined;
}

function providerStatus(value: unknown) {
    const status = typeof value === "number" ? value : typeof value === "string" && /^\d{3}$/.test(value.trim()) ? Number(value) : undefined;
    return status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function stringScalar(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function truncate(value: string, limit: number) {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
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
