import { afterEach, describe, expect, it } from "vitest";

import { createSignedReferenceAssetUrl, signReferenceAssetInputUrl, verifyReferenceAssetSignature } from "./reference-asset-access";

const previousKey = process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY;

afterEach(() => {
    if (previousKey === undefined) delete process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY;
    else process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY = previousKey;
});

describe("reference asset access", () => {
    it("creates and verifies a bounded signed server URL", () => {
        process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY = "test-signing-key";
        const now = Date.UTC(2026, 6, 19);
        const url = new URL(createSignedReferenceAssetUrl("temporary/2026/07/19/images/file.png", "https://vozeb.example", now));
        const purpose = url.searchParams.get("purpose");

        expect(url.origin).toBe("https://vozeb.example");
        expect(purpose).toBe("provider-read");
        expect(verifyReferenceAssetSignature("temporary/2026/07/19/images/file.png", purpose, url.searchParams.get("expires"), url.searchParams.get("signature"), now)).toBe(true);
        expect(verifyReferenceAssetSignature("temporary/2026/07/19/images/file.png", "download", url.searchParams.get("expires"), url.searchParams.get("signature"), now)).toBe(false);
        expect(verifyReferenceAssetSignature("temporary/2026/07/19/images/other.png", purpose, url.searchParams.get("expires"), url.searchParams.get("signature"), now)).toBe(false);
        expect(verifyReferenceAssetSignature("temporary/2026/07/19/images/file.png", purpose, url.searchParams.get("expires"), url.searchParams.get("signature"), now + 14 * 60 * 1000)).toBe(true);
        expect(verifyReferenceAssetSignature("temporary/2026/07/19/images/file.png", purpose, url.searchParams.get("expires"), url.searchParams.get("signature"), now + 16 * 60 * 1000)).toBe(false);
    });

    it("only signs local reference asset paths", () => {
        process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY = "test-signing-key";
        expect(signReferenceAssetInputUrl("https://cdn.example/image.png", "https://vozeb.example")).toBe("https://cdn.example/image.png");
        expect(signReferenceAssetInputUrl("/api/reference-assets/permanent/2026/07/19/images/file.png", "https://vozeb.example")).toContain("purpose=provider-read");
    });

    it("derives provider-read expiry from the configured task timeout", () => {
        process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY = "test-signing-key";
        const now = Date.UTC(2026, 6, 19);
        const url = new URL(createSignedReferenceAssetUrl("permanent/audio.wav", "https://vozeb.example", now, 30 * 60_000));

        expect(Number(url.searchParams.get("expires"))).toBe(Math.floor((now + 30 * 60_000) / 1000));
        expect(verifyReferenceAssetSignature("permanent/audio.wav", url.searchParams.get("purpose"), url.searchParams.get("expires"), url.searchParams.get("signature"), now)).toBe(true);
    });
});
