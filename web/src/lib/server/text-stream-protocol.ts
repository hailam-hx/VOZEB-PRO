import { createTextSseDecoder, TEXT_STREAM_COMPLETED, TEXT_STREAM_FAILED } from "./text-sse-decoder";
import { classifyTextStreamTermination, createTextStreamDiagnostics, type TextStreamDiagnosticContext } from "./text-stream-diagnostics";

export type TextStreamProtocol = "chat" | "responses" | "gemini" | "claude";

export type NormalizedTextStreamEvent =
    { type: "text_delta"; text: string } | { type: "usage"; inputTokens?: number; outputTokens?: number; totalTokens?: number } | { type: "completed" } | { type: "error"; message: string; status?: number; contract?: true };

type TextStreamOptions = { onFirstByte?: () => void | Promise<void>; signal?: AbortSignal; diagnosticContext?: TextStreamDiagnosticContext };
type UsageState = { inputTokens?: number; outputTokens?: number };

export async function* normalizeTextStream(response: Response, protocol: TextStreamProtocol, options: TextStreamOptions = {}): AsyncGenerator<NormalizedTextStreamEvent> {
    if (!response.ok) {
        await response.text();
        reportDiagnostic(protocol, "http_error", response.status);
        yield { type: "error", message: `文本流请求失败（HTTP ${response.status}）`, status: response.status };
        return;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.includes("text/event-stream")) {
        yield { type: "error", message: `文本流协议预期 SSE 响应，但上游返回了 ${contentType || "未知内容类型"}`, contract: true };
        return;
    }
    if (!response.body) {
        yield { type: "error", message: "文本流协议没有返回响应体", contract: true };
        return;
    }

    const reader = response.body.getReader();
    const frames: string[] = [];
    const decoder = createTextSseDecoder((data) => frames.push(data));
    let failed = false;
    let completed = false;
    let firstByte = false;
    const usageState: UsageState = {};
    const consume = (frame: string) => streamEvents(frame, protocol, usageState);
    const diagnostics = createTextStreamDiagnostics(protocol, options.diagnosticContext);
    try {
        reading: for (;;) {
            const next = await reader.read();
            if (!firstByte && next.value?.byteLength) {
                firstByte = true;
                await options.onFirstByte?.();
            }
            if (next.done) decoder.finish();
            else {
                diagnostics?.byte(next.value);
                decoder.push(next.value);
            }
            for (const frame of frames.splice(0)) {
                diagnostics?.frame(frame);
                const parsed = consume(frame);
                completed ||= parsed.completed;
                for (const event of parsed.events) {
                    if (event.type === "error") failed = true;
                    yield event;
                }
                if (completed || failed) break reading;
            }
            if (next.done) break;
        }
    } catch (error) {
        diagnostics?.finish(classifyTextStreamTermination(error, options.signal), error, options.signal);
        if (error instanceof Error && error.name === "AbortError") throw error;
        yield { type: "error", message: "读取文本流失败" };
        return;
    } finally {
        await reader.cancel(completed ? TEXT_STREAM_COMPLETED : failed ? TEXT_STREAM_FAILED : undefined).catch(() => undefined);
        reader.releaseLock();
    }
    if (failed) {
        diagnostics?.finish("provider_error", undefined, options.signal);
        return;
    }
    if (completed) {
        diagnostics?.finish("protocol_terminal", undefined, options.signal);
        yield { type: "completed" };
    } else {
        diagnostics?.finish("normal_eof", undefined, options.signal);
        yield { type: "error", message: "文本流在完成前意外结束", contract: true };
    }
}

function streamEvents(frame: string, protocol: TextStreamProtocol, usageState: UsageState): { events: NormalizedTextStreamEvent[]; completed: boolean } {
    if (frame.trim() === "[DONE]") return { events: [], completed: true };
    const payload = parseRecord(frame);
    if (!payload) return { events: [], completed: false };
    const events: NormalizedTextStreamEvent[] = [];
    const usage = normalizedUsage(payload, usageState);
    if (hasStreamError(payload)) {
        reportDiagnostic(protocol, "stream_error");
        if (usage) events.push({ type: "usage", ...usage });
        events.push({ type: "error", message: "文本流上游返回错误" });
        return { events, completed: false };
    }
    const text = streamedText(payload, protocol);
    if (text) events.push({ type: "text_delta", text });
    if (usage) events.push({ type: "usage", ...usage });
    return { events, completed: nativeCompleted(payload, protocol) };
}

function streamedText(payload: Record<string, unknown>, protocol: TextStreamProtocol) {
    if (protocol === "responses") return payload.type === "response.output_text.delta" && typeof payload.delta === "string" ? payload.delta : "";
    if (protocol === "gemini")
        return records(record(record(firstRecord(payload.candidates))?.content)?.parts)
            .filter((part) => record(part)?.thought !== true)
            .map((part) => (typeof record(part)?.text === "string" ? record(part)?.text : ""))
            .join("");
    if (protocol === "claude") {
        const delta = record(payload.delta);
        return payload.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : "";
    }
    const delta = record(firstRecord(payload.choices))?.delta;
    if (typeof record(delta)?.content === "string") return record(delta)?.content as string;
    return records(record(delta)?.content)
        .map((item) => (typeof record(item)?.text === "string" ? record(item)?.text : ""))
        .join("");
}

function normalizedUsage(payload: Record<string, unknown>, state: UsageState) {
    const usage = record(payload.usage) || record(record(payload.message)?.usage) || record(record(payload.response)?.usage) || record(payload.usageMetadata);
    if (!usage) return undefined;
    const inputTokens = numberValue(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount) ?? state.inputTokens;
    const outputTokens = numberValue(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount) ?? state.outputTokens;
    const totalTokens = numberValue(usage.total_tokens ?? usage.totalTokenCount) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
    state.inputTokens = inputTokens;
    state.outputTokens = outputTokens;
    return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined ? undefined : { inputTokens, outputTokens, totalTokens };
}

function hasStreamError(payload: Record<string, unknown>) {
    return Boolean(record(payload.error) || record(record(payload.response)?.error) || payload.type === "error" || payload.type === "response.failed");
}

export function textStreamTerminalStatus(payload: Record<string, unknown> | string): "succeeded" | "failed" | undefined {
    if (payload === "[DONE]") return "succeeded";
    if (typeof payload === "string") return undefined;
    if (hasStreamError(payload)) return "failed";
    return nativeCompleted(payload) ? "succeeded" : undefined;
}

function nativeCompleted(payload: Record<string, unknown>, protocol?: TextStreamProtocol) {
    if ((!protocol || protocol === "responses") && payload.type === "response.completed") return true;
    if ((!protocol || protocol === "claude") && payload.type === "message_stop") return true;
    if (!protocol || protocol === "gemini")
        return records(payload.candidates).some((candidate) => {
            const finishReason = record(candidate)?.finishReason;
            return typeof finishReason === "string" && Boolean(finishReason.trim());
        });
    // Chat can send final usage after finish_reason; only [DONE] terminates it.
    return false;
}

function reportDiagnostic(protocol: TextStreamProtocol, kind: string, status?: number) {
    console.warn("Text stream protocol diagnostic", { protocol, kind, status });
}

function parseRecord(value: string) {
    try {
        return record(JSON.parse(value));
    } catch {
        return undefined;
    }
}

function firstRecord(value: unknown) {
    return Array.isArray(value) ? value[0] : undefined;
}

function records(value: unknown) {
    return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
