import type { QueryExecutor } from "@/lib/server/database/postgres";

import type { ProviderUsageAttemptRecord, UsageChargeRecord, WalletHoldRecord } from "./repository-shared";
import { mapProviderUsageAttempt, mapUsageCharge, mapWalletHold } from "./repository-record-mappers";
import { jsonParam, normalizePage, normalizePageSize, numberValue, pageResult, stringValue } from "./repository-shared";

export class PointsWalletRepository {
    constructor(private readonly db: QueryExecutor) {}

    async getHoldById(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT * FROM wallet_holds WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? mapWalletHold(result.rows[0]) : null;
    }

    async getHoldByBusinessId(businessId: string) {
        const result = await this.db.query("SELECT * FROM wallet_holds WHERE business_id = $1", [businessId]);
        return result.rows[0] ? mapWalletHold(result.rows[0]) : null;
    }

    async createHold(hold: WalletHoldRecord) {
        return this.writeHold(hold, false);
    }

    async upsertHoldForRestore(hold: WalletHoldRecord) {
        return this.writeHold(hold, true);
    }

    private async writeHold(hold: WalletHoldRecord, restore: boolean) {
        const result = await this.db.query(
            `INSERT INTO wallet_holds (id, user_id, business_id, request_fingerprint, amount, status, description, runtime_snapshot, review_reason, recovery_checked_at, usage_charge_id, release_business_id, release_request_fingerprint, release_reason, expires_at, closed_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
             ${restore ? `ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, business_id = EXCLUDED.business_id, request_fingerprint = EXCLUDED.request_fingerprint, amount = EXCLUDED.amount, status = EXCLUDED.status, description = EXCLUDED.description, runtime_snapshot = EXCLUDED.runtime_snapshot, review_reason = EXCLUDED.review_reason, recovery_checked_at = EXCLUDED.recovery_checked_at, usage_charge_id = EXCLUDED.usage_charge_id, release_business_id = EXCLUDED.release_business_id, release_request_fingerprint = EXCLUDED.release_request_fingerprint, release_reason = EXCLUDED.release_reason, expires_at = EXCLUDED.expires_at, closed_at = EXCLUDED.closed_at, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at` : ""}
             RETURNING *`,
            [
                hold.id,
                hold.userId,
                hold.businessId,
                hold.requestFingerprint,
                hold.amount,
                hold.status,
                hold.description,
                hold.runtimeSnapshot ? jsonParam(hold.runtimeSnapshot) : null,
                hold.reviewReason || null,
                hold.recoveryCheckedAt || null,
                hold.usageChargeId || null,
                hold.releaseBusinessId || null,
                hold.releaseRequestFingerprint || null,
                hold.releaseReason || null,
                hold.expiresAt || null,
                hold.closedAt || null,
                hold.createdAt,
                hold.updatedAt,
            ],
        );
        return mapWalletHold(result.rows[0]);
    }

    async closeHold(id: string, input: { status: "settled" | "released"; usageChargeId?: string; releaseBusinessId?: string; releaseRequestFingerprint?: string; releaseReason?: string; closedAt: string }) {
        const result = await this.db.query(
            `UPDATE wallet_holds SET status = $2, usage_charge_id = $3, release_business_id = $4, release_request_fingerprint = $5, release_reason = $6, closed_at = $7, updated_at = $7
             WHERE id = $1 AND status = 'active' RETURNING *`,
            [id, input.status, input.usageChargeId || null, input.releaseBusinessId || null, input.releaseRequestFingerprint || null, input.releaseReason || null, input.closedAt],
        );
        return result.rows[0] ? mapWalletHold(result.rows[0]) : null;
    }

    async getActiveHeldBalance(userId: string) {
        const result = await this.db.query("SELECT coalesce(sum(amount), 0)::text AS held_balance FROM wallet_holds WHERE user_id = $1 AND status = 'active'", [userId]);
        return stringValue(result.rows[0]?.held_balance || "0");
    }

    async listExpiredActiveHolds(now: string, limit: number) {
        const result = await this.db.query(
            `WITH candidates AS (
                SELECT id FROM wallet_holds
                WHERE status = 'active' AND review_reason IS NULL AND expires_at IS NOT NULL AND expires_at <= $1::timestamptz
                ORDER BY COALESCE(recovery_checked_at, expires_at) ASC, id ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
             )
             UPDATE wallet_holds AS hold
             SET recovery_checked_at = $1::timestamptz
             FROM candidates
             WHERE hold.id = candidates.id
             RETURNING hold.*`,
            [now, limit],
        );
        return result.rows.map(mapWalletHold);
    }

