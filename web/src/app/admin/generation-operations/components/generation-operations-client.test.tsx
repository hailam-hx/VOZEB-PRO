import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GenerationOperationsClient", () => {
    it("does not expose manual takeover controls", () => {
        const source = readFileSync(new URL("./generation-operations-client.tsx", import.meta.url), "utf8");

        expect(source).not.toContain("接管待确认任务");
        expect(source).not.toContain("ShieldAlert");
        expect(source).not.toContain("canReview");
    });

    it("uses the same separate request diagnostics on desktop and mobile", () => {
        const source = readFileSync(new URL("./generation-operations-client.tsx", import.meta.url), "utf8");

        expect(source.match(/<GenerationRequestSummary/g)).toHaveLength(2);
        expect(source).not.toContain("task.prompt || task.error");
    });
});
