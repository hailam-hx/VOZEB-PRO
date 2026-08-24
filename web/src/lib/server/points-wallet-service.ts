import { randomUUID } from "node:crypto";

import { decimal, type DecimalInput, type ExactDecimal } from "@/lib/billing/decimal";
import { convertProviderCostToUsd, validateProviderCostUnit, type ProviderCostUnit } from "@/lib/billing/money";
import { calculateFinalSaleCharge, type FinalSaleCharge, type NormalizedUsage, type PricingRateCardV1 } from "@/lib/billing/pricing";
import { AuthInputError, QuotaExceededError } from "@/lib/auth/store-foundation";
import { mutateAuthDb } from "@/lib/auth/store-repository";
import type { AuthDatabase, ProviderUsageAttempt, ProviderUsageAttemptStatus, StoredPointRecord, UsageBillingHoldSnapshot, UsageCharge, WalletHold } from "@/lib/auth/store-types";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, withPostgresTransaction } from "@/lib/server/database";

export type WalletSnapshot = {
    settledBalance: string;
    heldBalance: string;
    availableBalance: string;
};

export type ReserveWalletCreditsInput = {
    userId: string;
    businessId: string;
    requestFingerprint: string;
    providerIdempotencySupported?: boolean;
    amount: DecimalInput;
    description: string;
    runtimeSnapshot?: UsageBillingHoldSnapshot;
    expiresAt?: Date;
    now?: Date;
};

export type SettleWalletHoldInput = {
    holdId: string;
    usageChargeId: string;
    requestFingerprint: string;
    finalCharge: FinalSaleCharge;
    saleRateSnapshot: PricingRateCardV1;
    description: string;
    now?: Date;
};

export type RecordProviderUsageAttemptInput = {
    id: string;
    holdId: string;
    attemptNumber: number;
    status: ProviderUsageAttemptStatus;
    provider: string;
    bindingId: string;
    requestFingerprint: string;
    providerIdempotencySupported?: boolean;
    providerIdempotencyKey?: string;
    upstreamTaskId?: string;
    nativeCostAmount: DecimalInput;
    nativeCostUnit: ProviderCostUnit;
    costRateSnapshot?: PricingRateCardV1;
    normalizedUsage?: NormalizedUsage;
    observedUsage?: NormalizedUsage;
    now?: Date;
};

export type CreditWalletBalanceInput = {
    userId: string;
    businessId: string;
    amount: DecimalInput;
    description: string;
    type?: "credit" | "refund" | "admin-adjust";
    sourceRecordId?: string;
    now?: Date;
};

export async function adjustWalletBalanceInPostgresTransaction(
    client: import("@/lib/server/database").QueryExecutor,
    input: { userId: string; amount: DecimalInput; description: string; idempotencyKey: string; type: "credit" | "admin-adjust"; now?: Date },
) {
    const amount = decimal(input.amount);
    const repos = createPostgresRepositories(client);
    const existing = await repos.points.getRecordByIdempotencyKey(input.idempotencyKey);
    if (existing) return { record: existing };
    const user = await repos.users.getById(input.userId, true);
    if (!user) throw new AuthInputError("用户不存在");
    const next = decimal(user.settledBalance).plus(amount);
    if (next.isNegative()) throw new QuotaExceededError("钱包余额不足");
    await repos.users.update(user.id, { settledBalance: next.toString() });
    const record = await repos.points.addRecord({
        id: randomUUID(),
        userId: user.id,
        type: input.type,
        amount: amount.toString(),
        balanceAfter: next.toString(),
        description: requiredText(input.description, "钱包调整缺少说明"),
        idempotencyKey: requiredText(input.idempotencyKey, "钱包调整缺少业务 ID"),
        createdAt: (input.now || new Date()).toISOString(),
    });
    return { record };
}

export type ReleaseWalletHoldInput = { holdId: string; businessId: string; requestFingerprint: string; reason: string; now?: Date };

export type WalletReconciliationReport = {
    userId: string;
    ledgerBalance: string;
    settledBalance: string;
    activeHolds: string;
    availableBalance: string;
    issues: string[];
};

export class WalletConflictError extends AuthInputError {
    status = 409;
}

export async function getWalletSnapshot(userId: string): Promise<WalletSnapshot> {
    if (isPostgresDatabaseEnabled()) return getPostgresWalletSnapshot(userId);
    return mutateAuthDb((db) => snapshotFileWallet(db, userId));
}

export async function getWalletHoldById(holdId: string) {
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return createPostgresRepositories().pointsWallet.getHoldById(holdId);
    }
    return mutateAuthDb((db) => db.walletHolds.find((hold) => hold.id === holdId) || null);
}

export async function getWalletHoldByBusinessId(businessId: string) {
    const normalized = requiredText(businessId, "钱包预留缺少业务 ID");
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return createPostgresRepositories().pointsWallet.getHoldByBusinessId(normalized);
    }
    return mutateAuthDb((db) => db.walletHolds.find((hold) => hold.businessId === normalized) || null);
}

export async function listExpiredActiveWalletHolds(input: { now: Date; limit: number }) {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new AuthInputError("钱包恢复批次无效");
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return createPostgresRepositories().pointsWallet.listExpiredActiveHolds(input.now.toISOString(), input.limit);
    }
    return mutateAuthDb((db) =>
        db.walletHolds
            .filter((hold) => hold.status === "active" && !hold.reviewReason && hold.expiresAt && Date.parse(hold.expiresAt) <= input.now.getTime())
            .sort((left, right) => String(left.recoveryCheckedAt || left.expiresAt).localeCompare(String(right.recoveryCheckedAt || right.expiresAt)) || left.id.localeCompare(right.id))
            .slice(0, input.limit)
            .map((hold) => {
                hold.recoveryCheckedAt = input.now.toISOString();
                hold.updatedAt = input.now.toISOString();
                return hold;
            }),
    );
}

