import { describe, expect, it } from "vitest";
import { loadMessages } from "./messages";
import en from "./messages/en.json";

describe("published SEO catalogs", () => {
    it("rejects missing public copy instead of publishing Vietnamese fallback", () => {
        const home = en.home as Record<string, unknown>;
        const saved = home.metadataDescription;
        delete home.metadataDescription;
        try {
            expect(() => loadMessages("en")).toThrow(/home.metadataDescription/);
        } finally {
            home.metadataDescription = saved;
        }
    });
});
