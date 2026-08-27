import { describe, expect, it } from "vitest";

import { toPublicPointRecord } from "./store-actions";

describe("public point record projection", () => {
    it("does not expose administrator or request identities", () => {
        const record = toPublicPointRecord({
            id: "record-one",
            userId: "user-one",
            operatorUserId: "admin-one",
            type: "admin-adjust",
            amount: "1.25",
            balanceAfter: "2.5",
            description: "补偿",
            requestFingerprint: "a".repeat(64),
            createdAt: "2026-08-26T00:00:00.000Z",
        });

        expect(record).not.toHaveProperty("operatorUserId");
        expect(record).not.toHaveProperty("requestFingerprint");
        expect(record).toMatchObject({ id: "record-one", amount: "1.25", description: "补偿" });
    });
});
