import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("create upload validation", () => {
    it("uses the MIME-specific shared upload policy instead of a global 20MB limit", () => {
        const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

        expect(source).toContain("creativeUploadMaxBytesForMimeType");
        expect(source).not.toContain("file.size > CREATIVE_UPLOAD_MAX_BYTES");
    });

    it("renders the actual media limit in every supported locale", () => {
        for (const locale of ["zh-CN", "vi", "en"]) {
            const messages = JSON.parse(readFileSync(new URL(`../../../i18n/messages/${locale}.json`, import.meta.url), "utf8")) as { create: { fileTooLarge: string } };
            expect(messages.create.fileTooLarge).toContain("{limit}");
        }
    });
});
