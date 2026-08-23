import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emptyDb } from "@/lib/auth/store-normalizers";
import { readAuthDb, writeAuthDb } from "@/lib/auth/store-repository";

import { WalletConflictError, creditWalletBalance, getWalletSnapshot, reconcileWallet, recordProviderUsageAttempt, releaseWalletHold, reserveWalletCredits, settleWalletHold, type SettleWalletHoldInput } from "./points-wallet-service";

const previousProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const previousDataDir = process.env.VOZEB_PRO_DATA_DIR;
let dataDir = "";

beforeAll(() => {
    process.env.VOZEB_PRO_DATABASE_PROVIDER = "file";
});

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vozeb-wallet-holds-"));
    process.env.VOZEB_PRO_DATA_DIR = dataDir;
    const db = emptyDb();
    db.users.push({ id: "user-one", accountId: "0001", username: "wallet-user", displayName: "钱包用户", bio: "", role: "user", adminPermissions: [], status: "active", settledBalance: "10.5", passwordHash: "test", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" });
    db.pointRecords.push({ id: "opening-credit", userId: "user-one", type: "credit", amount: "10.5", balanceAfter: "10.5", description: "测试充值", idempotencyKey: "opening-credit", createdAt: "2026-08-23T00:00:00.000Z" });
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

describe("prepaid wallet holds", () => {
    it("credits settled balance once from a stable business identity", async () => {
        const input = { userId: "user-one", businessId: "topup:one", amount: "0.125", description: "充值" };

        const first = await creditWalletBalance(input);
        const replay = await creditWalletBalance(input);

        expect(first).toMatchObject({ applied: true, snapshot: { settledBalance: "10.625", heldBalance: "0", availableBalance: "10.625" }, record: { amount: "0.125", balanceAfter: "10.625" } });
        expect(replay).toMatchObject({ applied: false, record: { id: first.record.id } });
        expect((await readAuthDb()).pointRecords).toHaveLength(2);
    });

    it("reserves credits outside the ledger and reuses only the same fingerprint", async () => {
        const input = { userId: "user-one", businessId: "generation:one", requestFingerprint: "a".repeat(64), amount: "4.25", description: "图片生成预留" };
        const first = await reserveWalletCredits(input);
        const replay = await reserveWalletCredits(input);

        expect(first).toMatchObject({ applied: true, snapshot: { settledBalance: "10.5", heldBalance: "4.25", availableBalance: "6.25" } });
        expect(replay).toMatchObject({ applied: false, hold: { id: first.hold.id } });
        await expect(reserveWalletCredits({ ...input, requestFingerprint: "b".repeat(64) })).rejects.toBeInstanceOf(WalletConflictError);
        expect((await readAuthDb()).pointRecords).toHaveLength(1);
    });

    it("serializes concurrent reservations so they cannot over-reserve", async () => {
        const results = await Promise.allSettled([
            reserveWalletCredits({ userId: "user-one", businessId: "generation:a", requestFingerprint: "a".repeat(64), amount: "7", description: "A" }),
            reserveWalletCredits({ userId: "user-one", businessId: "generation:b", requestFingerprint: "b".repeat(64), amount: "7", description: "B" }),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(await getWalletSnapshot("user-one")).toEqual({ settledBalance: "10.5", heldBalance: "7", availableBalance: "3.5" });
    });

    it("settles a non-zero charge once, closes the hold, and creates exactly one consume record", async () => {
        const reservation = await reserveWalletCredits({ userId: "user-one", businessId: "generation:settle", requestFingerprint: "c".repeat(64), amount: "4.25", description: "视频生成预留" });
        const input: SettleWalletHoldInput = {
            holdId: reservation.hold.id,
            usageChargeId: "charge:settle",
            requestFingerprint: "d".repeat(64),
            settledCredits: "3.75",
            normalizedUsage: { capability: "video", source: "actual", count: "1", durationSeconds: "5" },
            saleRateSnapshot: { version: 1, components: [{ id: "duration", dimension: "durationSeconds", unitPrice: "0.75" }] },
            estimated: false,
            description: "视频生成结算",
        };
        const first = await settleWalletHold(input);
        const replay = await settleWalletHold(input);
        const db = await readAuthDb();

        expect(first).toMatchObject({ applied: true, snapshot: { settledBalance: "6.75", heldBalance: "0", availableBalance: "6.75" }, charge: { pointRecordId: expect.any(String) } });
        expect(replay).toMatchObject({ applied: false, charge: { id: "charge:settle" } });
        expect(db.pointRecords).toHaveLength(2);
        expect(db.pointRecords[1]).toMatchObject({ type: "consume", amount: "-3.75", balanceAfter: "6.75" });
        expect(db.walletHolds[0]).toMatchObject({ status: "settled", usageChargeId: "charge:settle" });
    });

    it("settles zero credits as an auditable usage charge without a ledger row", async () => {
        const reservation = await reserveWalletCredits({ userId: "user-one", businessId: "generation:free", requestFingerprint: "e".repeat(64), amount: "0", description: "免费文本预留" });
        await settleWalletHold({ holdId: reservation.hold.id, usageChargeId: "charge:free", requestFingerprint: "f".repeat(64), settledCredits: "0", normalizedUsage: { capability: "text", source: "actual", inputTokens: "2", outputTokens: "1" }, saleRateSnapshot: { version: 1, components: [{ id: "input", dimension: "inputTokens", unitPrice: "0" }] }, estimated: false, description: "免费文本结算" });
        const db = await readAuthDb();

        expect(await getWalletSnapshot("user-one")).toEqual({ settledBalance: "10.5", heldBalance: "0", availableBalance: "10.5" });
        expect(db.pointRecords).toHaveLength(1);
        expect(db.usageCharges).toEqual([expect.objectContaining({ id: "charge:free", settledCredits: "0" })]);
        expect(db.usageCharges[0]).not.toHaveProperty("pointRecordId");
    });

    it("releases a hold without changing the settled ledger", async () => {
        const reservation = await reserveWalletCredits({ userId: "user-one", businessId: "generation:release", requestFingerprint: "8".repeat(64), amount: "4", description: "失败任务预留" });
        const first = await releaseWalletHold({ holdId: reservation.hold.id, businessId: "release:generation", requestFingerprint: "9".repeat(64), reason: "上游确认失败" });
        const replay = await releaseWalletHold({ holdId: reservation.hold.id, businessId: "release:generation", requestFingerprint: "9".repeat(64), reason: "上游确认失败" });

        expect(first).toMatchObject({ applied: true, snapshot: { settledBalance: "10.5", heldBalance: "0", availableBalance: "10.5" } });
        expect(replay).toMatchObject({ applied: false });
        expect((await readAuthDb()).pointRecords).toHaveLength(1);
    });

    it("reconciles signed ledger balance, active holds, availability, and charge linkage", async () => {
        const reservation = await reserveWalletCredits({ userId: "user-one", businessId: "generation:reconcile", requestFingerprint: "1".repeat(64), amount: "2.125", description: "对账预留" });
        await settleWalletHold({ holdId: reservation.hold.id, usageChargeId: "charge:reconcile", requestFingerprint: "2".repeat(64), settledCredits: "1.125", normalizedUsage: { capability: "image", source: "actual", count: "1" }, saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1.125" }] }, estimated: false, description: "对账结算" });
        await reserveWalletCredits({ userId: "user-one", businessId: "generation:active", requestFingerprint: "3".repeat(64), amount: "2.25", description: "活跃预留" });

        expect(await reconcileWallet("user-one")).toEqual({ userId: "user-one", ledgerBalance: "9.375", settledBalance: "9.375", activeHolds: "2.25", availableBalance: "7.125", issues: [] });
    });

    it("preserves native and USD costs from every provider attempt, including failures", async () => {
        const reservation = await reserveWalletCredits({ userId: "user-one", businessId: "generation:attempts", requestFingerprint: "4".repeat(64), amount: "3", description: "尝试成本预留" });
        await recordProviderUsageAttempt({ id: "attempt:failed", holdId: reservation.hold.id, attemptNumber: 1, status: "failed", provider: "vendor-a", bindingId: "binding-a", requestFingerprint: "5".repeat(64), nativeCostAmount: "3", nativeCostUnit: { kind: "provider-native", provider: "vendor-a", unit: "token-block", usdConversion: { version: "2026-08", usdPerUnit: "0.125" } } });
        await recordProviderUsageAttempt({ id: "attempt:success", holdId: reservation.hold.id, attemptNumber: 2, status: "succeeded", provider: "vendor-b", bindingId: "binding-b", requestFingerprint: "6".repeat(64), nativeCostAmount: "0.2", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        const settlement = await settleWalletHold({ holdId: reservation.hold.id, usageChargeId: "charge:attempts", requestFingerprint: "7".repeat(64), settledCredits: "1", normalizedUsage: { capability: "image", source: "actual", count: "1" }, saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "1" }] }, estimated: false, description: "尝试成本结算" });

        expect(settlement.charge).toMatchObject({ totalProviderCostUsd: "0.575", marginCredits: "0.425" });
        expect((await readAuthDb()).providerUsageAttempts).toEqual([
            expect.objectContaining({ id: "attempt:failed", nativeCostAmount: "3", costUsd: "0.375", status: "failed" }),
            expect.objectContaining({ id: "attempt:success", nativeCostAmount: "0.2", costUsd: "0.2", status: "succeeded" }),
        ]);
    });
});
