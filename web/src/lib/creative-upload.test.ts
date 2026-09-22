import { describe, expect, it } from "vitest";

import { creativeUploadMaxBytesForMimeType, CREATIVE_UPLOAD_MAX_BYTES_BY_TYPE, isCreativeUploadSizeAllowed } from "./creative-upload";

describe("creative upload media policy", () => {
    it("defines one canonical byte limit for each media type", () => {
        expect(CREATIVE_UPLOAD_MAX_BYTES_BY_TYPE).toEqual({
            image: 20 * 1024 * 1024,
            video: 200 * 1024 * 1024,
            audio: 30 * 1024 * 1024,
        });
    });

    it.each([
        ["image/png", 20 * 1024 * 1024],
        ["video/mp4", 200 * 1024 * 1024],
        ["audio/mpeg", 30 * 1024 * 1024],
    ] as const)("enforces exact byte boundaries for %s", (mimeType, limit) => {
        expect(creativeUploadMaxBytesForMimeType(mimeType)).toBe(limit);
        expect(isCreativeUploadSizeAllowed(mimeType, limit - 1)).toBe(true);
        expect(isCreativeUploadSizeAllowed(mimeType, limit)).toBe(true);
        expect(isCreativeUploadSizeAllowed(mimeType, limit + 1)).toBe(false);
    });

    it("does not infer a media policy from an unsupported MIME type", () => {
        expect(creativeUploadMaxBytesForMimeType("application/pdf")).toBeNull();
    });
});
