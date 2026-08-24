import { decimal } from "@/lib/billing/decimal";
import { readAuthDb } from "@/lib/auth/store-repository";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import type { UsageCharge, WalletHold } from "@/lib/auth/store-types";

export async function getAdminUsageAudit(input: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 20)));
    let charges: UsageCharge[];
    let recovery: WalletHold[];
    let total: number;
    let safePage = page;
    let stats: { zeroUsage: number; negativeMargin: number };
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const repo = createPostgresRepositories().pointsWallet;
        const [result, recoveryItems, auditStats] = await Promise.all([repo.listUsageCharges({ page, pageSize }), repo.listRecoveryHolds(new Date().toISOString(), pageSize), repo.getUsageAuditStats()]);
        charges = result.items;
        recovery = recoveryItems;
        total = result.total;
        safePage = result.page;
        stats = auditStats;
    } else {
        const db = await readAuthDb();
        const ordered = [...db.usageCharges].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        total = ordered.length;
        safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        charges = ordered.slice((safePage - 1) * pageSize, safePage * pageSize);
        recovery = db.walletHolds.filter((hold) => hold.status === "active" && (hold.reviewReason || (hold.expiresAt && Date.parse(hold.expiresAt) <= Date.now()))).slice(0, pageSize);
        stats = {
            zeroUsage: ordered.filter((charge) => decimal(charge.settledCredits).isZero() && decimal(charge.totalProviderCostUsd).greaterThan(decimal(0))).length,
            negativeMargin: ordered.filter((charge) => {
                const sale = decimal(charge.settledCredits);
                return !sale.isZero() && sale.minus(decimal(charge.totalProviderCostUsd)).isNegative();
            }).length,
        };
    }
    return {
        items: charges.map(presentCharge),
        recovery: recovery.map(({ id, userId, businessId, amount, reviewReason, expiresAt, createdAt }) => ({ id, userId, businessId, amount, reviewReason, expiresAt, createdAt })),
        total,
        page: safePage,
        pageSize,
        ...stats,
    };
}

function presentCharge(charge: UsageCharge) {
    const sale = decimal(charge.settledCredits);
    const cost = decimal(charge.totalProviderCostUsd);
    const margin = sale.minus(cost);
    const anomaly = sale.isZero() && cost.greaterThan(decimal(0)) ? "zero_usage_cost" : margin.isNegative() ? "negative_margin" : "none";
    return {
        id: charge.id,
        userId: charge.userId,
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
