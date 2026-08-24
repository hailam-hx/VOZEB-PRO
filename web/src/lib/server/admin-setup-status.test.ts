import { describe, expect, it } from "vitest";

describe("admin setup commerce source", () => {
    it("uses the top-up preset repository", async () => {
        const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./admin-setup-status.ts", import.meta.url), "utf8"));
        expect(source).toContain("topUps.listPresets");
        expect(source).toContain("enabledTopUpPresets");
    });
});
