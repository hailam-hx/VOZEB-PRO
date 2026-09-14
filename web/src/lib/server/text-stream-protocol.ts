export type TextStreamProtocol = "chat" | "responses" | "gemini" | "claude";

export type NormalizedTextStreamEvent =
    | { type: "text_delta"; text: string }
    | { type: "usage"; inputTokens?: number; outputTokens?: number; totalTokens?: number }
    | { type: "completed" }
    | { type: "error"; message: string; status?: number; contract?: true };

export async function* normalizeTextStream(response: Response, protocol: TextStreamProtocol): AsyncGenerator<NormalizedTextStreamEvent> {
    if (!response.ok) {
        yield { type: "error", message: providerErrorMessage(await response.text(), response.status), status: response.status };
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
    const decoder = new TextDecoder();
    let buffer = "";
    let failed = false;
    const consume = (frame: string) => streamEvents(frame, protocol);
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            const frames = takeSseFrames(buffer);
            buffer = frames.rest;
            for (const frame of frames.values) {
                for (const event of consume(frame)) {
                    yield event;
                    if (event.type === "error") failed = true;
                }
            }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
            for (const event of consume(buffer)) {
                yield event;
                if (event.type === "error") failed = true;
            }
        }
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        yield { type: "error", message: error instanceof Error ? error.message : "读取文本流失败" };
        return;
    } finally {
        reader.releaseLock();
    }
    if (!failed) yield { type: "completed" };
}

function streamEvents(frame: string, protocol: TextStreamProtocol): NormalizedTextStreamEvent[] {
    if (frame.trim() === "[DONE]") return [];
    const payload = parseRecord(frame);
    if (!payload) return [];
    const error = streamError(payload);
    if (error) return [{ type: "error", message: error }];
    const events: NormalizedTextStreamEvent[] = [];
    const text = streamedText(payload, protocol);
    if (text) events.push({ type: "text_delta", text });
    const usage = normalizedUsage(payload);
    if (usage) events.push({ type: "usage", ...usage });
    return events;
}

function takeSseFrames(value: string) {
    const values: string[] = [];
    let rest = value;
    for (;;) {
        const match = /\r?\n\r?\n/u.exec(rest);
        if (!match || match.index === undefined) break;
        const block = rest.slice(0, match.index);
        rest = rest.slice(match.index + match[0].length);
        const data = block
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^\s/u, ""))
            .join("\n");
        if (data) values.push(data);
    }
    return { values, rest };
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

function normalizedUsage(payload: Record<string, unknown>) {
    const usage = record(payload.usage) || record(record(payload.response)?.usage) || record(payload.usageMetadata);
    if (!usage) return undefined;
    const inputTokens = numberValue(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount);
    const outputTokens = numberValue(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount);
    const totalTokens = numberValue(usage.total_tokens ?? usage.totalTokenCount) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
    return inputTokens === undefined && outputTokens === undefined && totalTokens === undefined ? undefined : { inputTokens, outputTokens, totalTokens };
}

function streamError(payload: Record<string, unknown>) {
    const root = record(payload.error);
    const nested = record(record(payload.response)?.error);
    const message = firstText(root?.message, nested?.message, payload.type === "error" || payload.type === "response.failed" ? payload.message : undefined);
    return message || undefined;
}

function providerErrorMessage(raw: string, status: number) {
    try {
        const payload = record(JSON.parse(raw));
        return streamError(payload || {}) || firstText(payload?.message, payload?.msg) || `文本流请求失败（HTTP ${status}）`;
    } catch {
        return raw.trim() || `文本流请求失败（HTTP ${status}）`;
    }
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

function firstText(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() || "";
}