export async function listProviderUsageAttemptsForHold(holdId: string) {
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return createPostgresRepositories().pointsWallet.listProviderAttemptsForHold(holdId);
    }
    return mutateAuthDb((db) => db.providerUsageAttempts.filter((attempt) => attempt.holdId === holdId).sort((left, right) => left.attemptNumber - right.attemptNumber));
}

export async function markWalletHoldNeedsReview(input: { holdId: string; reason: string; now?: Date }) {
    const reason = requiredText(input.reason, "人工复核原因不能为空").slice(0, 500);
    const now = input.now || new Date();
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const hold = await createPostgresRepositories().pointsWallet.markHoldNeedsReview(input.holdId, reason, now.toISOString());
        if (!hold) throw new AuthInputError("钱包预留不存在或已经关闭");
        return hold;
    }
    return mutateAuthDb((db) => {
        const hold = db.walletHolds.find((item) => item.id === input.holdId && item.status === "active");
        if (!hold) throw new AuthInputError("钱包预留不存在或已经关闭");
        hold.reviewReason = reason;
        hold.updatedAt = now.toISOString();
        return hold;
    });
}

export async function creditWalletBalance(input: CreditWalletBalanceInput) {
    const amount = creditAmount(input.amount, "入账积分");
    if (amount.isZero()) throw new AuthInputError("入账积分必须大于零");
    const businessId = requiredText(input.businessId, "余额入账缺少业务 ID");
    if (isPostgresDatabaseEnabled()) return creditPostgresWallet({ ...input, businessId, amount } as Omit<CreditWalletBalanceInput, "amount"> & { amount: ExactDecimal });
    return mutateAuthDb((db) => {
        const user = activeFileUser(db, input.userId) as (typeof db.users)[number] & { settledBalance?: string };
        const existing = db.pointRecords.find((record) => record.idempotencyKey === businessId);
        if (existing) {
            assertMatchingCredit(existing, input.userId, amount.toString(), input.type || "credit");
            return { record: existing, snapshot: snapshotFileWallet(db, input.userId), applied: false };
        }
        const now = input.now || new Date();
        const nextBalance = settledBalance(db, input.userId).plus(amount);
        const record = {
            id: randomUUID(),
            userId: input.userId,
            type: input.type || "credit",
            amount: amount.toString(),
            balanceAfter: nextBalance.toString(),
            description: requiredText(input.description, "余额入账缺少说明"),
            idempotencyKey: businessId,
            sourceRecordId: input.sourceRecordId,
            createdAt: now.toISOString(),
        } as StoredPointRecord;
        user.settledBalance = nextBalance.toString();
        user.updatedAt = now.toISOString();
        db.pointRecords.push(record);
        return { record, snapshot: snapshotFileWallet(db, input.userId), applied: true };
    });
}

