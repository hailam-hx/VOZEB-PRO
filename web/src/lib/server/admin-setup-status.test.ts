import { describe, expect, it } from "vitest";

describe("admin setup commerce source", () => {
    it("uses top-up presets without the retired billing product service", async () => {
        const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./admin-setup-status.ts", import.meta.url), "utf8"));
        expect(source).toContain("topUps.listPresets");
        expect(source).not.toContain("billing-service");
        expect(source).not.toContain("PlanProducts");
    });
});
