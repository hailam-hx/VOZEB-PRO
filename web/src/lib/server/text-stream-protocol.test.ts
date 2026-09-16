import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeTextStream } from "./text-stream-protocol";

const encoder = new TextEncoder();

describe("normalized text stream protocol", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it.each([
        ["chat", 'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n'],
        ["responses", 'data: {"type":"response.output_text.delta","delta":"done"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2}}}\n\n'],
        ["claude", 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"done"}}\n\ndata: {"type":"message_delta","usage":{"input_tokens":5,"output_tokens":2}}\n\ndata: {"type":"message_stop"}\n\n'],
        ["gemini", 'data: {"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\n\n'],
    ] as const)("completes and cancels the reader at the %s terminal marker without waiting for EOF", async (protocol, frames) => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(value) {
                controller = value;
            },
            cancel,
        });
        controller.enqueue(encoder.encode(frames));
        let settled = false;
        const result = read(normalizeTextStream(new Response(body, { headers: { "content-type": "text/event-stream" } }), protocol)).then((events) => {
            settled = true;
            return events;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const endedAtMarker = settled;
        if (!settled) controller.close();
        expect(await result).toEqual([{ type: "text_delta", text: "done" }, { type: "usage", inputTokens: 5, outputTokens: 2, totalTokens: 7 }, { type: "completed" }]);
        expect(endedAtMarker).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
        expect(body.locked).toBe(false);
    });

    it("emits response.failed usage before the safe error", async () => {
        const frames = [
            'data: {"type":"response.failed","response":{"id":"resp_fixture","status":"failed","usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7},"error":{"type":"upstream_error","code":"server_error","message":"Service unavailable","status":503}}}',
        ];
        expect(await read(normalizeTextStream(sseResponse(frames, [3]), "responses"))).toEqual([
            { type: "usage", inputTokens: 5, outputTokens: 2, totalTokens: 7 },
            {
                type: "error",
                message: "文本流上游返回错误：type=upstream_error；code=server_error；status=503；message=Service unavailable",
                status: 503,
                providerError: { kind: "provider_error", type: "upstream_error", code: "server_error", message: "Service unavailable", status: 503 },
            },
        ]);
    });

    it.each([
        {
            name: "OpenAI nested error",
            frame: 'data: {"error":{"type":"server_error","code":"overloaded","message":"Service overloaded","status":429}}',
            expected: { kind: "provider_error", type: "server_error", code: "overloaded", message: "Service overloaded", status: 429 },
        },
        {
            name: "response.error",
            frame: 'data: {"type":"response.error","response":{"error":{"type":"invalid_request_error","code":"model_unavailable","message":"Model unavailable"}},"status":503}',
            expected: { kind: "provider_error", type: "invalid_request_error", code: "model_unavailable", message: "Model unavailable", status: 503 },
        },
        {
            name: "top-level provider error",
            frame: 'data: {"type":"error","code":"rate_limit","message":"Too many requests","status":429}',
            expected: { kind: "provider_error", type: "error", code: "rate_limit", message: "Too many requests", status: 429 },
        },
    ])("preserves a safe structured summary for $name", async ({ frame, expected }) => {
        const [event] = await read(normalizeTextStream(sseResponse([frame], [2]), "responses"));

        expect(event).toMatchObject({ type: "error", status: expected.status, providerError: expected });
    });

    it("redacts credentials, request echoes and sensitive URLs from provider messages", async () => {
        const secretMessage = 'Bearer sk-secret api_key=private authorization=private prompt="private user prompt" https://provider.example/path?token=secret';
        const [event] = await read(normalizeTextStream(sseResponse([`data: ${JSON.stringify({ error: { type: "server_error", code: "unsafe", message: secretMessage } })}`], [7]), "chat"));
        const serialized = JSON.stringify(event);

        expect(serialized).toContain("[redacted]");
        expect(serialized).not.toContain("sk-secret");
        expect(serialized).not.toContain("private user prompt");
        expect(serialized).not.toContain("provider.example");
    });

    it("truncates an excessively long provider error message", async () => {
        const [event] = await read(normalizeTextStream(sseResponse([`data: ${JSON.stringify({ error: { message: "x".repeat(2_000) } })}`], [11]), "chat"));

        expect(event).toMatchObject({ type: "error", providerError: { kind: "provider_error", message: `${"x".repeat(497)}...` } });
    });
    it.each([
        ["chat", ['data: {"choices":[{"delta":{"content":"你","reasoning_content":"hidden","tool_calls":[{}]}}]}', 'data: {"choices":[{"delta":{"content":"好"}}]}', 'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}']] as const,
        [
            "responses",
            [
                'event: response.output_text.delta\ndata: {"type":"response.output_text.delta",\ndata: "delta":"你"}',
                'data: {"type":"response.output_text.delta","delta":"好"}',
                'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}',
            ],
        ] as const,
        [
            "gemini",
            [
                'data: {"candidates":[{"content":{"parts":[{"text":"你"},{"functionCall":{"name":"hidden"}}]}}]}',
                'data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}',
            ],
        ] as const,
        [
            "claude",
            [
                'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":2}}}',
                'event: content_block_delta\ndata: {"type":"content_block_delta",\ndata: "delta":{"type":"text_delta","text":"你"}}',
                'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}',
                'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}',
            ],
        ] as const,
    ])("emits text and usage from fragmented multiline %s SSE without internal payloads", async (protocol, frames) => {
        const response = sseResponse([...frames, "data: [DONE]"], [1, 2, 4, 3, 5]);

        await expect(read(normalizeTextStream(response, protocol))).resolves.toEqual([
            ...(protocol === "claude" ? [{ type: "usage", inputTokens: 2 }] : []),
            { type: "text_delta", text: "你" },
            { type: "text_delta", text: "好" },
            { type: "usage", inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            { type: "completed" },
        ]);
    });

    it("turns a successful JSON response from a streaming protocol into a contract error", async () => {
        await expect(read(normalizeTextStream(Response.json({ output_text: "buffered" }), "responses"))).resolves.toEqual([{ type: "error", message: "文本流协议预期 SSE 响应，但上游返回了 application/json", contract: true }]);
    });

    it("normalizes provider HTTP error JSON", async () => {
        await expect(read(normalizeTextStream(Response.json({ error: { message: "额度不足" } }, { status: 429 }), "chat"))).resolves.toEqual([{ type: "error", message: "文本流请求失败（HTTP 429）", status: 429 }]);
    });

    it("does not expose a raw non-JSON gateway response", async () => {
        await expect(read(normalizeTextStream(new Response("<html>upstream token=secret</html>", { status: 502 }), "chat"))).resolves.toEqual([{ type: "error", message: "文本流请求失败（HTTP 502）", status: 502 }]);
    });

    it("keeps only the safe provider SSE error summary", async () => {
        await expect(read(normalizeTextStream(sseResponse(['event: error\ndata: {"type":"error","error":{"message":"internal upstream details","param":"secret request body"}}'], [1024]), "claude"))).resolves.toEqual([
            {
                type: "error",
                message: "文本流上游返回错误：type=error；message=internal upstream details",
                providerError: { kind: "provider_error", type: "error", message: "internal upstream details" },
            },
        ]);
    });

    it("reports EOF before a native terminal event as a contract error", async () => {
        vi.stubEnv("VOZEB_PRO_TEXT_STREAM_DIAGNOSTICS_TEST", "1");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        await expect(
            read(
                normalizeTextStream(sseResponse(['data: {"choices":[{"delta":{"content":"incomplete"}}]}'], [1024]), "chat", {
                    diagnosticContext: { source: "text_task_adapter", taskId: "incomplete-task" },
                }),
            ),
        ).resolves.toEqual([
            { type: "text_delta", text: "incomplete" },
            { type: "error", message: "文本流在完成前意外结束", contract: true },
        ]);
        expect(info).toHaveBeenCalledWith("Text stream transport diagnostic", expect.objectContaining({ connectionTermination: "normal_eof", framesReceived: 1, terminalSeen: false, doneMarkerSeen: false, usageSeen: false }));
    });

    it("keeps Chat finish_reason plus normal EOF without DONE as a contract error and records the terminal metadata", async () => {
        vi.stubEnv("VOZEB_PRO_TEXT_STREAM_DIAGNOSTICS_TEST", "1");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"complete-looking text"},"finish_reason":"stop"}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n');

        await expect(
            read(
                normalizeTextStream(
                    new Response(
                        new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(bytes);
                                controller.close();
                            },
                        }),
                        { headers: { "content-type": "text/event-stream" } },
                    ),
                    "chat",
                    { diagnosticContext: { source: "text_task_adapter", taskId: "normal-eof-task" } },
                ),
            ),
        ).resolves.toEqual([
            { type: "text_delta", text: "complete-looking text" },
            { type: "usage", inputTokens: 5, outputTokens: 2, totalTokens: 7 },
            { type: "error", message: "文本流在完成前意外结束", contract: true },
        ]);
        expect(info).toHaveBeenCalledWith(
            "Text stream transport diagnostic",
            expect.objectContaining({
                connectionTermination: "normal_eof",
                framesReceived: 2,
                bytesReceived: bytes.byteLength,
                finishReason: "stop",
                terminalSeen: true,
                doneMarkerSeen: false,
                usageSeen: true,
            }),
        );
    });

    it("logs redacted frame order and a structured socket reset without changing the public failure", async () => {
        vi.stubEnv("VOZEB_PRO_TEXT_STREAM_DIAGNOSTICS_TEST", "1");
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const rootError = Object.assign(new TypeError("terminated while reading https://provider.example/stream?api_key=private-key"), {
            cause: Object.assign(new Error("other side closed"), { name: "SocketError", code: "UND_ERR_SOCKET", errno: -104, syscall: "read" }),
        });
        const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"secret prompt text"},"finish_reason":"stop"}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n');
        let sent = false;
        const response = new Response(
            new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (!sent) {
                        sent = true;
                        controller.enqueue(bytes);
                        return;
                    }
                    controller.error(rootError);
                },
            }),
            { headers: { "content-type": "text/event-stream" } },
        );

        await expect(
            read(
                normalizeTextStream(response, "chat", {
                    diagnosticContext: { source: "text_task_adapter", taskId: "task-one", attemptId: "attempt-one" },
                }),
            ),
        ).resolves.toEqual([
            { type: "text_delta", text: "secret prompt text" },
            { type: "usage", inputTokens: 5, outputTokens: 2, totalTokens: 7 },
            { type: "error", message: "读取文本流失败" },
        ]);
        const frameLogs = info.mock.calls.filter(([message]) => message === "Text stream frame diagnostic").map(([, entry]) => entry);
        expect(frameLogs).toEqual([
            expect.objectContaining({ sequence: 1, finishReason: "stop", terminalSeen: true, doneMarkerSeen: false, usageSeen: false, textDelta: true }),
            expect.objectContaining({ sequence: 2, finishReason: "stop", terminalSeen: true, doneMarkerSeen: false, usageSeen: true, textDelta: false }),
        ]);
        expect(warn).toHaveBeenCalledWith(
            "Text stream transport diagnostic",
            expect.objectContaining({
                source: "text_task_adapter",
                taskId: "task-one",
                attemptId: "attempt-one",
                connectionTermination: "socket_reset",
                framesReceived: 2,
                bytesReceived: bytes.byteLength,
                finishReason: "stop",
                terminalSeen: true,
                doneMarkerSeen: false,
                usageSeen: true,
                rootError: {
                    name: "TypeError",
                    message: "terminated while reading [redacted-url]",
                    cause: { name: "SocketError", message: "other side closed", code: "UND_ERR_SOCKET", errno: -104, syscall: "read" },
                },
            }),
        );
        expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain("secret prompt text");
        expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain("private-key");
    });

    it("preserves Claude input usage from message_start and cumulative output usage", async () => {
        await expect(
            read(
                normalizeTextStream(
                    sseResponse(
                        [
                            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11}}}',
                            'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}',
                            'event: message_stop\ndata: {"type":"message_stop"}',
                        ],
                        [1024],
                    ),
                    "claude",
                ),
            ),
        ).resolves.toEqual([{ type: "usage", inputTokens: 11 }, { type: "usage", inputTokens: 11, outputTokens: 7, totalTokens: 18 }, { type: "completed" }]);
    });
});

function sseResponse(frames: string[], splitAt: number[]) {
    const bytes = encoder.encode(`${frames.join("\n\n")}\n\n`);
    let offset = 0;
    let index = 0;
    return new Response(
        new ReadableStream<Uint8Array>({
            pull(controller) {
                if (offset >= bytes.length) return controller.close();
                const size = splitAt[index++ % splitAt.length] || bytes.length;
                controller.enqueue(bytes.slice(offset, offset + size));
                offset += size;
            },
        }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
    );
}

async function read(stream: AsyncIterable<unknown>) {
    const events: unknown[] = [];
    for await (const event of stream) events.push(event);
    return events;
}
