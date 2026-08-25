import { describe, expect, it } from "vitest";

import { pointsResponseHeaders } from "./points-response";

describe("pointsResponseHeaders", () => {
    it("projects settled, held, and available decimal balances without legacy wallet headers", () => {
        const headers = pointsResponseHeaders({ settledBalance: "123.50000000", heldBalance: "3.25", availableBalance: "120.25" });

        expect(headers.get("x-vozeb-pro-balance-settled")).toBe("123.50000000");
        expect(headers.get("x-vozeb-pro-balance-held")).toBe("3.25");
        expect(headers.get("x-vozeb-pro-balance-available")).toBe("120.25");
        expect([...headers.keys()].filter((name) => name.includes("daily") || name.includes("permanent") || name.includes("points-remaining"))).toEqual([]);
    });

    it("rejects malformed decimal balance headers", () => {
        const headers = pointsResponseHeaders({ settledBalance: "NaN", heldBalance: "1e4", availableBalance: "-1" });

        expect([...headers.keys()]).toEqual([]);
    });
});