    async markHoldNeedsReview(id: string, reason: string, now: string) {
        const result = await this.db.query("UPDATE wallet_holds SET review_reason = $2, updated_at = $3 WHERE id = $1 AND status = 'active' RETURNING *", [id, reason, now]);
        return result.rows[0] ? mapWalletHold(result.rows[0]) : null;
    }

    async getUsageChargeById(id: string) {
        const result = await this.db.query("SELECT * FROM usage_charges WHERE id = $1", [id]);
        return result.rows[0] ? mapUsageCharge(result.rows[0]) : null;
    }

    async listUsageCharges(input: { page?: number; pageSize?: number } = {}) {
        const page = normalizePage(input.page);
        const pageSize = normalizePageSize(input.pageSize);
        const count = await this.db.query("SELECT count(*) AS total FROM usage_charges");
        const total = numberValue(count.rows[0]?.total);
        const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        const result = await this.db.query("SELECT * FROM usage_charges ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2", [pageSize, (safePage - 1) * pageSize]);
        return pageResult(result.rows.map(mapUsageCharge), total, safePage, pageSize);
    }

    async getUsageAuditStats() {
        const result = await this.db.query(
            `SELECT
                count(*) FILTER (WHERE settled_credits = 0 AND total_provider_cost_usd > 0) AS zero_usage,
                count(*) FILTER (WHERE settled_credits <> 0 AND settled_credits < total_provider_cost_usd) AS negative_margin
             FROM usage_charges`,
        );
        return { zeroUsage: numberValue(result.rows[0]?.zero_usage), negativeMargin: numberValue(result.rows[0]?.negative_margin) };
    }

    async listRecoveryHolds(now: string, limit: number) {
        const result = await this.db.query("SELECT * FROM wallet_holds WHERE status = 'active' AND (review_reason IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= $1)) ORDER BY updated_at DESC, id DESC LIMIT $2", [now, limit]);
        return result.rows.map(mapWalletHold);
    }

    async listRecoveryHoldsPage(input: { now: string; page?: number; pageSize?: number }) {
        const page = normalizePage(input.page);
        const pageSize = normalizePageSize(input.pageSize);
        const count = await this.db.query("SELECT count(*) AS total FROM wallet_holds WHERE status = 'active' AND (review_reason IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= $1))", [input.now]);
        const total = numberValue(count.rows[0]?.total);
        const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        const result = await this.db.query("SELECT * FROM wallet_holds WHERE status = 'active' AND (review_reason IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= $1)) ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3", [
            input.now,
            pageSize,
            (safePage - 1) * pageSize,
        ]);
        return pageResult(result.rows.map(mapWalletHold), total, safePage, pageSize);
    }

    async createUsageCharge(charge: UsageChargeRecord) {
        return this.writeUsageCharge(charge, false);
    }

    async upsertUsageChargeForRestore(charge: UsageChargeRecord) {
        return this.writeUsageCharge(charge, true);
    }

    private async writeUsageCharge(charge: UsageChargeRecord, restore: boolean) {
        const result = await this.db.query(
            `INSERT INTO usage_charges (id, user_id, hold_id, request_fingerprint, reserved_credits, settled_credits, normalized_usage, sale_rate_snapshot, runtime_snapshot, final_sale_charge, estimated, total_provider_cost_usd, description, point_record_id, created_at, settled_at)
             VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::numeric, $13, $14, $15, $16)
             ${restore ? `ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, hold_id = EXCLUDED.hold_id, request_fingerprint = EXCLUDED.request_fingerprint, reserved_credits = EXCLUDED.reserved_credits, settled_credits = EXCLUDED.settled_credits, normalized_usage = EXCLUDED.normalized_usage, sale_rate_snapshot = EXCLUDED.sale_rate_snapshot, runtime_snapshot = EXCLUDED.runtime_snapshot, final_sale_charge = EXCLUDED.final_sale_charge, estimated = EXCLUDED.estimated, total_provider_cost_usd = EXCLUDED.total_provider_cost_usd, description = EXCLUDED.description, point_record_id = EXCLUDED.point_record_id, created_at = EXCLUDED.created_at, settled_at = EXCLUDED.settled_at` : ""}
             RETURNING *`,
            [
                charge.id,
                charge.userId,
                charge.holdId,
                charge.requestFingerprint,
                charge.reservedCredits,
                charge.settledCredits,
                jsonParam(charge.normalizedUsage),
                jsonParam(charge.saleRateSnapshot),
                charge.runtimeSnapshot ? jsonParam(charge.runtimeSnapshot) : null,
                jsonParam(charge.finalSaleCharge),
                charge.estimated,
                charge.totalProviderCostUsd,
                charge.description,
                charge.pointRecordId || null,
                charge.createdAt,
                charge.settledAt,
            ],
        );
        return mapUsageCharge(result.rows[0]);
    }

