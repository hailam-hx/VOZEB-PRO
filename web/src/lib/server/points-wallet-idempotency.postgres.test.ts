import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPostgresRepositories, ensurePostgresSchema } from "@/lib/server/database";

import { creditWalletBalance, getWalletSnapshot, reconcileWallet, reserveWalletCredits, settleWalletHold, type SettleWalletHoldInput } from "./points-wallet-service";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("PostgreSQL prepaid wallet persistence", () => {
    postgresIt("serializes concurrent non-integer reservations and never over-reserves", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `wallet-concurrent-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({ id: userId, username: `wallet_${suffix.replaceAll("-", "").slice(0, 16)}`, displayName: "钱包并发测试用户", bio: "", role: "user", adminPermissions: [], status: "active", settledBalance: "0", passwordHash: "integration-test-only", createdAt: now.toISOString(), updatedAt: now.toISOString() });
            await creditWalletBalance({ userId, amount: "10.5", businessId: `topup:${suffix}`, description: "测试充值", now });

            const results = await Promise.allSettled([
                reserveWalletCredits({ userId, businessId: `generation:a:${suffix}`, requestFingerprint: "a".repeat(64), amount: "7.125", description: "并发预留 A", now }),
                reserveWalletCredits({ userId, businessId: `generation:b:${suffix}`, requestFingerprint: "b".repeat(64), amount: "7.125", description: "并发预留 B", now }),
            ]);

            expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
            expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
            expect(await getWalletSnapshot(userId)).toEqual({ settledBalance: "10.5", heldBalance: "7.125", availableBalance: "3.375" });
        } finally {
            await repositories.users.delete(userId);
        }
    });

    postgresIt("settles once and reconciles the signed ledger from a zero opening balance", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `wallet-settle-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({ id: userId, username: `settle_${suffix.replaceAll("-", "").slice(0, 16)}`, displayName: "钱包结算测试用户", bio: "", role: "user", adminPermissions: [], status: "active", settledBalance: "0", passwordHash: "integration-test-only", createdAt: now.toISOString(), updatedAt: now.toISOString() });
            await creditWalletBalance({ userId, amount: "2.75", businessId: `topup:${suffix}`, description: "测试充值", now });
            const reservation = await reserveWalletCredits({ userId, businessId: `generation:${suffix}`, requestFingerprint: "c".repeat(64), amount: "1.23456789", description: "小数预留", now });
            const input: SettleWalletHoldInput = { holdId: reservation.hold.id, usageChargeId: `charge:${suffix}`, requestFingerprint: "d".repeat(64), settledCredits: "1.125", normalizedUsage: { capability: "image", source: "actual", count: "1" }, saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1.125" }] }, estimated: false, description: "小数结算", now };

            const first = await settleWalletHold(input);
            const replay = await settleWalletHold(input);

            expect(first.applied).toBe(true);
            expect(replay.applied).toBe(false);
            expect(await reconcileWallet(userId)).toEqual({ userId, ledgerBalance: "1.625", settledBalance: "1.625", activeHolds: "0", availableBalance: "1.625", issues: [] });
        } finally {
            await repositories.users.delete(userId);
        }
    });
});
