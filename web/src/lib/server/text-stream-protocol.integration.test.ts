import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeTextStream } from "./text-stream-protocol";

describe("normalized text stream protocol over TCP", () => {
    let close: (() => Promise<void>) | undefined;

    afterEach(async () => {
        await close?.();
        close = undefined;
    });

    it("decodes a Unicode Gemini stream split across TCP writes", async () => {
        const server = createServer((_request, response) => {
            response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
            const body = Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}\n\ndata: {"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}\n\ndata: [DONE]\n\n');
            response.write(body.subarray(0, 53));
            response.end(body.subarray(53));
        });
        const origin = await listen(server);
        close = () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

        const events: unknown[] = [];
        for await (const event of normalizeTextStream(await fetch(origin), "gemini")) events.push(event);

        expect(events).toEqual([{ type: "text_delta", text: "你好" }, { type: "usage", inputTokens: 4, outputTokens: 2, totalTokens: 6 }, { type: "completed" }]);
    });
});

function listen(server: ReturnType<typeof createServer>) {
    return new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") return reject(new Error("TCP fixture did not bind a port"));
            resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}
