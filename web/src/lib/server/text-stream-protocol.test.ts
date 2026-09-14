import { describe, expect, it } from "vitest";

import { normalizeTextStream } from "./text-stream-protocol";

const encoder = new TextEncoder();

describe("normalized text stream protocol", () => {
    it.each([
        ["chat", ['data: {"choices":[{"delta":{"content":"你","reasoning_content":"hidden","tool_calls":[{}]}}]}', 'data: {"choices":[{"delta":{"content":"好"}}]}', 'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}']] as const,
        ["responses", ['event: response.output_text.delta\ndata: {"type":"response.output_text.delta",\ndata: "delta":"你"}', 'data: {"type":"response.output_text.delta","delta":"好"}', 'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}']] as const,
        ["gemini", ['data: {"candidates":[{"content":{"parts":[{"text":"你"},{"functionCall":{"name":"hidden"}}]}}]}', 'data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}']] as const,
        ["claude", ['event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":2}}}', 'event: content_block_delta\ndata: {"type":"content_block_delta",\ndata: "delta":{"type":"text_delta","text":"你"}}', 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}', 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}']] as const,
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
        await expect(read(normalizeTextStream(Response.json({ output_text: "buffered" }), "responses"))).resolves.toEqual([
            { type: "error", message: "文本流协议预期 SSE 响应，但上游返回了 application/json", contract: true },
        ]);
    });

    it("normalizes provider HTTP error JSON", async () => {
        await expect(read(normalizeTextStream(Response.json({ error: { message: "额度不足" } }, { status: 429 }), "chat"))).resolves.toEqual([{ type: "error", message: "文本流请求失败（HTTP 429）", status: 429 }]);
    });

    it("does not expose a raw non-JSON gateway response", async () => {
        await expect(read(normalizeTextStream(new Response("<html>upstream token=secret</html>", { status: 502 }), "chat"))).resolves.toEqual([{ type: "error", message: "文本流请求失败（HTTP 502）", status: 502 }]);
    });

    it("does not expose a raw provider SSE error", async () => {
        await expect(read(normalizeTextStream(sseResponse(['event: error\ndata: {"type":"error","error":{"message":"internal upstream details"}}'], [1024]), "claude"))).resolves.toEqual([
            { type: "error", message: "文本流上游返回错误" },
        ]);
    });

    it("reports EOF before a native terminal event as a contract error", async () => {
        await expect(read(normalizeTextStream(sseResponse(['data: {"choices":[{"delta":{"content":"incomplete"}}]}'], [1024]), "chat"))).resolves.toEqual([
            { type: "text_delta", text: "incomplete" },
            { type: "error", message: "文本流在完成前意外结束", contract: true },
        ]);
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
        ).resolves.toEqual([
            { type: "usage", inputTokens: 11 },
            { type: "usage", inputTokens: 11, outputTokens: 7, totalTokens: 18 },
            { type: "completed" },
        ]);
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
