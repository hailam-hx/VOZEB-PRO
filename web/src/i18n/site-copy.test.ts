import { describe, expect, it } from "vitest";

import { localizeBuiltInSiteCopy } from "./site-copy";

describe("localizeBuiltInSiteCopy", () => {
    it("replaces an unchanged built-in value", () => {
        expect(localizeBuiltInSiteCopy("默认文案", "默认文案", "Localized copy")).toBe("Localized copy");
    });

    it("preserves administrator-provided content", () => {
        expect(localizeBuiltInSiteCopy("  Custom footer copy  ", "默认文案", "Localized copy")).toBe("Custom footer copy");
    });
});