export async function reserveWalletCredits(input: ReserveWalletCreditsInput) {
    const amount = creditAmount(input.amount, "预留积分");
    const businessId = requiredText(input.businessId, "钱包预留缺少业务 ID");
    const requestFingerprint = fingerprint(input.requestFingerprint);
    if (isPostgresDatabaseEnabled()) return reservePostgresWallet({ ...input, amount, businessId, requestFingerprint } as Omit<ReserveWalletCreditsInput, "amount"> & { amount: ExactDecimal; businessId: string; requestFingerprint: string });
    return mutateAuthDb((db) => {
        const user = activeFileUser(db, input.userId);
        const existing = db.walletHolds.find((hold) => hold.businessId === businessId);
        if (existing) {
            if (existing.userId !== user.id || existing.requestFingerprint !== requestFingerprint || existing.amount !== amount.toString() || !sameRuntimeSnapshot(existing.runtimeSnapshot, input.runtimeSnapshot))
                throw new WalletConflictError("钱包预留业务 ID 对应的请求参数不一致");
            return { hold: existing, snapshot: snapshotFileWallet(db, user.id), applied: false };
        }
        const before = snapshotFileWallet(db, user.id);
        if (amount.greaterThan(decimal(before.availableBalance))) throw new QuotaExceededError("可用积分不足");
        const now = input.now || new Date();
        const hold: WalletHold = {
            id: randomUUID(),
            userId: user.id,
            businessId,
            requestFingerprint,
            amount: amount.toString(),
            status: "active",
            description: requiredText(input.description, "钱包预留缺少说明"),
            runtimeSnapshot: input.runtimeSnapshot,
            expiresAt: input.expiresAt?.toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
        db.walletHolds.push(hold);
        return { hold, snapshot: snapshotFileWallet(db, user.id), applied: true };
    });
}

export async function settleWalletHold(input: SettleWalletHoldInput) {
    const usageChargeId = requiredText(input.usageChargeId, "用量账单缺少业务 ID");
    const requestFingerprint = fingerprint(input.requestFingerprint);
    if (isPostgresDatabaseEnabled()) return settlePostgresHold({ ...input, usageChargeId, requestFingerprint });
    return mutateAuthDb((db) => {
        const existing = db.usageCharges.find((charge) => charge.id === usageChargeId);
        if (existing) {
            assertMatchingSettlement(existing, input.holdId, requestFingerprint, input.saleRateSnapshot, input.finalCharge);
            return { charge: existing, record: existing.pointRecordId ? db.pointRecords.find((record) => record.id === existing.pointRecordId) : undefined, snapshot: snapshotFileWallet(db, existing.userId), applied: false };
        }
        const hold = db.walletHolds.find((item) => item.id === input.holdId);
        if (!hold) throw new AuthInputError("钱包预留不存在");
        activeFileUser(db, hold.userId);
        if (hold.status !== "active") throw new WalletConflictError("钱包预留已经关闭");
        if (db.providerUsageAttempts.some((attempt) => attempt.holdId === hold.id && attempt.status === "pending")) throw new WalletConflictError("供应商尝试仍在处理中");
        const finalCharge = validatedFinalCharge(input.saleRateSnapshot, hold.amount, input.finalCharge);
        const settledCredits = creditAmount(finalCharge.credits, "结算积分");
        if (settledCredits.greaterThan(decimal(hold.amount))) throw new AuthInputError("结算积分不能超过预留积分");
        const currentBalance = settledBalance(db, hold.userId);
        if (settledCredits.greaterThan(currentBalance)) throw new QuotaExceededError("结算余额不足");
        const now = input.now || new Date();
        const nextBalance = currentBalance.minus(settledCredits);
        const totalProviderCostUsd = sum(db.providerUsageAttempts.filter((attempt) => attempt.holdId === hold.id).map((attempt) => attempt.costUsd));
        let record: StoredPointRecord | undefined;
        if (!settledCredits.isZero()) {
            record = {
                id: randomUUID(),
                userId: hold.userId,
                type: "consume",
                amount: `-${settledCredits.toString()}`,
                balanceAfter: nextBalance.toString(),
                description: requiredText(input.description, "用量账单缺少说明"),
                idempotencyKey: usageChargeId,
                requestFingerprint,
                createdAt: now.toISOString(),
            } as StoredPointRecord;
            db.pointRecords.push(record);
        }
        const charge: UsageCharge = {
            id: usageChargeId,
            userId: hold.userId,
            holdId: hold.id,
            requestFingerprint,
            reservedCredits: hold.amount,
            settledCredits: settledCredits.toString(),
            normalizedUsage: finalCharge.usage,
            finalSaleCharge: finalCharge,
            saleRateSnapshot: input.saleRateSnapshot,
            runtimeSnapshot: hold.runtimeSnapshot,
            estimated: finalCharge.estimated,
            totalProviderCostUsd: totalProviderCostUsd.toString(),
            description: requiredText(input.description, "用量账单缺少说明"),
            pointRecordId: record?.id,
            createdAt: now.toISOString(),
            settledAt: now.toISOString(),
        };
        db.usageCharges.push(charge);
        hold.status = "settled";
        hold.usageChargeId = charge.id;
        hold.closedAt = now.toISOString();
        hold.updatedAt = now.toISOString();
        const user = db.users.find((item) => item.id === hold.userId)! as (typeof db.users)[number] & { settledBalance?: string };
        user.settledBalance = nextBalance.toString();
        user.updatedAt = now.toISOString();
        return { charge, record, snapshot: snapshotFileWallet(db, hold.userId), applied: true };
    });
}

export async function releaseWalletHold(input: ReleaseWalletHoldInput) {
    const businessId = requiredText(input.businessId, "释放预留缺少业务 ID");
    const requestFingerprint = fingerprint(input.requestFingerprint);
    const reason = requiredText(input.reason, "释放预留缺少原因");
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const repos = createPostgresRepositories(client);
            const initial = await repos.pointsWallet.getHoldById(input.holdId);
            if (!initial) throw new AuthInputError("钱包预留不存在");
            const user = await repos.users.getById(initial.userId, true);
            if (!user) throw new AuthInputError("用户不存在");
            const hold = await repos.pointsWallet.getHoldById(input.holdId, true);
            if (!hold) throw new AuthInputError("钱包预留不存在");
            if (hold.status === "released") {
                assertMatchingRelease(hold, businessId, requestFingerprint, reason);
                return { hold, snapshot: postgresSnapshot(user.settledBalance, await repos.pointsWallet.getActiveHeldBalance(user.id)), applied: false };
            }
            if (hold.status !== "active") throw new WalletConflictError("钱包预留已经结算");
            if (await repos.pointsWallet.hasPendingProviderAttempts(hold.id)) throw new WalletConflictError("供应商尝试仍在处理中");
            const closed = await repos.pointsWallet.closeHold(hold.id, { status: "released", releaseBusinessId: businessId, releaseRequestFingerprint: requestFingerprint, releaseReason: reason, closedAt: (input.now || new Date()).toISOString() });
            return { hold: closed!, snapshot: postgresSnapshot(user.settledBalance, await repos.pointsWallet.getActiveHeldBalance(user.id)), applied: true };
        });
    }
    return mutateAuthDb((db) => {
        const hold = db.walletHolds.find((item) => item.id === input.holdId);
        if (!hold) throw new AuthInputError("钱包预留不存在");
        if (hold.status === "released") {
            assertMatchingRelease(hold, businessId, requestFingerprint, reason);
            return { hold, snapshot: snapshotFileWallet(db, hold.userId), applied: false };
        }
        if (hold.status !== "active") throw new WalletConflictError("钱包预留已经结算");
        if (db.providerUsageAttempts.some((attempt) => attempt.holdId === hold.id && attempt.status === "pending")) throw new WalletConflictError("供应商尝试仍在处理中");
        const now = input.now || new Date();
        hold.status = "released";
        hold.releaseBusinessId = businessId;
        hold.releaseRequestFingerprint = requestFingerprint;
        hold.releaseReason = reason;
        hold.closedAt = now.toISOString();
        hold.updatedAt = now.toISOString();
        return { hold, snapshot: snapshotFileWallet(db, hold.userId), applied: true };
    });
}

