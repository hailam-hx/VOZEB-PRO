import { describe, expect, it } from "vitest";

import { decimal } from "./decimal";

describe("exact decimal serialization", () => {
    it("keeps terminating decimals exact and rounds repeating decimals half up at the requested scale", () => {
        expect(decimal("0.0000000000000000000000000000000000001").toStringOrRound(36)).toBe("0.0000000000000000000000000000000000001");
        expect(decimal(1).dividedBy(decimal(3)).toStringOrRound(36)).toBe("0.333333333333333333333333333333333333");
        expect(decimal(1).dividedBy(decimal(6)).toStringOrRound(1)).toBe("0.2");
        expect(decimal(-1).dividedBy(decimal(6)).toStringOrRound(1)).toBe("-0.2");
    });
});