    async getProviderAttemptById(id: string) {
        const result = await this.db.query("SELECT * FROM provider_usage_attempts WHERE id = $1", [id]);
        return result.rows[0] ? mapProviderUsageAttempt(result.rows[0]) : null;
    }

    async getProviderAttemptByNumber(holdId: string, attemptNumber: number) {
        const result = await this.db.query("SELECT * FROM provider_usage_attempts WHERE hold_id = $1 AND attempt_number = $2", [holdId, attemptNumber]);
        return result.rows[0] ? mapProviderUsageAttempt(result.rows[0]) : null;
    }

    async listProviderAttemptsForHold(holdId: string) {
        const result = await this.db.query("SELECT * FROM provider_usage_attempts WHERE hold_id = $1 ORDER BY attempt_number ASC", [holdId]);
        return result.rows.map(mapProviderUsageAttempt);
    }

    async listProviderAttemptsPage(input: { holdId: string; page?: number; pageSize?: number }) {
        const page = normalizePage(input.page);
        const pageSize = normalizePageSize(input.pageSize);
        const count = await this.db.query("SELECT count(*) AS total FROM provider_usage_attempts WHERE hold_id = $1", [input.holdId]);
        const total = numberValue(count.rows[0]?.total);
        const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        const result = await this.db.query("SELECT * FROM provider_usage_attempts WHERE hold_id = $1 ORDER BY attempt_number ASC LIMIT $2 OFFSET $3", [input.holdId, pageSize, (safePage - 1) * pageSize]);
        return pageResult(result.rows.map(mapProviderUsageAttempt), total, safePage, pageSize);
    }

    async createProviderAttempt(attempt: ProviderUsageAttemptRecord) {
        return this.writeProviderAttempt(attempt, false);
    }

    async upsertProviderAttemptForRestore(attempt: ProviderUsageAttemptRecord) {
        return this.writeProviderAttempt(attempt, true);
    }

    private async writeProviderAttempt(attempt: ProviderUsageAttemptRecord, restore: boolean) {
        const result = await this.db.query(
            `INSERT INTO provider_usage_attempts (id, hold_id, user_id, attempt_number, status, provider, binding_id, request_fingerprint, provider_idempotency_supported, provider_idempotency_key, upstream_task_id, native_cost_amount, native_cost_unit, usd_conversion_rate, cost_usd, cost_rate_snapshot, normalized_usage, observed_usage, created_at, updated_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::numeric, $13::jsonb, $14::numeric, $15::numeric, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21)
             ${restore ? `ON CONFLICT (id) DO UPDATE SET hold_id = EXCLUDED.hold_id, user_id = EXCLUDED.user_id, attempt_number = EXCLUDED.attempt_number, status = EXCLUDED.status, provider = EXCLUDED.provider, binding_id = EXCLUDED.binding_id, request_fingerprint = EXCLUDED.request_fingerprint, provider_idempotency_supported = EXCLUDED.provider_idempotency_supported, provider_idempotency_key = EXCLUDED.provider_idempotency_key, upstream_task_id = EXCLUDED.upstream_task_id, native_cost_amount = EXCLUDED.native_cost_amount, native_cost_unit = EXCLUDED.native_cost_unit, usd_conversion_rate = EXCLUDED.usd_conversion_rate, cost_usd = EXCLUDED.cost_usd, cost_rate_snapshot = EXCLUDED.cost_rate_snapshot, normalized_usage = EXCLUDED.normalized_usage, observed_usage = EXCLUDED.observed_usage, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at` : ""}
             RETURNING *`,
            [
                attempt.id,
                attempt.holdId,
                attempt.userId,
                attempt.attemptNumber,
                attempt.status,
                attempt.provider,
                attempt.bindingId,
                attempt.requestFingerprint,
                attempt.providerIdempotencySupported,
                attempt.providerIdempotencyKey || null,
                attempt.upstreamTaskId || null,
                attempt.nativeCostAmount,
                jsonParam(attempt.nativeCostUnit),
                attempt.usdConversionRate,
                attempt.costUsd,
                attempt.costRateSnapshot ? jsonParam(attempt.costRateSnapshot) : null,
                attempt.normalizedUsage ? jsonParam(attempt.normalizedUsage) : null,
                attempt.observedUsage ? jsonParam(attempt.observedUsage) : null,
                attempt.createdAt,
                attempt.updatedAt,
                attempt.completedAt || null,
            ],
        );
        return mapProviderUsageAttempt(result.rows[0]);
    }

