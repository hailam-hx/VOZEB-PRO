import { describe, expect, it } from "vitest";

import { canonicalMultipartBodyDigest, cloneMultipartFormDataWithDigest } from "./multipart-body-digest";

describe("canonical multipart body digest", () => {
    it("uses field and file content instead of serialization boundaries", async () => {
        const first = multipartFixture();
        const second = multipartFixture();
        const cloned = await cloneMultipartFormDataWithDigest(first);

        expect(cloned.bodyDigest).toBe(await canonicalMultipartBodyDigest(second));
        expect(cloned.body.get("model")).toBe("image-pro");
        expect(await (cloned.body.get("image") as File).text()).toBe("fixture");
    });
});

function multipartFixture() {
    const body = new FormData();
    body.append("model", "image-pro");
    body.append("image", new Blob(["fixture"], { type: "image/png" }), "fixture.png");
    return body;
}
