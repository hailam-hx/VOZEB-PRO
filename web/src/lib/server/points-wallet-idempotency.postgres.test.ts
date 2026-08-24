import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPostgresRepositories, ensurePostgresSchema } from "@/lib/server/database";

import { creditWalletBalance, getWalletSnapshot, reconcileWallet, recordProviderUsageAttempt, releaseWalletHold, reserveWalletCredits, settleWalletHold, type SettleWalletHoldInput } from "./points-wallet-service";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("PostgreSQL prepaid wallet persistence", () => {
    postgresIt("serializes concurrent non-integer reservations and never over-reserves", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `wallet-concurrent-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({
                id: userId,
                username: `wallet_${suffix.replaceAll("-", "").slice(0, 16)}`,
                displayName: "钱包并发测试用户",
                bio: "",
                role: "user",
                adminPermissions: [],
                status: "active",
                settledBalance: "0",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });
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
            await repositories.users.createWithNextAccountId({
                id: userId,
                username: `settle_${suffix.replaceAll("-", "").slice(0, 16)}`,
                displayName: "钱包结算测试用户",
                bio: "",
                role: "user",
                adminPermissions: [],
                status: "active",
                settledBalance: "0",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });
            await creditWalletBalance({ userId, amount: "2.75", businessId: `topup:${suffix}`, description: "测试充值", now });
            const reservation = await reserveWalletCredits({ userId, businessId: `generation:${suffix}`, requestFingerprint: "c".repeat(64), amount: "1.23456789", description: "小数预留", now });
            const input: SettleWalletHoldInput = {
                holdId: reservation.hold.id,
                usageChargeId: `charge:${suffix}`,
                requestFingerprint: "d".repeat(64),
                finalCharge: { credits: "1.125", usage: { capability: "image", source: "actual", count: "1" }, estimated: false, capped: false, uncappedCredits: "1.125", platformLossCredits: "0" },
                saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1.125" }] },
                description: "小数结算",
                now,
            };

            const first = await settleWalletHold(input);
            const replay = await settleWalletHold(input);

            expect(first.applied).toBe(true);
            expect(replay.applied).toBe(false);
            expect(await reconcileWallet(userId)).toEqual({ userId, ledgerBalance: "1.625", settledBalance: "1.625", activeHolds: "0", availableBalance: "1.625", issues: [] });
        } finally {
            await repositories.users.delete(userId);
        }
    });

    postgresIt("upserts non-empty wallet backup rows and enforces same-user charge linkage", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `wallet-restore-${suffix}`;
        const otherUserId = `wallet-restore-other-${suffix}`;
        const now = new Date().toISOString();
        try {
            for (const [id, name] of [
                [userId, "restore"],
                [otherUserId, "restore_other"],
            ] as const)
                await repositories.users.createWithNextAccountId({
                    id,
                    username: `${name}_${suffix.replaceAll("-", "").slice(0, 12)}`,
                    displayName: "钱包恢复测试用户",
                    bio: "",
                    role: "user",
                    adminPermissions: [],
                    status: "active",
                    settledBalance: "0",
                    passwordHash: "integration-test-only",
                    createdAt: now,
                    updatedAt: now,
                });
            const hold = { id: `hold:${suffix}`, userId, businessId: `restore:${suffix}`, requestFingerprint: "e".repeat(64), amount: "1.125", status: "active" as const, description: "恢复预留", createdAt: now, updatedAt: now };
            await repositories.pointsWallet.upsertHoldForRestore(hold);
            await repositories.pointsWallet.upsertHoldForRestore({ ...hold, description: "重复恢复预留" });
            expect(await repositories.pointsWallet.getHoldById(hold.id)).toMatchObject({ description: "重复恢复预留", amount: "1.125" });

            const foreignRecord = await repositories.points.addRecord({ id: `record:${suffix}`, userId: otherUserId, type: "credit", amount: "0.5", balanceAfter: "0.5", description: "其他用户流水", createdAt: now });
            await expect(
                repositories.pointsWallet.createUsageCharge({
                    id: `charge:${suffix}`,
                    userId,
                    holdId: hold.id,
                    requestFingerprint: "f".repeat(64),
                    reservedCredits: "1.125",
                    settledCredits: "0.5",
                    normalizedUsage: { capability: "image", source: "actual", count: "1" },
                    saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.5" }] },
                    finalSaleCharge: { credits: "0.5", usage: { capability: "image", source: "actual", count: "1" }, estimated: false, capped: false, uncappedCredits: "0.5", platformLossCredits: "0" },
                    estimated: false,
                    totalProviderCostUsd: "0",
                    description: "错误跨用户关联",
                    pointRecordId: foreignRecord.id,
                    createdAt: now,
                    settledAt: now,
                }),
            ).rejects.toThrow();
        } finally {
            await repositories.users.delete(userId);
            await repositories.users.delete(otherUserId);
        }
    });

    postgresIt("serializes provider completion with settlement without dropping terminal cost", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `wallet-attempt-race-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({
                id: userId,
                username: `attempt_${suffix.replaceAll("-", "").slice(0, 12)}`,
                displayName: "尝试并发测试用户",
                bio: "",
                role: "user",
                adminPermissions: [],
                status: "active",
                settledBalance: "0",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });
            await creditWalletBalance({ userId, amount: "2", businessId: `topup:${suffix}`, description: "并发测试充值", now });
            const reservation = await reserveWalletCredits({ userId, businessId: `generation:${suffix}`, requestFingerprint: "1".repeat(64), amount: "1", description: "并发尝试预留", now });
            const pending = {
                id: `attempt:${suffix}`,
                holdId: reservation.hold.id,
                attemptNumber: 1,
                status: "pending" as const,
                provider: "vendor",
                bindingId: "binding",
                requestFingerprint: "2".repeat(64),
                nativeCostAmount: "0",
                nativeCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                now,
            };
            await recordProviderUsageAttempt(pending);
            const settlement: SettleWalletHoldInput = {
                holdId: reservation.hold.id,
                usageChargeId: `charge:${suffix}`,
                requestFingerprint: "3".repeat(64),
                finalCharge: { credits: "1", usage: { capability: "image", source: "actual", count: "1" }, estimated: false, capped: false, uncappedCredits: "1", platformLossCredits: "0" },
                saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1" }] },
                description: "并发尝试结算",
                now,
            };

            const [settlementResult, completionResult] = await Promise.allSettled([settleWalletHold(settlement), recordProviderUsageAttempt({ ...pending, status: "failed", nativeCostAmount: "0.4" })]);
            expect(completionResult.status).toBe("fulfilled");
            const finalSettlement = settlementResult.status === "fulfilled" ? settlementResult.value : await settleWalletHold(settlement);
            expect(finalSettlement.charge).toMatchObject({ settledCredits: "1", totalProviderCostUsd: "0.4" });
        } finally {
            await repositories.users.delete(userId);
        }
    });

    postgresIt("does not release a hold while a provider attempt is pending", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `wallet-release-pending-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({
                id: userId,
                username: `release_${suffix.replaceAll("-", "").slice(0, 12)}`,
                displayName: "释放并发测试用户",
                bio: "",
                role: "user",
                adminPermissions: [],
                status: "active",
                settledBalance: "0",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });
            await creditWalletBalance({ userId, amount: "2", businessId: `topup:${suffix}`, description: "释放测试充值", now });
            const reservation = await reserveWalletCredits({ userId, businessId: `generation:${suffix}`, requestFingerprint: "4".repeat(64), amount: "1", description: "释放测试预留", now });
            const pending = {
                id: `attempt:${suffix}`,
                holdId: reservation.hold.id,
                attemptNumber: 1,
                status: "pending" as const,
                provider: "vendor",
                bindingId: "binding",
                requestFingerprint: "5".repeat(64),
                nativeCostAmount: "0",
                nativeCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                now,
            };
            await recordProviderUsageAttempt(pending);

            await expect(releaseWalletHold({ holdId: reservation.hold.id, businessId: `release:${suffix}`, requestFingerprint: "6".repeat(64), reason: "任务取消", now })).rejects.toThrow("供应商尝试仍在处理中");
            await expect(recordProviderUsageAttempt({ ...pending, status: "canceled", nativeCostAmount: "0.125" })).resolves.toMatchObject({ applied: true, attempt: { status: "canceled" } });
            await expect(releaseWalletHold({ holdId: reservation.hold.id, businessId: `release:${suffix}`, requestFingerprint: "6".repeat(64), reason: "任务取消", now })).resolves.toMatchObject({ applied: true, hold: { status: "released" } });
        } finally {
            await repositories.users.delete(userId);
        }
    });
});
