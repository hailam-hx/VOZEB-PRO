import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeBillableUsage } from "@/lib/billing/pricing";
import { emptyDb } from "@/lib/auth/store-normalizers";
import { readAuthDb, writeAuthDb } from "@/lib/auth/store-repository";

import {
    attachUsageProviderUpstreamTaskId,
    recoverOrphanUsageHolds,
    finishUsageProviderAttempt,
    loadUsageBilling,
    recordUsageProviderAttempt,
    releaseUsageBilling,
    reserveUsageBilling,
    reserveOrReuseUsageBilling,
    settleCancelledUsageBilling,
    settleUsageBilling,
} from "./usage-billing-runtime";

const previousProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const previousDataDir = process.env.VOZEB_PRO_DATA_DIR;
let dataDir = "";

const imageSale = { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "1.5" }] };
const imageRequest = normalizeBillableUsage({ capability: "image", source: "request", count: 1 });

beforeAll(() => {
    process.env.VOZEB_PRO_DATABASE_PROVIDER = "file";
});

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vozeb-usage-runtime-"));
    process.env.VOZEB_PRO_DATA_DIR = dataDir;
    const db = emptyDb();
    db.users.push({
        id: "user-one",
        accountId: "0001",
        username: "runtime-user",
        displayName: "运行时用户",
        bio: "",
        role: "user",
        adminPermissions: [],
        status: "active",
        settledBalance: "10",
        passwordHash: "test",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
    });
    db.pointRecords.push({ id: "opening-credit", userId: "user-one", type: "credit", amount: "10", balanceAfter: "10", description: "测试充值", idempotencyKey: "opening-credit", createdAt: "2026-08-23T00:00:00.000Z" });
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

