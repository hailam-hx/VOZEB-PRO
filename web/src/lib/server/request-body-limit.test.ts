import { describe, expect, it } from "vitest";

import { readRequestBodyBytes, readRequestBodyText, readRequestFormDataWithinLimit, RequestBodyTooLargeError } from "./request-body-limit";

describe("request body limits", () => {
    it("rejects an oversized Content-Length before reading", async () => {
        const request = new Request("http://localhost", { method: "POST", headers: { "Content-Length": "11" }, body: "small" });
        await expect(readRequestBodyBytes(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    });

    it("rejects a chunked body after crossing the hard limit", async () => {
        const request = new Request("http://localhost", {
            method: "POST",
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array(6));
                    controller.enqueue(new Uint8Array(6));
                    controller.close();
                },
            }),
            duplex: "half",
        } as RequestInit);
        await expect(readRequestBodyBytes(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    });

    it("reads text within the configured limit", async () => {
        await expect(readRequestBodyText(new Request("http://localhost", { method: "POST", body: "callback" }), 32)).resolves.toBe("callback");
    });

    it("rejects a chunked multipart body while it streams across the hard limit", async () => {
        const boundary = "bounded-upload";
        const body = [`--${boundary}\r\n`, 'Content-Disposition: form-data; name="file"; filename="clip.mp4"\r\n', "Content-Type: video/mp4\r\n\r\n", "1234567890", `\r\n--${boundary}--\r\n`].join("");
        const encoded = new TextEncoder().encode(body);
        const request = new Request("http://localhost", {
            method: "POST",
            headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(encoded.slice(0, encoded.byteLength - 1));
                    controller.enqueue(encoded.slice(encoded.byteLength - 1));
                    controller.close();
                },
            }),
            duplex: "half",
        } as RequestInit);

        await expect(readRequestFormDataWithinLimit(request, encoded.byteLength - 1)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    });

    it("parses multipart data at the exact byte limit without pre-buffering the full request", async () => {
        const body = new FormData();
        body.set("conversationId", "conversation-one");
        body.set("file", new File(["video"], "clip.mp4", { type: "video/mp4" }));
        const original = new Request("http://localhost", { method: "POST", body });
        const bytes = new Uint8Array(await original.clone().arrayBuffer());

        const form = await readRequestFormDataWithinLimit(original, bytes.byteLength);

        expect(form.get("conversationId")).toBe("conversation-one");
        expect(form.get("file")).toBeInstanceOf(File);
    });
});
