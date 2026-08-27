import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emptyDb } from "@/lib/auth/store-normalizers";
import { readAuthDb, writeAuthDb } from "@/lib/auth/store-repository";
import { creditWalletBalance, reserveWalletCredits } from "@/lib/server/points-wallet-service";

import { adjustAdminPointBalance, listAdminPointLedger, searchAdminPointUsers } from "./admin-points-service";

const previousProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const previousDataDir = process.env.VOZEB_PRO_DATA_DIR;
let dataDir = "";

beforeAll(() => {
    process.env.VOZEB_PRO_DATABASE_PROVIDER = "file";
});

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vozeb-admin-points-"));
    process.env.VOZEB_PRO_DATA_DIR = dataDir;
    const db = emptyDb();
    db.users.push(
        {
            id: "admin-one",
            accountId: "9001",
            username: "finance",
            displayName: "财务管理员",
            bio: "",
            role: "admin",
            adminPermissions: ["billing.read", "billing.manage"],
            status: "active",
            settledBalance: "0",
            passwordHash: "test",
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
        },
        {
            id: "user-one",
            accountId: "0001",
            username: "creator",
            displayName: "创作者",
            bio: "",
            role: "user",
            adminPermissions: [],
            status: "active",
            settledBalance: "10.5",
            passwordHash: "test",
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:00.000Z",
        },
        {
            id: "user-two",
            accountId: "0002",
            username: "disabled-user",
            displayName: "停用用户",
            bio: "",
            role: "user",
            adminPermissions: [],
            status: "disabled",
            settledBalance: "5.25",
            passwordHash: "test",
            createdAt: "2026-08-22T00:00:00.000Z",
            updatedAt: "2026-08-22T00:00:00.000Z",
        },
    );
    db.pointRecords.push(
        { id: "opening-one", userId: "user-one", type: "credit", amount: "10.5", balanceAfter: "10.5", description: "充值", idempotencyKey: "opening-one", createdAt: "2026-08-23T00:00:00.000Z" },
        {
            id: "manual-two",
            userId: "user-two",
            operatorUserId: "admin-one",
            type: "admin-adjust",
            amount: "5.25",
            balanceAfter: "5.25",
            description: "活动补偿",
            idempotencyKey: "manual-two",
            createdAt: "2026-08-24T00:00:00.000Z",
        },
    );
    await writeAuthDb(db);
});

afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
});