    async updatePendingProviderAttempt(id: string, attempt: ProviderUsageAttemptRecord) {
        const result = await this.db.query(
            `UPDATE provider_usage_attempts SET status = $2, provider_idempotency_key = $3, upstream_task_id = $4,
                native_cost_amount = $5::numeric, native_cost_unit = $6::jsonb, usd_conversion_rate = $7::numeric,
                cost_usd = $8::numeric, cost_rate_snapshot = $9::jsonb, normalized_usage = $10::jsonb,
                observed_usage = $11::jsonb, completed_at = $12, updated_at = $13
             WHERE id = $1 AND status = 'pending' RETURNING *`,
            [
                id,
                attempt.status,
                attempt.providerIdempotencyKey || null,
                attempt.upstreamTaskId || null,
                attempt.nativeCostAmount,
                jsonParam(attempt.nativeCostUnit),
                attempt.usdConversionRate,
                attempt.costUsd,
                attempt.costRateSnapshot ? jsonParam(attempt.costRateSnapshot) : null,
                attempt.normalizedUsage ? jsonParam(attempt.normalizedUsage) : null,
                attempt.observedUsage ? jsonParam(attempt.observedUsage) : null,
                attempt.completedAt || null,
                attempt.updatedAt,
            ],
        );
        return result.rows[0] ? mapProviderUsageAttempt(result.rows[0]) : null;
    }

    async hasPendingProviderAttempts(holdId: string) {
        const result = await this.db.query("SELECT EXISTS (SELECT 1 FROM provider_usage_attempts WHERE hold_id = $1 AND status = 'pending') AS exists", [holdId]);
        return result.rows[0]?.exists === true;
    }

    async getTotalProviderCostUsd(holdId: string) {
        const result = await this.db.query("SELECT coalesce(sum(cost_usd), 0)::text AS total FROM provider_usage_attempts WHERE hold_id = $1", [holdId]);
        return stringValue(result.rows[0]?.total || "0");
    }

    async getReconciliationAggregate(userId: string) {
        const result = await this.db.query(
            `SELECT
                coalesce((SELECT sum(amount) FROM point_records WHERE user_id = $1), 0)::text AS ledger_balance,
                users.settled_balance::text AS settled_balance,
                coalesce((SELECT sum(amount) FROM wallet_holds WHERE user_id = $1 AND status = 'active'), 0)::text AS active_holds,
                (users.settled_balance - coalesce((SELECT sum(amount) FROM wallet_holds WHERE user_id = $1 AND status = 'active'), 0))::text AS available_balance,
                (SELECT count(*) FROM usage_charges AS charges
                  WHERE charges.user_id = $1
                    AND ((charges.settled_credits = 0 AND charges.point_record_id IS NOT NULL)
                      OR (charges.settled_credits <> 0 AND (SELECT count(*) FROM point_records AS records WHERE records.id = charges.point_record_id AND records.user_id = charges.user_id AND records.type = 'consume' AND records.amount = -charges.settled_credits) <> 1))) AS invalid_charge_count
             FROM users WHERE users.id = $1`,
            [userId],
        );
        const row = result.rows[0] || {};
        return {
            ledgerBalance: stringValue(row.ledger_balance),
            settledBalance: stringValue(row.settled_balance),
            activeHolds: stringValue(row.active_holds),
            availableBalance: stringValue(row.available_balance),
            invalidChargeCount: numberValue(row.invalid_charge_count),
        };
    }
}
