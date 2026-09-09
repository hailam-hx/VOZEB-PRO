import { describe, expect, it } from "vitest";
import { requireSeoPageLocale } from "./seo-page";
import { seoPublicationRegistry } from "./routing";
describe("localized page validation", () => {
    it("returns 404 for unsupported and unpublished page-locale pairs", () => {
        expect(() => requireSeoPageLocale("terms", "fr")).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
        seoPublicationRegistry.privacy.published.en = false;
        try {
            expect(() => requireSeoPageLocale("privacy", "en")).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
        } finally {
            seoPublicationRegistry.privacy.published.en = true;
        }
        expect(requireSeoPageLocale("terms", "en")).toBe("en");
    });
});
