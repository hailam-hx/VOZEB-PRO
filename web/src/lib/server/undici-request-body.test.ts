import { describe, expect, it } from "vitest";

import { toUndiciRequestBody } from "./undici-request-body";

describe("toUndiciRequestBody", () => {
    it("does not mistake byte-array entries for multipart form fields", async () => {
        const bytes = new Uint8Array([1, 2, 3]);

        await expect(toUndiciRequestBody(bytes)).resolves.toBe(bytes);
    });

    it("leaves URL-encoded form bodies unchanged", async () => {
        const params = new URLSearchParams({ model: "text-model" });

        await expect(toUndiciRequestBody(params)).resolves.toBe(params);
    });

    it("converts native-compatible entries-only multipart bodies", async () => {
        const native = new FormData();
        native.set("model", "video-model");
        const body = Object.assign(Object.create(null) as object, { entries: () => native.entries() }) as FormData;

        const converted = await toUndiciRequestBody(body);

        expect(converted).not.toBe(body);
        expect(Object.prototype.toString.call(converted)).toBe("[object FormData]");
    });
});