describe("usage billing runtime", () => {
    it("sums failed and successful provider costs while charging once from the frozen sale snapshot", async () => {
        const billing = await reservation("failover");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "failed",
            provider: "vendor-a",
            bindingId: "binding-a",
            nativeCostAmount: "2",
            nativeCostUnit: { kind: "provider-native", provider: "vendor-a", unit: "job", usdConversion: { version: "fx-old", usdPerUnit: "0.125" } },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2" }] },
            normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }),
        });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 2,
            status: "succeeded",
            provider: "vendor-b",
            bindingId: "binding-b",
            nativeCostAmount: "0.2",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.2" }] },
            normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }),
        });

        const settled = await settleUsageBilling({ billing, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "图片生成结算" });
        const db = await readAuthDb();

        expect(settled.charge).toMatchObject({
            settledCredits: "1.5",
            totalProviderCostUsd: "0.45",
            runtimeSnapshot: { logicalModelId: "image-pro", saleRateSnapshot: imageSale, reserve: { credits: "1.5" }, reservedCredits: "1.5" },
            finalSaleCharge: { usage: { source: "actual" }, estimated: false },
        });
        expect(db.pointRecords.filter((record) => record.type === "consume")).toHaveLength(1);
        expect(db.providerUsageAttempts.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
    });

    it("ignores sale and FX edits made after reserve", async () => {
        const billing = await reservation("immutable");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "succeeded",
            provider: "vendor",
            bindingId: "binding",
            nativeCostAmount: "2",
            nativeCostUnit: { kind: "provider-native", provider: "vendor", unit: "job", usdConversion: { version: "fx-old", usdPerUnit: "0.125" } },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2" }] },
        });

        const settled = await settleUsageBilling({
            billing,
            actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }),
            description: "冻结快照结算",
        });

        expect(settled.charge).toMatchObject({ settledCredits: "1.5", totalProviderCostUsd: "0.25", saleRateSnapshot: imageSale });
        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({ usdConversionRate: "0.125", nativeCostUnit: { usdConversion: { version: "fx-old" } } });
    });

    it("selects actual, derived, then reserve fallback usage markers", async () => {
        const actual = await reservation("actual");
        await settleUsageBilling({ billing: actual, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "actual" });
        const derived = await reservation("derived");
        await settleUsageBilling({ billing: derived, derivedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }), description: "derived" });
        const fallback = await reservation("fallback");
        await settleUsageBilling({ billing: fallback, description: "fallback" });

        expect((await readAuthDb()).usageCharges.map((charge) => ({ source: charge.normalizedUsage.source, estimated: charge.estimated }))).toEqual([
            { source: "actual", estimated: false },
            { source: "derived", estimated: false },
            { source: "reserve", estimated: true },
        ]);
    });

    it("releases provider failures but charges a user cancellation after accepted work", async () => {
        const failed = await reservation("failed");
        await recordUsageProviderAttempt({ billing: failed, attemptNumber: 1, status: "failed", provider: "vendor", bindingId: "binding", nativeCostAmount: "0.3", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await releaseUsageBilling({ billing: failed, reason: "供应商确认失败" });

        const cancelled = await reservation("cancelled");
        await recordUsageProviderAttempt({ billing: cancelled, attemptNumber: 1, status: "canceled", provider: "vendor", bindingId: "binding", upstreamTaskId: "upstream-one", nativeCostAmount: "0.4", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await settleCancelledUsageBilling({ billing: cancelled, description: "用户取消已接受任务" });

        const db = await readAuthDb();
        expect(db.walletHolds.map((hold) => hold.status)).toEqual(["released", "settled"]);
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1.5", estimated: true, totalProviderCostUsd: "0.4" })]);
    });

    it("settles a free success as an auditable usage charge without a point record", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "runtime:free",
            requestFingerprint: "f".repeat(64),
            logicalModelId: "free-image",
            saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0" }] },
            requestUsage: imageRequest,
            description: "免费图片预留",
        });

        await settleUsageBilling({ billing, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "免费图片结算" });
        const db = await readAuthDb();

        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "0" })]);
        expect(db.pointRecords).toEqual([expect.objectContaining({ id: "opening-credit" })]);
    });

    it("finishes a persisted pending attempt from its frozen cost snapshot", async () => {
        const billing = await reservation("pending-finish");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencyKey: "task:attempt:1",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
        });

        const reloaded = await loadUsageBilling(billing.holdId);
        await finishUsageProviderAttempt({ billing: reloaded, attemptNumber: 1, status: "succeeded", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) });
        await settleUsageBilling({ billing: reloaded, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "pending" });

        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({ status: "succeeded", nativeCostAmount: "0.375", costUsd: "0.375", upstreamTaskId: "upstream-one" });
    });

    it("freezes business identity and provider idempotency capability in audit snapshots", async () => {
        const billing = await reservation("audit-identities");
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "vendor", bindingId: "binding", providerIdempotencySupported: true, providerIdempotencyKey: "task:attempt:1", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        const db = await readAuthDb();

        expect(db.walletHolds[0].runtimeSnapshot).toMatchObject({ businessId: "runtime:audit-identities", originalRequestFingerprint: createHash("sha256").update("audit-identities").digest("hex") });
        expect(db.providerUsageAttempts[0]).toMatchObject({ providerIdempotencySupported: true });
    });

    it("retains failed-attempt cost evidence and sums it with the successful failover", async () => {
        const billing = await reservation("failover-cost");
        const costRateSnapshot = { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "0.25" }] };
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "primary", bindingId: "primary", providerIdempotencySupported: false, nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" }, costRateSnapshot });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }) });
        await recordUsageProviderAttempt({ billing, attemptNumber: 2, status: "pending", provider: "backup", bindingId: "backup", providerIdempotencySupported: true, providerIdempotencyKey: "backup:2", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" }, costRateSnapshot });
        await finishUsageProviderAttempt({ billing, attemptNumber: 2, status: "succeeded", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) });
        await settleUsageBilling({ billing, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "failover" });

        expect((await readAuthDb()).usageCharges[0]).toMatchObject({ settledCredits: "1.5", totalProviderCostUsd: "0.5" });
    });

    it("reuses the first sale snapshot when pricing changes between failover attempts", async () => {
        const first = await reservation("pricing-failover");
        const second = await reserveOrReuseUsageBilling({ userId: first.userId, businessId: first.businessId, requestFingerprint: first.requestFingerprint, logicalModelId: "image-pro", saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "99" }] }, requestUsage: imageRequest, description: "edited price" });

        expect(second.holdId).toBe(first.holdId);
        expect(second.snapshot.saleRateSnapshot).toEqual(imageSale);
        expect(second.snapshot.reservedCredits).toBe("1.5");
    });

    it("binds a persisted upstream task identity once without settling the async attempt", async () => {
        const billing = await reservation("attach-upstream");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencyKey: "task:attempt:1",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        });

        await attachUsageProviderUpstreamTaskId({ holdId: billing.holdId, attemptNumber: 1, upstreamTaskId: "upstream-one" });
        await attachUsageProviderUpstreamTaskId({ holdId: billing.holdId, attemptNumber: 1, upstreamTaskId: "upstream-one" });

        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({ status: "pending", upstreamTaskId: "upstream-one" });
        await expect(attachUsageProviderUpstreamTaskId({ holdId: billing.holdId, attemptNumber: 1, upstreamTaskId: "changed" })).rejects.toThrow("参数不一致");
    });

    it("rejects provider identity and cost snapshot edits while an attempt is completing", async () => {
        const billing = await reservation("attempt-immutable");
        const pending = {
            billing,
            attemptNumber: 1,
            status: "pending" as const,
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencyKey: "task:attempt:1",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat" as const, currency: "USD" as const },
            costRateSnapshot: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        };
        await recordUsageProviderAttempt(pending);

        await expect(recordUsageProviderAttempt({ ...pending, status: "succeeded", providerIdempotencyKey: "changed-key", nativeCostAmount: "0.375" })).rejects.toThrow("参数不一致");
        await expect(recordUsageProviderAttempt({ ...pending, status: "succeeded", costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "99" }] }, nativeCostAmount: "99" })).rejects.toThrow("参数不一致");
    });
});