export async function recordProviderUsageAttempt(input: RecordProviderUsageAttemptInput) {
    const id = requiredText(input.id, "供应商尝试缺少业务 ID");
    const requestFingerprint = fingerprint(input.requestFingerprint);
    const nativeCostAmount = costAmount(input.nativeCostAmount, "供应商原生成本");
    let nativeCostUnit = validateProviderCostUnit(input.nativeCostUnit);
    const usdConversionRate = nativeCostUnit.kind === "provider-native" ? costAmount(nativeCostUnit.usdConversion.usdPerUnit, "供应商 USD 转换率").toString() : "1";
    if (nativeCostUnit.kind === "provider-native") nativeCostUnit = { ...nativeCostUnit, usdConversion: { ...nativeCostUnit.usdConversion, usdPerUnit: usdConversionRate } };
    const costUsd = decimal(convertProviderCostToUsd(nativeCostAmount.toString(), nativeCostUnit)).roundHalfUp(12).toString();
    if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1) throw new AuthInputError("供应商尝试序号无效");
    if (isPostgresDatabaseEnabled())
        return recordPostgresProviderAttempt({ ...input, id, requestFingerprint, nativeCostAmount, nativeCostUnit, usdConversionRate, costUsd } as Omit<RecordProviderUsageAttemptInput, "nativeCostAmount"> & {
            id: string;
            requestFingerprint: string;
            nativeCostAmount: ExactDecimal;
            nativeCostUnit: ProviderCostUnit;
            usdConversionRate: string;
            costUsd: string;
        });
    return mutateAuthDb((db) => {
        const hold = db.walletHolds.find((item) => item.id === input.holdId);
        if (!hold) throw new AuthInputError("钱包预留不存在");
        const existing = db.providerUsageAttempts.find((attempt) => attempt.id === id);
        if (existing) {
            assertMatchingProviderAttemptIdentity(existing, input, requestFingerprint);
            if (existing.status === "pending" && input.status === "pending" && ((!existing.upstreamTaskId && input.upstreamTaskId?.trim()) || input.observedUsage)) {
                assertPendingProviderAttemptAttachment(existing, input, nativeCostAmount.toString(), nativeCostUnit, usdConversionRate, costUsd);
                const now = input.now || new Date();
                const createdAt = existing.createdAt;
                Object.assign(existing, providerAttemptValues(input, hold.userId, id, requestFingerprint, nativeCostAmount.toString(), nativeCostUnit, usdConversionRate, costUsd, now));
                existing.createdAt = createdAt;
                return { attempt: existing, applied: true };
            }
            if (existing.status === "pending" && input.status !== "pending") {
                if (hold.status !== "active") throw new WalletConflictError("钱包预留已经关闭");
                assertProviderAttemptImmutableSnapshot(existing, input, nativeCostUnit);
                const now = input.now || new Date();
                const createdAt = existing.createdAt;
                Object.assign(existing, providerAttemptValues(input, hold.userId, id, requestFingerprint, nativeCostAmount.toString(), nativeCostUnit, usdConversionRate, costUsd, now));
                existing.createdAt = createdAt;
                return { attempt: existing, applied: true };
            }
            if (!sameProviderAttemptSnapshot(existing, input, nativeCostAmount.toString(), nativeCostUnit, usdConversionRate, costUsd)) throw new WalletConflictError("供应商尝试业务 ID 对应的参数不一致");
            return { attempt: existing, applied: false };
        }
        if (hold.status !== "active") throw new WalletConflictError("钱包预留已经关闭");
        const duplicateNumber = db.providerUsageAttempts.find((attempt) => attempt.holdId === hold.id && attempt.attemptNumber === input.attemptNumber);
        if (duplicateNumber) throw new WalletConflictError("供应商尝试序号已经存在");
        const now = input.now || new Date();
        const attempt: ProviderUsageAttempt = providerAttemptValues(input, hold.userId, id, requestFingerprint, nativeCostAmount.toString(), nativeCostUnit, usdConversionRate, costUsd, now);
        db.providerUsageAttempts.push(attempt);
        return { attempt, applied: true };
    });
}

export async function reconcileWallet(userId: string): Promise<WalletReconciliationReport> {
    if (isPostgresDatabaseEnabled()) return reconcilePostgresWallet(userId);
    return mutateAuthDb((db) => {
        activeFileUser(db, userId);
        const ledgerBalance = sum(db.pointRecords.filter((record) => record.userId === userId).map((record) => record.amount));
        const settled = settledBalance(db, userId);
        const activeHolds = activeHeldBalance(db, userId);
        const issues: string[] = [];
        if (ledgerBalance.toString() !== settled.toString()) issues.push("settled_balance_mismatch");
        for (const charge of db.usageCharges.filter((item) => item.userId === userId)) {
            const linked = db.pointRecords.filter((record) => record.id === charge.pointRecordId && record.userId === userId);
            if (decimal(charge.settledCredits).isZero()) {
                if (charge.pointRecordId || linked.length) issues.push(`zero_charge_has_ledger:${charge.id}`);
            } else if (linked.length !== 1 || linked[0]?.type !== "consume" || decimal(linked[0].amount).plus(decimal(charge.settledCredits)).toString() !== "0") {
                issues.push(`non_zero_charge_ledger_mismatch:${charge.id}`);
            }
        }
        return { userId, ledgerBalance: ledgerBalance.toString(), settledBalance: settled.toString(), activeHolds: activeHolds.toString(), availableBalance: settled.minus(activeHolds).toString(), issues };
    });
}

