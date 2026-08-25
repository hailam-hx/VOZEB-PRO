import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { adjustWalletBalanceInPostgresTransaction } from "@/lib/server/points-wallet-service";
import { getWalletSnapshot, reserveWalletCredits } from "@/lib/server/points-wallet-service";
import { updateUserByAdmin } from "@/lib/auth/store";
import { decimal } from "@/lib/billing/decimal";

import { createPostgresRepositories, ensurePostgresSchema, withPostgresTransaction } from "./index";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("PostgreSQL auth entity concurrency", () => {
    postgresIt("preserves profile, balance, point record and session across concurrent writes", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `test-concurrency-user-${suffix}`;
        const sessionId = `test-concurrency-session-${suffix}`;
        const idempotencyKey = `test-concurrency-points-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({
                id: userId,
                username: `concurrency_${suffix.replaceAll("-", "").slice(0, 16)}`,
                displayName: "并发测试用户",
                bio: "",
                role: "user",
                adminPermissions: [],
                status: "active",
                settledBalance: "100",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });
            await repositories.sessions.create({
                id: sessionId,
                userId,
                tokenHash: `test-token-${suffix}`,
                createdAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + 60_000).toISOString(),
            });

            await Promise.all([
                withPostgresTransaction(async (client) => {
                    const users = createPostgresRepositories(client).users;
                    const user = await users.getById(userId, true);
                    if (!user) throw new Error("Temporary concurrency user disappeared");
                    await users.update(userId, { displayName: "资料更新已保留" });
                }),
                withPostgresTransaction((client) =>
                    adjustWalletBalanceInPostgresTransaction(client, {
                        userId,
                        amount: "25",
                        description: "并发积分测试",
                        idempotencyKey,
                        type: "admin-adjust",
                        now,
                    }),
                ),
            ]);

            const [user, session, pointRecord] = await Promise.all([repositories.users.getById(userId), repositories.sessions.getByTokenHash(`test-token-${suffix}`), repositories.points.getRecordByIdempotencyKey(idempotencyKey)]);
            expect(user).toMatchObject({ displayName: "资料更新已保留", settledBalance: "125" });
            expect(session).toMatchObject({ id: sessionId, userId });
            expect(pointRecord).toMatchObject({ userId, amount: "25", balanceAfter: "125" });
        } finally {
            await repositories.users.delete(userId);
        }
    });

    postgresIt("serializes administrator balance edits with reservations and preserves nonnegative availability", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const actorId = `test-balance-admin-${suffix}`;
        const userId = `test-balance-user-${suffix}`;
        const now = new Date();
        try {
            await repositories.users.createWithNextAccountId({
                id: actorId,
                username: `balance_admin_${suffix.replaceAll("-", "").slice(0, 12)}`,
                displayName: "余额管理员",
                bio: "",
                role: "admin",
                adminPermissions: ["users.manage", "billing.manage"],
                status: "active",
                settledBalance: "0",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });
            await repositories.users.createWithNextAccountId({
                id: userId,
                username: `balance_user_${suffix.replaceAll("-", "").slice(0, 12)}`,
                displayName: "余额并发用户",
                bio: "",
                role: "user",
                adminPermissions: [],
                status: "active",
                settledBalance: "10",
                passwordHash: "integration-test-only",
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            });

            const outcomes = await Promise.allSettled([
                updateUserByAdmin(actorId, userId, { settledBalance: "6" }),
                reserveWalletCredits({ userId, businessId: `generation:${suffix}`, requestFingerprint: "b".repeat(64), amount: "8", description: "并发预留", now }),
            ]);

            expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
            expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
            expect(decimal((await getWalletSnapshot(userId)).availableBalance).isNegative()).toBe(false);
        } finally {
            await repositories.users.delete(userId);
            await repositories.users.delete(actorId);
        }
    });
});