describe("orphan usage recovery", () => {
    it("retains unknown holds and marks them for review", async () => {
        await reservation("unknown", new Date("2026-08-23T00:00:00.000Z"));

        const result = await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "供应商状态未知" })) });
        const hold = (await readAuthDb()).walletHolds[0];

        expect(result).toMatchObject({ inspected: 1, needsReview: 1, settled: 0, released: 0 });
        expect(hold).toMatchObject({ status: "active", reviewReason: "供应商状态未知" });
    });

    it("advances bounded recovery past an already reviewed unknown hold", async () => {
        await reservation("reviewed-first", new Date("2026-08-23T00:00:00.000Z"));
        await reservation("later", new Date("2026-08-23T00:01:00.000Z"));
        const now = new Date("2026-08-23T01:00:00.000Z");
        await recoverOrphanUsageHolds({ limit: 1, now, inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "人工复核" })) });
        const inspect = vi.fn(async () => ({ state: "failed" as const, reason: "确认失败" }));
        await recoverOrphanUsageHolds({ limit: 1, now, inspect });

        expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ businessId: "runtime:later" }));
    });

    it("releases confirmed failures and settles confirmed successes from snapshots", async () => {
        await reservation("orphan-failure", new Date("2026-08-23T00:00:00.000Z"));
        await reservation("orphan-success", new Date("2026-08-23T00:00:00.000Z"));
        const inspect = vi.fn(async (hold: { businessId: string }) =>
            hold.businessId.endsWith("failure") ? { state: "failed" as const, reason: "上游确认失败" } : { state: "succeeded" as const, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) },
        );

        const result = await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect });
        const db = await readAuthDb();

        expect(result).toMatchObject({ inspected: 2, released: 1, settled: 1, needsReview: 0 });
        expect(db.walletHolds.map((hold) => hold.status)).toEqual(["released", "settled"]);
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1.5", estimated: false })]);
    });

    it("finishes a recovered successful attempt with its frozen provider cost rate", async () => {
        const billing = await reservation("orphan-provider-cost", new Date("2026-08-23T00:00:00.000Z"));
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        });

        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect: vi.fn(async () => ({ state: "succeeded" as const, derivedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }) })) });
        const db = await readAuthDb();

        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "succeeded", nativeCostAmount: "0.375", costUsd: "0.375" });
        expect(db.usageCharges[0]).toMatchObject({ totalProviderCostUsd: "0.375" });
    });

    it("does not recreate or double-settle work when recovery is replayed", async () => {
        await reservation("replay", new Date("2026-08-23T00:00:00.000Z"));
        const inspect = vi.fn(async () => ({ state: "succeeded" as const, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) }));

        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect });
        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T02:00:00.000Z"), inspect });

        expect(inspect).toHaveBeenCalledTimes(1);
        expect((await readAuthDb()).usageCharges).toHaveLength(1);
    });
});

async function reservation(name: string, expiresAt?: Date) {
    return reserveUsageBilling({
        userId: "user-one",
        businessId: `runtime:${name}`,
        requestFingerprint: createHash("sha256").update(name).digest("hex"),
        logicalModelId: "image-pro",
        saleRateSnapshot: imageSale,
        requestUsage: imageRequest,
        description: "图片生成预留",
        expiresAt,
        recovery: { taskType: "image", taskId: `task-${name}` },
    });
}
