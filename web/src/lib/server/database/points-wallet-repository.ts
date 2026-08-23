import type { QueryExecutor } from "@/lib/server/database/postgres";

import type { ProviderUsageAttemptRecord, UsageChargeRecord, WalletHoldRecord } from "./repository-shared";
import { mapProviderUsageAttempt, mapUsageCharge, mapWalletHold } from "./repository-record-mappers";
import { jsonParam, numberValue, stringValue } from "./repository-shared";

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
        const result = await this.db.query(
            `INSERT INTO wallet_holds (id, user_id, business_id, request_fingerprint, amount, status, description, usage_charge_id, expires_at, closed_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [hold.id, hold.userId, hold.businessId, hold.requestFingerprint, hold.amount, hold.status, hold.description, hold.usageChargeId || null, hold.expiresAt || null, hold.closedAt || null, hold.createdAt, hold.updatedAt],
        );
        return mapWalletHold(result.rows[0]);
    }

    async closeHold(id: string, input: { status: "settled" | "released"; usageChargeId?: string; closedAt: string }) {
        const result = await this.db.query(
            `UPDATE wallet_holds SET status = $2, usage_charge_id = $3, closed_at = $4, updated_at = $4
             WHERE id = $1 AND status = 'active' RETURNING *`,
            [id, input.status, input.usageChargeId || null, input.closedAt],
        );
        return result.rows[0] ? mapWalletHold(result.rows[0]) : null;
    }

    async getActiveHeldBalance(userId: string) {
        const result = await this.db.query("SELECT coalesce(sum(amount), 0)::text AS held_balance FROM wallet_holds WHERE user_id = $1 AND status = 'active'", [userId]);
        return stringValue(result.rows[0]?.held_balance || "0");
    }

    async getUsageChargeById(id: string) {
        const result = await this.db.query("SELECT * FROM usage_charges WHERE id = $1", [id]);
        return result.rows[0] ? mapUsageCharge(result.rows[0]) : null;
    }

    async createUsageCharge(charge: UsageChargeRecord) {
        const result = await this.db.query(
            `INSERT INTO usage_charges (id, user_id, hold_id, request_fingerprint, reserved_credits, settled_credits, normalized_usage, sale_rate_snapshot, estimated, total_provider_cost_usd, margin_credits, description, point_record_id, created_at, settled_at)
             VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::jsonb, $8::jsonb, $9, $10::numeric, $11::numeric, $12, $13, $14, $15)
             RETURNING *`,
            [charge.id, charge.userId, charge.holdId, charge.requestFingerprint, charge.reservedCredits, charge.settledCredits, jsonParam(charge.normalizedUsage), jsonParam(charge.saleRateSnapshot), charge.estimated, charge.totalProviderCostUsd, charge.marginCredits, charge.description, charge.pointRecordId || null, charge.createdAt, charge.settledAt],
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

    async createProviderAttempt(attempt: ProviderUsageAttemptRecord) {
        const result = await this.db.query(
            `INSERT INTO provider_usage_attempts (id, hold_id, user_id, attempt_number, status, provider, binding_id, request_fingerprint, provider_idempotency_key, upstream_task_id, native_cost_amount, native_cost_unit, cost_usd, cost_rate_snapshot, normalized_usage, created_at, updated_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12::jsonb, $13::numeric, $14::jsonb, $15::jsonb, $16, $17, $18)
             RETURNING *`,
            [attempt.id, attempt.holdId, attempt.userId, attempt.attemptNumber, attempt.status, attempt.provider, attempt.bindingId, attempt.requestFingerprint, attempt.providerIdempotencyKey || null, attempt.upstreamTaskId || null, attempt.nativeCostAmount, jsonParam(attempt.nativeCostUnit), attempt.costUsd, attempt.costRateSnapshot ? jsonParam(attempt.costRateSnapshot) : null, attempt.normalizedUsage ? jsonParam(attempt.normalizedUsage) : null, attempt.createdAt, attempt.updatedAt, attempt.completedAt || null],
        );
        return mapProviderUsageAttempt(result.rows[0]);
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
                      OR (charges.settled_credits <> 0 AND (SELECT count(*) FROM point_records AS records WHERE records.id = charges.point_record_id AND records.type = 'consume' AND records.amount = -charges.settled_credits) <> 1))) AS invalid_charge_count
             FROM users WHERE users.id = $1`,
            [userId],
        );
        const row = result.rows[0] || {};
        return { ledgerBalance: stringValue(row.ledger_balance), settledBalance: stringValue(row.settled_balance), activeHolds: stringValue(row.active_holds), availableBalance: stringValue(row.available_balance), invalidChargeCount: numberValue(row.invalid_charge_count) };
    }
}
