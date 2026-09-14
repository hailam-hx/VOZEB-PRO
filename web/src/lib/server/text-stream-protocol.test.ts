import { describe, expect, it } from "vitest";

import { normalizeTextStream } from "./text-stream-protocol";

const encoder = new TextEncoder();

describe("normalized text stream protocol", () => {
    it.each([
        ["chat", ['data: {"choices":[{"delta":{"content":"你","reasoning_content":"hidden","tool_calls":[{}]}}]}', 'data: {"choices":[{"delta":{"content":"好"}}]}', 'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}']] as const,
        ["responses", ['event: response.output_text.delta\ndata: {"type":"response.output_text.delta",\ndata: "delta":"你"}', 'data: {"type":"response.output_text.delta","delta":"好"}', 'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}']] as const,
        ["gemini", ['data: {"candidates":[{"content":{"parts":[{"text":"你"},{"functionCall":{"name":"hidden"}}]}}]}', 'data: {"candidates":[{"content":{"parts":[{"text":"好"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}']] as const,
        ["claude", ['event: content_block_delta\ndata: {"type":"content_block_delta",\ndata: "delta":{"type":"text_delta","text":"你"}}', 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}', 'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":2,"output_tokens":3}}']] as const,
    ])("emits text and usage from fragmented multiline %s SSE without internal payloads", async (protocol, frames) => {
        const response = sseResponse([...frames, "data: [DONE]"], [1, 2, 4, 3, 5]);

        await expect(read(normalizeTextStream(response, protocol))).resolves.toEqual([
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
        await expect(read(normalizeTextStream(Response.json({ error: { message: "额度不足" } }, { status: 429 }), "chat"))).resolves.toEqual([{ type: "error", message: "额度不足", status: 429 }]);
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