async function getPostgresWalletSnapshot(userId: string) {
    await ensurePostgresSchema();
    const repos = createPostgresRepositories();
    const user = await repos.users.getById(userId);
    if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
    return postgresSnapshot(user.settledBalance, await repos.pointsWallet.getActiveHeldBalance(userId));
}

async function creditPostgresWallet(input: Omit<CreditWalletBalanceInput, "amount"> & { businessId: string; amount: ExactDecimal }) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const user = await repos.users.getById(input.userId, true);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        const existing = await repos.points.getRecordByIdempotencyKey(input.businessId);
        if (existing) {
            assertMatchingCredit(existing as StoredPointRecord, input.userId, input.amount.toString(), input.type || "credit");
            return { record: existing, snapshot: postgresSnapshot(user.settledBalance, await repos.pointsWallet.getActiveHeldBalance(user.id)), applied: false };
        }
        const now = input.now || new Date();
        const nextBalance = decimal(user.settledBalance).plus(input.amount).toString();
        const updated = await repos.users.update(user.id, { settledBalance: nextBalance });
        if (!updated) throw new AuthInputError("用户不存在");
        const record = await repos.points.addRecord({
            id: randomUUID(),
            userId: user.id,
            type: input.type || "credit",
            amount: input.amount.toString(),
            balanceAfter: nextBalance,
            description: requiredText(input.description, "余额入账缺少说明"),
            idempotencyKey: input.businessId,
            sourceRecordId: input.sourceRecordId,
            createdAt: now.toISOString(),
        });
        return { record, snapshot: postgresSnapshot(nextBalance, await repos.pointsWallet.getActiveHeldBalance(user.id)), applied: true };
    });
}

async function reservePostgresWallet(input: Omit<ReserveWalletCreditsInput, "amount"> & { amount: ExactDecimal; businessId: string; requestFingerprint: string }) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const user = await repos.users.getById(input.userId, true);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        const existing = await repos.pointsWallet.getHoldByBusinessId(input.businessId);
        if (existing) {
            if (existing.userId !== user.id || existing.requestFingerprint !== input.requestFingerprint || existing.amount !== input.amount.toString() || !sameRuntimeSnapshot(existing.runtimeSnapshot, input.runtimeSnapshot))
                throw new WalletConflictError("钱包预留业务 ID 对应的请求参数不一致");
            return { hold: existing, snapshot: postgresSnapshot(user.settledBalance, await repos.pointsWallet.getActiveHeldBalance(user.id)), applied: false };
        }
        const held = decimal(await repos.pointsWallet.getActiveHeldBalance(user.id));
        if (input.amount.greaterThan(decimal(user.settledBalance).minus(held))) throw new QuotaExceededError("可用积分不足");
        const now = input.now || new Date();
        const hold = await repos.pointsWallet.createHold({
            id: randomUUID(),
            userId: user.id,
            businessId: input.businessId,
            requestFingerprint: input.requestFingerprint,
            amount: input.amount.toString(),
            status: "active",
            description: requiredText(input.description, "钱包预留缺少说明"),
            runtimeSnapshot: input.runtimeSnapshot,
            expiresAt: input.expiresAt?.toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
        return { hold, snapshot: postgresSnapshot(user.settledBalance, held.plus(input.amount).toString()), applied: true };
    });
}

async function settlePostgresHold(input: SettleWalletHoldInput & { usageChargeId: string; requestFingerprint: string }) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const initialHold = await repos.pointsWallet.getHoldById(input.holdId);
        if (!initialHold) throw new AuthInputError("钱包预留不存在");
        const user = await repos.users.getById(initialHold.userId, true);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        const existing = await repos.pointsWallet.getUsageChargeById(input.usageChargeId);
        if (existing) {
            assertMatchingSettlement(existing as UsageCharge, input.holdId, input.requestFingerprint, input.saleRateSnapshot, input.finalCharge);
            return {
                charge: existing,
                record: existing.pointRecordId ? await repos.points.getRecordById(existing.pointRecordId) : undefined,
                snapshot: postgresSnapshot(user.settledBalance, await repos.pointsWallet.getActiveHeldBalance(user.id)),
                applied: false,
            };
        }
        const hold = await repos.pointsWallet.getHoldById(input.holdId, true);
        if (!hold || hold.status !== "active") throw new WalletConflictError("钱包预留已经关闭");
        if (await repos.pointsWallet.hasPendingProviderAttempts(hold.id)) throw new WalletConflictError("供应商尝试仍在处理中");
        const finalCharge = validatedFinalCharge(input.saleRateSnapshot, hold.amount, input.finalCharge);
        const settledCredits = creditAmount(finalCharge.credits, "结算积分");
        if (settledCredits.greaterThan(decimal(hold.amount))) throw new AuthInputError("结算积分不能超过预留积分");
        const nextBalance = decimal(user.settledBalance).minus(settledCredits);
        if (nextBalance.isNegative()) throw new QuotaExceededError("结算余额不足");
        const now = input.now || new Date();
        const totalProviderCostUsd = decimal(await repos.pointsWallet.getTotalProviderCostUsd(hold.id));
        let record;
        if (!settledCredits.isZero()) {
            record = await repos.points.addRecord({
                id: randomUUID(),
                userId: user.id,
                type: "consume",
                amount: `-${settledCredits.toString()}`,
                balanceAfter: nextBalance.toString(),
                description: requiredText(input.description, "用量账单缺少说明"),
                idempotencyKey: input.usageChargeId,
                requestFingerprint: input.requestFingerprint,
                createdAt: now.toISOString(),
            });
        }
        const charge = await repos.pointsWallet.createUsageCharge({
            id: input.usageChargeId,
            userId: user.id,
            holdId: hold.id,
            requestFingerprint: input.requestFingerprint,
            reservedCredits: hold.amount,
            settledCredits: settledCredits.toString(),
            normalizedUsage: finalCharge.usage,
            saleRateSnapshot: input.saleRateSnapshot,
            runtimeSnapshot: hold.runtimeSnapshot,
            finalSaleCharge: finalCharge,
            estimated: finalCharge.estimated,
            totalProviderCostUsd: totalProviderCostUsd.toString(),
            description: requiredText(input.description, "用量账单缺少说明"),
            pointRecordId: record?.id,
            createdAt: now.toISOString(),
            settledAt: now.toISOString(),
        });
        if (!(await repos.pointsWallet.closeHold(hold.id, { status: "settled", usageChargeId: charge.id, closedAt: now.toISOString() }))) throw new WalletConflictError("钱包预留已经关闭");
        if (!(await repos.users.update(user.id, { settledBalance: nextBalance.toString() }))) throw new AuthInputError("用户不存在");
        return { charge, record, snapshot: postgresSnapshot(nextBalance.toString(), await repos.pointsWallet.getActiveHeldBalance(user.id)), applied: true };
    });
}

