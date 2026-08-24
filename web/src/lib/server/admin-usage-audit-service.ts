import { decimal } from "@/lib/billing/decimal";
import { getPublicUsersByIds } from "@/lib/auth/store";
import { readAuthDb } from "@/lib/auth/store-repository";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import type { ProviderUsageAttempt, UsageCharge, WalletHold } from "@/lib/auth/store-types";
import { BillingInputError } from "@/lib/server/billing-errors";

export async function getAdminUsageAudit(input: { page?: number; pageSize?: number; recoveryPage?: number; recoveryPageSize?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 20)));
    const recoveryPage = Math.max(1, Math.floor(Number(input.recoveryPage) || 1));
    const recoveryPageSize = Math.max(1, Math.min(100, Math.floor(Number(input.recoveryPageSize) || 20)));
    let charges: UsageCharge[];
    let recovery: WalletHold[];
    let total: number;
    let safePage = page;
    let recoveryTotal: number;
    let safeRecoveryPage = recoveryPage;
    let stats: { zeroUsage: number; negativeMargin: number };
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const repo = createPostgresRepositories().pointsWallet;
        const [result, recoveryResult, auditStats] = await Promise.all([repo.listUsageCharges({ page, pageSize }), repo.listRecoveryHoldsPage({ now: new Date().toISOString(), page: recoveryPage, pageSize: recoveryPageSize }), repo.getUsageAuditStats()]);
        charges = result.items;
        recovery = recoveryResult.items;
        total = result.total;
        safePage = result.page;
        recoveryTotal = recoveryResult.total;
        safeRecoveryPage = recoveryResult.page;
        stats = auditStats;
    } else {
        const db = await readAuthDb();
        const ordered = [...db.usageCharges].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        total = ordered.length;
        safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        charges = ordered.slice((safePage - 1) * pageSize, safePage * pageSize);
        const orderedRecovery = db.walletHolds
            .filter((hold) => hold.status === "active" && (hold.reviewReason || (hold.expiresAt && Date.parse(hold.expiresAt) <= Date.now())))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
        recoveryTotal = orderedRecovery.length;
        safeRecoveryPage = Math.min(recoveryPage, Math.max(1, Math.ceil(recoveryTotal / recoveryPageSize)));
        recovery = orderedRecovery.slice((safeRecoveryPage - 1) * recoveryPageSize, safeRecoveryPage * recoveryPageSize);
        stats = {
            zeroUsage: ordered.filter((charge) => decimal(charge.settledCredits).isZero() && decimal(charge.totalProviderCostUsd).greaterThan(decimal(0))).length,
            negativeMargin: ordered.filter((charge) => {
                const sale = decimal(charge.settledCredits);
                return !sale.isZero() && sale.minus(decimal(charge.totalProviderCostUsd)).isNegative();
            }).length,
        };
    }
    const users = await getPublicUsersByIds([...new Set([...charges.map((charge) => charge.userId), ...recovery.map((hold) => hold.userId)])]);
    const usersById = new Map(users.map((user) => [user.id, presentUser(user)]));
    return {
        items: charges.map((charge) => presentCharge(charge, usersById.get(charge.userId))),
        recovery: recovery.map(({ id, userId, businessId, amount, reviewReason, expiresAt, recoveryCheckedAt, createdAt }) => ({ id, user: usersById.get(userId), businessId, amount, reviewReason, expiresAt, recoveryCheckedAt, createdAt })),
        total,
        page: safePage,
        pageSize,
        recoveryTotal,
        recoveryPage: safeRecoveryPage,
        recoveryPageSize,
        ...stats,
    };
}

export async function getAdminUsageAttempts(chargeId: string, input: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 20)));
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const repo = createPostgresRepositories().pointsWallet;
        const charge = await repo.getUsageChargeById(chargeId);
        if (!charge) throw new BillingInputError("用量账单不存在", 404);
        const result = await repo.listProviderAttemptsPage({ holdId: charge.holdId, page, pageSize });
        return { ...result, items: result.items.map(presentAttempt) };
    }
    const db = await readAuthDb();
    const charge = db.usageCharges.find((item) => item.id === chargeId);
    if (!charge) throw new BillingInputError("用量账单不存在", 404);
    const ordered = db.providerUsageAttempts.filter((attempt) => attempt.holdId === charge.holdId).sort((left, right) => left.attemptNumber - right.attemptNumber || left.id.localeCompare(right.id));
    const safePage = Math.min(page, Math.max(1, Math.ceil(ordered.length / pageSize)));
    return { items: ordered.slice((safePage - 1) * pageSize, safePage * pageSize).map(presentAttempt), total: ordered.length, page: safePage, pageSize };
}

function presentCharge(charge: UsageCharge, user?: ReturnType<typeof presentUser>) {
    const sale = decimal(charge.settledCredits);
    const cost = decimal(charge.totalProviderCostUsd);
    const margin = sale.minus(cost);
    const anomaly = sale.isZero() && cost.greaterThan(decimal(0)) ? "zero_usage_cost" : margin.isNegative() ? "negative_margin" : "none";
    return {
        id: charge.id,
        user,
        holdId: charge.holdId,
        capability: charge.normalizedUsage.capability,
        usageSource: charge.normalizedUsage.source,
        settledCredits: sale.toString(),
        providerCostUsd: cost.toString(),
        marginUsd: margin.toString(),
        estimated: charge.estimated,
        anomaly,
        createdAt: charge.createdAt,
    };
}

function presentAttempt(attempt: ProviderUsageAttempt) {
    return {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        provider: attempt.provider,
        bindingId: attempt.bindingId,
        nativeCostAmount: decimal(attempt.nativeCostAmount).toString(),
        nativeCostUnit: attempt.nativeCostUnit,
        usdConversionRate: decimal(attempt.usdConversionRate).toString(),
        costUsd: decimal(attempt.costUsd).toString(),
        createdAt: attempt.createdAt,
        completedAt: attempt.completedAt,
    };
}

function presentUser(user: { accountId?: string; username: string; displayName: string; avatarUrl?: string }) {
    return { accountId: user.accountId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
}
