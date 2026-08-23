import { describe, expect, it } from "vitest";

import { normalizeDb } from "./store-normalizers";

describe("wallet auth normalization", () => {
    it("constructs users from the current projection without retaining removed wallet fields", () => {
        const normalized = normalizeDb({
            users: [{
                id: "user-one", accountId: "1", username: "user", displayName: "用户", bio: "", role: "user", adminPermissions: [], status: "active",
                settledBalance: "1.25", passwordHash: "hash", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
                planId: "legacy", pointsBalance: 99, quota: { imageDaily: 10 },
            } as never],
        });

        expect(normalized.users[0]).toMatchObject({ settledBalance: "1.25" });
        expect(normalized.users[0]).not.toHaveProperty("planId");
        expect(normalized.users[0]).not.toHaveProperty("pointsBalance");
        expect(normalized.users[0]).not.toHaveProperty("quota");
    });
});