async function recordPostgresProviderAttempt(
    input: Omit<RecordProviderUsageAttemptInput, "nativeCostAmount"> & { id: string; requestFingerprint: string; nativeCostAmount: ExactDecimal; nativeCostUnit: ProviderCostUnit; usdConversionRate: string; costUsd: string },
) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const hold = await repos.pointsWallet.getHoldById(input.holdId, true);
        if (!hold) throw new AuthInputError("钱包预留不存在");
        const existing = await repos.pointsWallet.getProviderAttemptById(input.id);
        if (existing) {
            assertMatchingProviderAttemptIdentity(existing, input, input.requestFingerprint);
            if (existing.status === "pending" && input.status === "pending" && ((!existing.upstreamTaskId && input.upstreamTaskId?.trim()) || input.observedUsage)) {
                assertPendingProviderAttemptAttachment(existing, input, input.nativeCostAmount.toString(), input.nativeCostUnit, input.usdConversionRate, input.costUsd);
                const updated = await repos.pointsWallet.updatePendingProviderAttempt(
                    existing.id,
                    providerAttemptValues(input, hold.userId, input.id, input.requestFingerprint, input.nativeCostAmount.toString(), input.nativeCostUnit, input.usdConversionRate, input.costUsd, input.now || new Date()),
                );
                if (!updated) throw new WalletConflictError("供应商尝试状态已经变更");
                return { attempt: updated, applied: true };
            }
            if (existing.status === "pending" && input.status !== "pending") {
                if (hold.status !== "active") throw new WalletConflictError("钱包预留已经关闭");
                assertProviderAttemptImmutableSnapshot(existing, input, input.nativeCostUnit);
                const now = input.now || new Date();
                const updated = await repos.pointsWallet.updatePendingProviderAttempt(
                    existing.id,
                    providerAttemptValues(input, hold.userId, input.id, input.requestFingerprint, input.nativeCostAmount.toString(), input.nativeCostUnit, input.usdConversionRate, input.costUsd, now),
                );
                if (!updated) throw new WalletConflictError("供应商尝试状态已经变更");
                return { attempt: updated, applied: true };
            }
            if (!sameProviderAttemptSnapshot(existing, input, input.nativeCostAmount.toString(), input.nativeCostUnit, input.usdConversionRate, input.costUsd)) throw new WalletConflictError("供应商尝试业务 ID 对应的参数不一致");
            return { attempt: existing, applied: false };
        }
        if (hold.status !== "active") throw new WalletConflictError("钱包预留已经关闭");
        if (await repos.pointsWallet.getProviderAttemptByNumber(hold.id, input.attemptNumber)) throw new WalletConflictError("供应商尝试序号已经存在");
        const now = input.now || new Date();
        const attempt = await repos.pointsWallet.createProviderAttempt(providerAttemptValues(input, hold.userId, input.id, input.requestFingerprint, input.nativeCostAmount.toString(), input.nativeCostUnit, input.usdConversionRate, input.costUsd, now));
        return { attempt, applied: true };
    });
}

async function reconcilePostgresWallet(userId: string): Promise<WalletReconciliationReport> {
    await ensurePostgresSchema();
    const repos = createPostgresRepositories();
    const user = await repos.users.getById(userId);
    if (!user) throw new AuthInputError("用户不存在");
    const aggregate = await repos.pointsWallet.getReconciliationAggregate(userId);
    const issues: string[] = [];
    if (!decimal(aggregate.ledgerBalance).minus(decimal(aggregate.settledBalance)).isZero()) issues.push("settled_balance_mismatch");
    if (aggregate.invalidChargeCount) issues.push(`usage_charge_ledger_mismatch:${aggregate.invalidChargeCount}`);
    return {
        userId,
        ledgerBalance: decimal(aggregate.ledgerBalance).toString(),
        settledBalance: decimal(aggregate.settledBalance).toString(),
        activeHolds: decimal(aggregate.activeHolds).toString(),
        availableBalance: decimal(aggregate.availableBalance).toString(),
        issues,
    };
}

function postgresSnapshot(settledBalance: string, heldBalance: string): WalletSnapshot {
    return { settledBalance: decimal(settledBalance).toString(), heldBalance: decimal(heldBalance).toString(), availableBalance: decimal(settledBalance).minus(decimal(heldBalance)).toString() };
}

function snapshotFileWallet(db: AuthDatabase, userId: string): WalletSnapshot {
    const settled = settledBalance(db, userId);
    const held = activeHeldBalance(db, userId);
    return { settledBalance: settled.toString(), heldBalance: held.toString(), availableBalance: settled.minus(held).toString() };
}

