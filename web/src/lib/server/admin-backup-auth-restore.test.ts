import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyDb } from "@/lib/auth/store-normalizers";
import type { QueryExecutor } from "@/lib/server/database";

const mocks = vi.hoisted(() => ({
    upsertPostgresSettings: vi.fn(),
    upsertPostgresSystemChannels: vi.fn(),
    insertPostgresUsers: vi.fn(),
    insertPostgresSessions: vi.fn(),
    insertPostgresEmailCodes: vi.fn(),
    insertPostgresQuotaUsage: vi.fn(),
    insertPostgresPointRecords: vi.fn(),
    insertPostgresWalletHolds: vi.fn(),
    insertPostgresUsageCharges: vi.fn(),
    insertPostgresProviderUsageAttempts: vi.fn(),
    insertPostgresCdkCodes: vi.fn(),
    insertPostgresAnnouncements: vi.fn(),
}));

vi.mock("@/lib/auth/store-repository", () => mocks);

import { restorePostgresAuthSnapshot } from "./admin-backup-auth-restore";

describe("PostgreSQL account-config auth restore", () => {
    beforeEach(() => vi.clearAllMocks());

    it("uses upserts and never deletes users or backup-missing auth entities", async () => {
        const query = vi.fn(async (...args: [string]) => {
            void args;
            return { rows: [] };
        });
        const client = { query } as unknown as QueryExecutor;
        const db = emptyDb();
        db.users.push({
            id: "user-a",
            accountId: "1",
            username: "admin",
            email: "admin@example.com",
            displayName: "管理员",
            bio: "",
            role: "admin",
            adminPermissions: ["system.manage"],
            status: "active",
            settledBalance: "10",
            passwordHash: "hash",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        });
        db.walletHolds.push({ id: "hold-a", userId: "user-a", businessId: "generation:a", requestFingerprint: "a".repeat(64), amount: "1.25", status: "active", description: "生成预留", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
        db.providerUsageAttempts.push({ id: "attempt-a", holdId: "hold-a", userId: "user-a", attemptNumber: 1, status: "failed", provider: "vendor", bindingId: "binding", requestFingerprint: "b".repeat(64), nativeCostAmount: "0.1", nativeCostUnit: { kind: "fiat", currency: "USD" }, costUsd: "0.1", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", completedAt: "2026-08-01T00:00:00.000Z" });

        await restorePostgresAuthSnapshot(client, db);

        expect(mocks.insertPostgresUsers).toHaveBeenCalledWith(client, [expect.objectContaining({ id: "user-a", accountId: "0001" })]);
        expect(mocks.insertPostgresWalletHolds).toHaveBeenCalledWith(client, [expect.objectContaining({ id: "hold-a", amount: "1.25" })]);
        expect(mocks.insertPostgresProviderUsageAttempts).toHaveBeenCalledWith(client, [expect.objectContaining({ id: "attempt-a", nativeCostAmount: "0.1" })]);
        expect(query.mock.calls.map(([sql]) => sql.toUpperCase()).some((sql) => sql.includes("DELETE FROM"))).toBe(false);
    });
});
