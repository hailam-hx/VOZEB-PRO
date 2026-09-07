import { describe, expect, it } from "vitest";

import { toPublicUser } from "./store-user-projection";
import type { StoredUser } from "./store-types";

describe("public user projection", () => {
    it("points an authenticated user's avatar at the implemented public avatar route", () => {
        const user: StoredUser = {
            id: "user-id",
            accountId: "0001",
            username: "avatar-owner",
            displayName: "Avatar Owner",
            bio: "",
            avatarStorageKey: "permanent/2026/09/07/images/avatar.webp",
            role: "user",
            adminPermissions: [],
            status: "active",
            settledBalance: "0",
            passwordHash: "hash",
            createdAt: "2026-09-07T00:00:00.000Z",
            updatedAt: "2026-09-07T01:02:03.000Z",
        };

        expect(toPublicUser(user).avatarUrl).toBe("/api/public/users/user-id/avatar?v=2026-09-07T01%3A02%3A03.000Z");
    });
});