function activeFileUser(db: AuthDatabase, userId: string) {
    const user = db.users.find((item) => item.id === userId);
    if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
    return user;
}

function settledBalance(db: AuthDatabase, userId: string) {
    const user = db.users.find((item) => item.id === userId) as ((typeof db.users)[number] & { settledBalance?: string }) | undefined;
    if (!user) throw new AuthInputError("用户不存在");
    return creditAmount(user.settledBalance || "0", "结算余额");
}

function activeHeldBalance(db: AuthDatabase, userId: string) {
    return sum(db.walletHolds.filter((hold) => hold.userId === userId && hold.status === "active").map((hold) => hold.amount));
}

function sum(values: DecimalInput[]) {
    return values.reduce<ExactDecimal>((total, value) => total.plus(decimal(value)), decimal(0));
}

function creditAmount(value: DecimalInput, label: string) {
    const amount = decimal(value, label);
    if (amount.isNegative()) throw new AuthInputError(`${label}不能为负数`);
    if (!amount.hasAtMostDecimalPlaces(8)) throw new AuthInputError(`${label}最多保留 8 位小数`);
    return amount;
}

function costAmount(value: DecimalInput, label: string) {
    const amount = decimal(value, label);
    if (amount.isNegative()) throw new AuthInputError(`${label}不能为负数`);
    if (!amount.hasAtMostDecimalPlaces(12)) throw new AuthInputError(`${label}最多保留 12 位小数`);
    return amount;
}

function fingerprint(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) throw new AuthInputError("请求指纹无效");
    return normalized;
}

function requiredText(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) throw new AuthInputError(message);
    return normalized;
}

function validatedFinalCharge(rateCard: PricingRateCardV1, reservedCredits: string, supplied: FinalSaleCharge) {
    if (!supplied || typeof supplied !== "object") throw new AuthInputError("结算快照无效");
    const reserve = { credits: reservedCredits, rawCredits: reservedCredits, usage: supplied.usage };
    const calculated = calculateFinalSaleCharge({
        rateCard,
        reserve,
        ...(supplied.usage?.source === "actual" ? { actualUsage: supplied.usage } : {}),
        ...(supplied.usage?.source === "derived" ? { derivedUsage: supplied.usage } : {}),
    });
    if (
        calculated.credits !== supplied.credits ||
        calculated.uncappedCredits !== supplied.uncappedCredits ||
        calculated.platformLossCredits !== supplied.platformLossCredits ||
        calculated.estimated !== supplied.estimated ||
        calculated.capped !== supplied.capped ||
        JSON.stringify(calculated.usage) !== JSON.stringify(supplied.usage)
    )
        throw new AuthInputError("结算快照与售卖价格不一致");
    return calculated;
}

function assertMatchingSettlement(charge: UsageCharge, holdId: string, requestFingerprint: string, saleRateSnapshot: PricingRateCardV1, finalCharge: FinalSaleCharge) {
    if (
        charge.holdId !== holdId ||
        charge.requestFingerprint !== requestFingerprint ||
        JSON.stringify(charge.saleRateSnapshot) !== JSON.stringify(saleRateSnapshot) ||
        JSON.stringify(charge.finalSaleCharge) !== JSON.stringify(validatedFinalCharge(charge.saleRateSnapshot, charge.reservedCredits, finalCharge))
    )
        throw new WalletConflictError("用量账单业务 ID 对应的结算参数不一致");
}

function assertMatchingRelease(hold: WalletHold, businessId: string, requestFingerprint: string, reason: string) {
    if (hold.releaseBusinessId !== businessId || hold.releaseRequestFingerprint !== requestFingerprint || hold.releaseReason !== reason) throw new WalletConflictError("释放预留业务 ID 对应的请求参数不一致");
}

function assertMatchingProviderAttemptIdentity(existing: ProviderUsageAttempt, input: Pick<RecordProviderUsageAttemptInput, "holdId" | "attemptNumber" | "provider" | "bindingId" | "providerIdempotencySupported">, requestFingerprint: string) {
    if (
        existing.holdId !== input.holdId ||
        existing.attemptNumber !== input.attemptNumber ||
        existing.provider !== requiredText(input.provider, "供应商尝试缺少供应商") ||
        existing.bindingId !== requiredText(input.bindingId, "供应商尝试缺少绑定 ID") ||
        existing.requestFingerprint !== requestFingerprint ||
        existing.providerIdempotencySupported !== (input.providerIdempotencySupported === true)
    ) {
        throw new WalletConflictError("供应商尝试业务 ID 对应的参数不一致");
    }
}

function sameProviderAttemptSnapshot(
    existing: ProviderUsageAttempt,
    input: Pick<RecordProviderUsageAttemptInput, "status" | "providerIdempotencySupported" | "providerIdempotencyKey" | "upstreamTaskId" | "costRateSnapshot" | "normalizedUsage" | "observedUsage">,
    nativeCostAmount: string,
    nativeCostUnit: ProviderCostUnit,
    usdConversionRate: string,
    costUsd: string,
) {
    return (
        existing.status === input.status &&
        existing.providerIdempotencySupported === (input.providerIdempotencySupported === true) &&
        existing.providerIdempotencyKey === normalizedOptionalText(input.providerIdempotencyKey) &&
        existing.upstreamTaskId === normalizedOptionalText(input.upstreamTaskId) &&
        JSON.stringify(existing.costRateSnapshot) === JSON.stringify(input.costRateSnapshot) &&
        JSON.stringify(existing.normalizedUsage) === JSON.stringify(input.normalizedUsage) &&
        JSON.stringify(existing.observedUsage) === JSON.stringify(input.observedUsage) &&
        sameDecimalValue(existing.nativeCostAmount, nativeCostAmount) &&
        sameProviderCostUnit(existing.nativeCostUnit, nativeCostUnit) &&
        sameDecimalValue(existing.usdConversionRate, usdConversionRate) &&
        sameDecimalValue(existing.costUsd, costUsd)
    );
}