afterAll(() => {
    if (previousProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
    else process.env.VOZEB_PRO_DATABASE_PROVIDER = previousProvider;
    if (previousDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
    else process.env.VOZEB_PRO_DATA_DIR = previousDataDir;
});

describe("admin points ledger", () => {
    it("applies a decimal delta once and preserves its operator and reason", async () => {
        const input = {
            actorUserId: "admin-one",
            targetUserId: "user-one",
            operation: "increase" as const,
            amount: "1.25000001",
            reason: "客服补偿",
            requestId: "adjust-request-0001",
        };

        const first = await adjustAdminPointBalance(input);
        const replay = await adjustAdminPointBalance(input);
        const db = await readAuthDb();

        expect(first).toMatchObject({
            applied: true,
            record: { type: "admin-adjust", amount: "1.25000001", balanceAfter: "11.75000001", description: "客服补偿", operatorUserId: "admin-one" },
            snapshot: { settledBalance: "11.75000001", heldBalance: "0", availableBalance: "11.75000001" },
        });
        expect(replay).toMatchObject({ applied: false, record: { id: first.record.id } });
        expect(db.pointRecords.filter((record) => record.idempotencyKey === "admin-adjust:adjust-request-0001")).toHaveLength(1);
    });

    it("rejects an idempotency replay whose adjustment payload changed", async () => {
        const input = { actorUserId: "admin-one", targetUserId: "user-one", operation: "increase" as const, amount: "1.25", reason: "补偿", requestId: "adjust-request-0002" };
        await adjustAdminPointBalance(input);

        await expect(adjustAdminPointBalance({ ...input, amount: "2.5" })).rejects.toThrow("请求参数不一致");
    });

    it("serializes concurrent submissions with the same request ID", async () => {
        const input = { actorUserId: "admin-one", targetUserId: "user-one", operation: "increase" as const, amount: "2.5", reason: "并发补偿", requestId: "adjust-request-concurrent" };

        const results = await Promise.all([adjustAdminPointBalance(input), adjustAdminPointBalance(input)]);
        const db = await readAuthDb();

        expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
        expect(db.users.find((user) => user.id === "user-one")?.settledBalance).toBe("13");
        expect(db.pointRecords.filter((record) => record.idempotencyKey === "admin-adjust:adjust-request-concurrent")).toHaveLength(1);
    });

    it("returns the current wallet snapshot when an old adjustment is replayed", async () => {
        const input = { actorUserId: "admin-one", targetUserId: "user-one", operation: "increase" as const, amount: "4.5", reason: "补偿", requestId: "adjust-request-replay" };
        await adjustAdminPointBalance(input);
        await creditWalletBalance({ userId: "user-one", businessId: "topup:after-adjustment", amount: "10", description: "后续充值" });
        await reserveWalletCredits({ userId: "user-one", businessId: "generation:after-adjustment", requestFingerprint: "b".repeat(64), amount: "20", description: "后续预留" });

        await expect(adjustAdminPointBalance(input)).resolves.toMatchObject({ applied: false, snapshot: { settledBalance: "25", heldBalance: "20", availableBalance: "5" } });
    });

    it("rejects a deduction that would make settled balance lower than active holds", async () => {
        await reserveWalletCredits({ userId: "user-one", businessId: "generation:held", requestFingerprint: "a".repeat(64), amount: "8", description: "生成预留" });

        await expect(adjustAdminPointBalance({ actorUserId: "admin-one", targetUserId: "user-one", operation: "decrease", amount: "3", reason: "冲正", requestId: "adjust-request-0003" })).rejects.toThrow("扣减后结算余额不能低于当前预留积分");
        expect((await readAuthDb()).users.find((user) => user.id === "user-one")?.settledBalance).toBe("10.5");
    });

    it("rejects a deduction larger than the settled balance", async () => {
        await expect(adjustAdminPointBalance({ actorUserId: "admin-one", targetUserId: "user-one", operation: "decrease", amount: "10.50000001", reason: "超额冲正", requestId: "adjust-request-overdraw" })).rejects.toThrow(
            "扣减后结算余额不能低于当前预留积分",
        );
        expect((await readAuthDb()).pointRecords.some((record) => record.idempotencyKey === "admin-adjust:adjust-request-overdraw")).toBe(false);
    });

    it("allows an administrator to adjust a disabled account", async () => {
        await expect(adjustAdminPointBalance({ actorUserId: "admin-one", targetUserId: "user-two", operation: "increase", amount: "0.75", reason: "停用前冲正", requestId: "adjust-request-disabled" })).resolves.toMatchObject({
            applied: true,
            snapshot: { settledBalance: "6", availableBalance: "6" },
        });
    });

    it("rejects an amount with more than eight decimal places", async () => {
        await expect(adjustAdminPointBalance({ actorUserId: "admin-one", targetUserId: "user-one", operation: "increase", amount: "0.123456789", reason: "精度错误", requestId: "adjust-request-precision" })).rejects.toThrow("调整积分最多保留 8 位小数");
    });

    it("lists filtered records with public user identities and global wallet totals", async () => {
        const result = await listAdminPointLedger({ page: 1, pageSize: 20, type: "admin-adjust", direction: "credit", startAt: "2026-08-24T00:00:00.000Z", endBefore: "2026-08-25T00:00:00.000Z" });

        expect(result).toMatchObject({
            total: 1,
            page: 1,
            pageSize: 20,
            summary: { settledBalance: "15.75", heldBalance: "0", availableBalance: "15.75", recordCount: 2 },
            items: [
                {
                    id: "manual-two",
                    amount: "5.25",
                    user: { accountId: "0002", username: "disabled-user", displayName: "停用用户", status: "disabled" },
                    operator: { accountId: "9001", username: "finance", displayName: "财务管理员" },
                },
            ],
        });
        expect(JSON.stringify(result)).not.toContain("user-two");
        expect(JSON.stringify(result)).not.toContain("admin-one");
    });

    it("searches finance-scoped users by public account ID", async () => {
        const result = await searchAdminPointUsers({ keyword: "0001", page: 1, pageSize: 20 });

        expect(result).toMatchObject({ total: 1, users: [{ accountId: "0001", username: "creator", displayName: "创作者", settledBalance: "10.5", heldBalance: "0", availableBalance: "10.5" }] });
        expect(result.users[0]).not.toHaveProperty("id");
    });
});