function assertProviderAttemptImmutableSnapshot(
    existing: ProviderUsageAttempt,
    input: Pick<RecordProviderUsageAttemptInput, "providerIdempotencySupported" | "providerIdempotencyKey" | "upstreamTaskId" | "costRateSnapshot">,
    nativeCostUnit: ProviderCostUnit,
) {
    const upstreamTaskId = normalizedOptionalText(input.upstreamTaskId);
    if (
        existing.providerIdempotencySupported !== (input.providerIdempotencySupported === true) ||
        existing.providerIdempotencyKey !== normalizedOptionalText(input.providerIdempotencyKey) ||
        (existing.upstreamTaskId && existing.upstreamTaskId !== upstreamTaskId) ||
        JSON.stringify(existing.costRateSnapshot) !== JSON.stringify(input.costRateSnapshot) ||
        !sameProviderCostUnit(existing.nativeCostUnit, nativeCostUnit)
    )
        throw new WalletConflictError("供应商尝试业务 ID 对应的参数不一致");
}

function assertPendingProviderAttemptAttachment(
    existing: ProviderUsageAttempt,
    input: Pick<RecordProviderUsageAttemptInput, "providerIdempotencySupported" | "providerIdempotencyKey" | "costRateSnapshot" | "normalizedUsage" | "observedUsage">,
    nativeCostAmount: string,
    nativeCostUnit: ProviderCostUnit,
    usdConversionRate: string,
    costUsd: string,
) {
    if (
        existing.providerIdempotencySupported !== (input.providerIdempotencySupported === true) ||
        existing.providerIdempotencyKey !== normalizedOptionalText(input.providerIdempotencyKey) ||
        JSON.stringify(existing.costRateSnapshot) !== JSON.stringify(input.costRateSnapshot) ||
        JSON.stringify(existing.normalizedUsage) !== JSON.stringify(input.normalizedUsage) ||
        (existing.observedUsage && JSON.stringify(existing.observedUsage) !== JSON.stringify(input.observedUsage)) ||
        !sameDecimalValue(existing.nativeCostAmount, nativeCostAmount) ||
        !sameProviderCostUnit(existing.nativeCostUnit, nativeCostUnit) ||
        !sameDecimalValue(existing.usdConversionRate, usdConversionRate) ||
        !sameDecimalValue(existing.costUsd, costUsd)
    )
        throw new WalletConflictError("供应商尝试业务 ID 对应的参数不一致");
}

function normalizedOptionalText(value: string | undefined) {
    return value?.trim() || undefined;
}

function sameDecimalValue(left: string, right: string) {
    try {
        return decimal(left).minus(decimal(right)).isZero();
    } catch {
        return false;
    }
}

function sameProviderCostUnit(left: ProviderCostUnit, right: ProviderCostUnit) {
    if (left.kind !== right.kind) return false;
    if (left.kind === "fiat" || right.kind === "fiat") return left.kind === "fiat" && right.kind === "fiat" && left.currency === right.currency;
    return left.provider === right.provider && left.unit === right.unit && left.usdConversion.version === right.usdConversion.version && sameDecimalValue(left.usdConversion.usdPerUnit, right.usdConversion.usdPerUnit);
}

function sameRuntimeSnapshot(left: UsageBillingHoldSnapshot | undefined, right: UsageBillingHoldSnapshot | undefined) {
    if (!left || !right) return left === right;
    const withoutAttempt = ({ providerIdempotency: _providerIdempotency, ...snapshot }: UsageBillingHoldSnapshot) => snapshot;
    return JSON.stringify(withoutAttempt(left)) === JSON.stringify(withoutAttempt(right));
}

function providerAttemptValues(
    input: Omit<RecordProviderUsageAttemptInput, "nativeCostAmount">,
    userId: string,
    id: string,
    requestFingerprint: string,
    nativeCostAmount: string,
    nativeCostUnit: ProviderCostUnit,
    usdConversionRate: string,
    costUsd: string,
    now: Date,
): ProviderUsageAttempt {
    return {
        id,
        holdId: input.holdId,
        userId,
        attemptNumber: input.attemptNumber,
        status: input.status,
        provider: requiredText(input.provider, "供应商尝试缺少供应商"),
        bindingId: requiredText(input.bindingId, "供应商尝试缺少绑定 ID"),
        requestFingerprint,
        providerIdempotencySupported: input.providerIdempotencySupported === true,
        providerIdempotencyKey: input.providerIdempotencyKey?.trim() || undefined,
        upstreamTaskId: input.upstreamTaskId?.trim() || undefined,
        nativeCostAmount,
        nativeCostUnit,
        usdConversionRate,
        costUsd,
        costRateSnapshot: input.costRateSnapshot,
        normalizedUsage: input.normalizedUsage,
        observedUsage: input.observedUsage,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: input.status === "pending" ? undefined : now.toISOString(),
    };
}

function assertMatchingCredit(record: StoredPointRecord, userId: string, amount: string, type: StoredPointRecord["type"]) {
    if (record.userId !== userId || record.type !== type || record.amount !== amount) throw new WalletConflictError("余额入账业务 ID 对应的参数不一致");
}
