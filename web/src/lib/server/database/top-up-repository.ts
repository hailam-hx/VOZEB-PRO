import { validatePaymentAmount } from "@/lib/billing/money";
import { decimal } from "@/lib/billing/decimal";
import type { TopUpOrder } from "@/lib/server/top-up-payment";
import type { TopUpPreset } from "@/lib/server/top-up-pricing";
import type { TopUpReconciliationRowRecord, TopUpReconciliationRunRecord } from "./repository-types";
import type { QueryExecutor } from "./postgres";
import { jsonParam, jsonValue, numberValue, optionalIso, optionalJson, optionalString, stringValue } from "./repository-utils";

export const TOP_UP_ORDER_NOTIFY_CHANNEL = "vozeb_pro_top_up_order_events";

export class TopUpRepository {
    constructor(private readonly db: QueryExecutor) {}

    async listPresets(includeDisabled = false) {
        const result = await this.db.query("SELECT * FROM top_up_presets WHERE ($1::boolean = true OR enabled = true) ORDER BY sort_order ASC, id ASC", [includeDisabled]);
        return result.rows.map(mapTopUpPresetRow);
    }

    async getPresetById(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT * FROM top_up_presets WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? mapTopUpPresetRow(result.rows[0]) : null;
    }

    async savePreset(preset: TopUpPreset) {
        const result = await this.db.query(
            `INSERT INTO top_up_presets (id, name, description, nominal_native_amount, enabled, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4::numeric, $5, $6, now(), now())
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
                 nominal_native_amount = EXCLUDED.nominal_native_amount, enabled = EXCLUDED.enabled, sort_order = EXCLUDED.sort_order
             RETURNING *`,
            [preset.id, preset.name, preset.description, preset.nominalNativeAmount, preset.enabled, preset.sortOrder],
        );
        return mapTopUpPresetRow(result.rows[0]);
    }

    async deletePreset(id: string) {
        const result = await this.db.query("DELETE FROM top_up_presets WHERE id = $1 RETURNING id", [id]);
        return Boolean(result.rows[0]);
    }

    async getPromotion(id: string, presetId?: string) {
        const result = await this.db.query(
            `SELECT * FROM top_up_promotions WHERE id = $1 AND enabled = true AND starts_at <= now() AND ends_at > now()
             AND (preset_id IS NULL OR preset_id = $2::text)`,
            [id, presetId || null],
        );
        const row = result.rows[0];
        return row
            ? { id: stringValue(row.id), label: stringValue(row.label), type: row.discount_type === "percentage" ? ("percentage" as const) : ("fixed" as const), value: stringValue(row.discount_value), currency: optionalString(row.currency) }
            : null;
    }

    async getAvailableCoupon(id: string, userId: string, forUpdate = false) {
        const result = await this.db.query(
            `SELECT coupons.id, coupons.template_id, templates.discount_type, templates.discount_value, templates.currency
             FROM top_up_user_coupons coupons JOIN top_up_coupon_templates templates ON templates.id = coupons.template_id
             WHERE coupons.id = $1 AND coupons.user_id = $2 AND coupons.status = 'available' AND coupons.expires_at > now()
               AND templates.enabled = true AND templates.starts_at <= now() AND templates.ends_at > now()${forUpdate ? " FOR UPDATE OF coupons" : ""}`,
            [id, userId],
        );
        const row = result.rows[0];
        return row
            ? {
                  userCouponId: stringValue(row.id),
                  templateId: stringValue(row.template_id),
                  type: row.discount_type === "percentage" ? ("percentage" as const) : ("fixed" as const),
                  value: stringValue(row.discount_value),
                  currency: optionalString(row.currency),
              }
            : null;
    }

    async getCouponTemplate(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT id, enabled FROM top_up_coupon_templates WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? { id: stringValue(result.rows[0].id), enabled: result.rows[0].enabled === true } : null;
    }

    async lockCoupon(id: string, orderId: string) {
        const result = await this.db.query("UPDATE top_up_user_coupons SET status = 'locked', locked_order_id = $2, locked_at = now(), updated_at = now() WHERE id = $1 AND status = 'available' RETURNING id", [id, orderId]);
        return Boolean(result.rows[0]);
    }

    async redeemCouponForOrder(id: string, orderId: string) {
        const result = await this.db.query("UPDATE top_up_user_coupons SET status = 'redeemed', redeemed_order_id = $2, redeemed_at = now(), updated_at = now() WHERE id = $1 AND status = 'locked' AND locked_order_id = $2 RETURNING id", [id, orderId]);
        return Boolean(result.rows[0]);
    }

    async releaseCouponForOrder(id: string, orderId: string) {
        const result = await this.db.query("UPDATE top_up_user_coupons SET status = 'available', locked_order_id = NULL, locked_at = NULL, updated_at = now() WHERE id = $1 AND status = 'locked' AND locked_order_id = $2 RETURNING id", [id, orderId]);
        return Boolean(result.rows[0]);
    }

    async issueReferralCoupon(input: { id: string; userId: string; templateId: string; now: string }) {
        const template = await this.db.query("SELECT * FROM top_up_coupon_templates WHERE id = $1 AND enabled = true AND starts_at <= $2::timestamptz AND ends_at > $2::timestamptz FOR UPDATE", [input.templateId, input.now]);
        if (!template.rows[0]) return null;
        const result = await this.db.query(
            `INSERT INTO top_up_user_coupons (id, template_id, user_id, status, grant_source, expires_at, created_at, updated_at)
             VALUES ($1, $2, $3, 'available', 'referral', $4, $5, $5)
             ON CONFLICT DO NOTHING RETURNING id`,
            [input.id, input.templateId, input.userId, template.rows[0].ends_at, input.now],
        );
        return result.rows[0] ? stringValue(result.rows[0].id) : null;
    }

    async getUserCouponState(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT id, status FROM top_up_user_coupons WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? { id: stringValue(result.rows[0].id), status: stringValue(result.rows[0].status) } : null;
    }

    async revokeAvailableCoupon(id: string, revokedAt: string) {
        const result = await this.db.query("UPDATE top_up_user_coupons SET status = 'revoked', updated_at = $2 WHERE id = $1 AND status = 'available' RETURNING id", [id, revokedAt]);
        return Boolean(result.rows[0]);
    }

    async getOrderById(id: string, forUpdate = false) {
        const result = await this.db.query(`SELECT * FROM top_up_orders WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? mapTopUpOrderRow(result.rows[0]) : null;
    }

    async getOrderByOrderNo(orderNo: string) {
        const result = await this.db.query("SELECT * FROM top_up_orders WHERE order_no = $1", [orderNo]);
        return result.rows[0] ? mapTopUpOrderRow(result.rows[0]) : null;
    }

    async getOrderByProviderIdentifiers(provider: string, identifiers: string[]) {
        const values = [...new Set(identifiers.map((value) => value.trim()).filter(Boolean))];
        if (!values.length) return null;
        const result = await this.db.query(`SELECT * FROM top_up_orders WHERE provider = $1 AND (provider_order_id = ANY($2::text[]) OR provider_payment_id = ANY($2::text[])) ORDER BY created_at DESC LIMIT 1`, [provider, values]);
        return result.rows[0] ? mapTopUpOrderRow(result.rows[0]) : null;
    }

    async listPaymentsByOrderId(orderId: string) {
        const result = await this.db.query("SELECT * FROM top_up_payments WHERE order_id = $1 ORDER BY created_at ASC", [orderId]);
        return result.rows.map(mapTopUpPaymentRow);
    }

    async listPayments(input: { userId: string; page: number; pageSize: number }) {
        const result = await this.db.query("SELECT *, count(*) OVER()::int AS total FROM top_up_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [input.userId, input.pageSize, (input.page - 1) * input.pageSize]);
        return { items: result.rows.map(mapTopUpPaymentRow), total: numberValue(result.rows[0]?.total), page: input.page, pageSize: input.pageSize };
    }

    async listUserCoupons(input: { userId: string; page: number; pageSize: number }) {
        const result = await this.db.query("SELECT id, template_id, status, expires_at, created_at, count(*) OVER()::int AS total FROM top_up_user_coupons WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [input.userId, input.pageSize, (input.page - 1) * input.pageSize]);
        return { items: result.rows.map((row) => ({ id: stringValue(row.id), templateId: stringValue(row.template_id), status: stringValue(row.status), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) })), total: numberValue(result.rows[0]?.total), page: input.page, pageSize: input.pageSize };
    }

    async getPaymentByProviderIdentifiers(provider: string, identifiers: string[]) {
        const values = [...new Set(identifiers.map((value) => value.trim()).filter(Boolean))];
        if (!values.length) return null;
        const result = await this.db.query(`SELECT * FROM top_up_payments WHERE provider = $1 AND (provider_trade_id = ANY($2::text[]) OR provider_payment_id = ANY($2::text[])) ORDER BY created_at DESC LIMIT 1`, [provider, values]);
        return result.rows[0] ? mapTopUpPaymentRow(result.rows[0]) : null;
    }

    async listOrdersForUser(userId: string, input: { page?: number; pageSize?: number } = {}) {
        const page = Math.max(1, Math.floor(input.page || 1));
        const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize || 20)));
        const result = await this.db.query(`SELECT orders.*, count(*) OVER() AS total_count FROM top_up_orders orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [userId, pageSize, (page - 1) * pageSize]);
        return { items: result.rows.map(mapTopUpOrderRow), total: numberValue(result.rows[0]?.total_count), page, pageSize };
    }

    async listOrders(input: { page?: number; pageSize?: number; userId?: string; status?: TopUpOrder["status"]; keyword?: string } = {}) {
        const page = Math.max(1, Math.floor(input.page || 1));
        const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize || 20)));
        const keyword = input.keyword?.trim().toLowerCase() || "";
        const result = await this.db.query(
            `SELECT orders.*, count(*) OVER() AS total_count FROM top_up_orders orders
             WHERE ($1::text IS NULL OR user_id = $1::text)
               AND ($2::text IS NULL OR status = $2::text)
               AND ($3::text = '' OR lower(order_no) LIKE $4::text OR lower(subject) LIKE $4::text OR lower(coalesce(provider_payment_id, '')) LIKE $4::text)
             ORDER BY created_at DESC, id DESC LIMIT $5 OFFSET $6`,
            [input.userId || null, input.status || null, keyword, `%${keyword}%`, pageSize, (page - 1) * pageSize],
        );
        return { items: result.rows.map(mapTopUpOrderRow), total: numberValue(result.rows[0]?.total_count), page, pageSize };
    }

    async createOrder(order: TopUpOrder) {
        const result = await this.db.query(
            `INSERT INTO top_up_orders (
                id, order_no, preset_id, user_id, status, payment_state, credit_grant_state, provider_refund_state, credit_recovery_state,
                nominal_native_amount, promotion_discount_native_amount, coupon_discount_native_amount, payable_native_amount, nominal_usd_value, paid_usd_value, credit_amount, customer_fx_rate,
                subject, currency, currency_exponent, pricing_version, customer_fx_version, payment_kind, payment_amount, provider, provider_order_id, provider_payment_id,
                promotion_campaign_id, user_coupon_id, snapshot, metadata, expires_at, paid_at, closed_at, created_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric,
                $18, $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27,
                $28, $29, $30::jsonb, $31::jsonb, $32, $33, $34, $35, $36
             ) RETURNING *`,
            [
                order.id,
                order.orderNo,
                order.presetId || null,
                order.userId,
                order.status,
                order.paymentState,
                order.creditGrantState,
                order.providerRefundState,
                order.creditRecoveryState,
                order.nominalNativeAmount,
                order.promotionDiscountNativeAmount,
                order.couponDiscountNativeAmount,
                order.payableNativeAmount,
                order.nominalUsdValue,
                order.paidUsdValue,
                order.creditAmount,
                order.customerFxRate,
                order.subject,
                order.currency,
                order.currencyExponent,
                order.pricingVersion,
                order.customerFxVersion,
                order.paymentAmount.kind,
                jsonParam(order.paymentAmount),
                order.provider,
                order.providerOrderId || null,
                order.providerPaymentId || null,
                order.promotionCampaignId || null,
                order.userCouponId || null,
                jsonParam(order.snapshot || {}),
                jsonParam(order.metadata || {}),
                order.expiresAt || null,
                order.paidAt || null,
                order.closedAt || null,
                order.createdAt,
                order.updatedAt,
            ],
        );
        return mapTopUpOrderRow(result.rows[0]);
    }

    async updateCheckout(id: string, input: { providerOrderId?: string; providerPaymentId?: string; metadata: TopUpOrder["metadata"] }) {
        const result = await this.db.query(
            `UPDATE top_up_orders
             SET provider_order_id = $2, provider_payment_id = $3, metadata = $4::jsonb
             WHERE id = $1
             RETURNING *`,
            [id, input.providerOrderId || null, input.providerPaymentId || null, jsonParam(input.metadata || {})],
        );
        return result.rows[0] ? mapTopUpOrderRow(result.rows[0]) : null;
    }

    async cancelPendingOrder(id: string, userId: string) {
        const result = await this.db.query("UPDATE top_up_orders SET status = 'canceled', closed_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *", [id, userId]);
        return result.rows[0] ? mapTopUpOrderRow(result.rows[0]) : null;
    }

    async expirePendingOrder(id: string, confirmedAt: string) {
        const result = await this.db.query(
            `WITH expired AS (
                UPDATE top_up_orders SET status = 'canceled', closed_at = $2::timestamptz, updated_at = $2::timestamptz
                WHERE id = $1 AND status = 'pending' AND expires_at <= $2::timestamptz RETURNING *
             ), released AS (
                UPDATE top_up_user_coupons SET status = 'available', locked_order_id = NULL, locked_at = NULL, updated_at = $2::timestamptz
                FROM expired WHERE top_up_user_coupons.id = expired.user_coupon_id AND top_up_user_coupons.status = 'locked' AND top_up_user_coupons.locked_order_id = expired.id
             ) SELECT * FROM expired`,
            [id, confirmedAt],
        );
        return result.rows[0] ? mapTopUpOrderRow(result.rows[0]) : null;
    }

    async getFinancialSummary(input: { startAt?: string; endBefore?: string } = {}) {
        const result = await this.db.query(
            `SELECT currency,
                    coalesce(sum(payable_native_amount) FILTER (WHERE payment_state = 'paid'), 0)::text AS paid_native_amount,
                    coalesce(sum(payable_native_amount) FILTER (WHERE payment_state = 'refunded'), 0)::text AS refunded_native_amount,
                    count(*) FILTER (WHERE payment_state = 'paid')::int AS paid_orders,
                    count(*) FILTER (WHERE payment_state = 'refunded')::int AS refunded_orders,
                    coalesce(sum(paid_usd_value) FILTER (WHERE payment_state = 'paid'), 0)::text AS paid_usd_value,
                    coalesce(sum(paid_usd_value) FILTER (WHERE payment_state = 'refunded'), 0)::text AS refunded_usd_value,
                    coalesce(sum(nominal_usd_value) FILTER (WHERE payment_state IN ('paid', 'refunded')), 0)::text AS nominal_usd_value
             FROM top_up_orders
             WHERE ($1::timestamptz IS NULL OR created_at >= $1::timestamptz)
               AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
             GROUP BY currency
             ORDER BY currency ASC`,
            [input.startAt || null, input.endBefore || null],
        );
        const currencies = result.rows.map((row) => ({
            currency: stringValue(row.currency),
            paidNativeAmount: stringValue(row.paid_native_amount),
            refundedNativeAmount: stringValue(row.refunded_native_amount),
            paidOrders: numberValue(row.paid_orders),
            refundedOrders: numberValue(row.refunded_orders),
        }));
        return {
            currencies,
            paidUsdValue: result.rows.reduce((sum, row) => sum.plus(decimal(stringValue(row.paid_usd_value))), decimal(0)).toString(),
            refundedUsdValue: result.rows.reduce((sum, row) => sum.plus(decimal(stringValue(row.refunded_usd_value))), decimal(0)).toString(),
            nominalUsdValue: result.rows.reduce((sum, row) => sum.plus(decimal(stringValue(row.nominal_usd_value))), decimal(0)).toString(),
        };
    }

    async createReconciliationRun(run: TopUpReconciliationRunRecord, rows: TopUpReconciliationRowRecord[]) {
        const inserted = await this.db.query(
            `INSERT INTO top_up_reconciliation_runs (
                id, provider, source, status, total_rows, matched_rows, ok_rows, issue_rows,
                statement_paid_amount, statement_refunded_amount, local_paid_amount, local_refunded_amount, difference_amount, difference_direction,
                local_nominal_usd_value, local_paid_usd_value, imported_by_user_id, imported_by_username,
                file_name, file_hash, note, metadata, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::numeric,$16::numeric,$17,$18,$19,$20,$21,$22::jsonb,$23,$24)
             ON CONFLICT DO NOTHING RETURNING *`,
            [run.id, run.provider, run.source, run.status, run.totalRows, run.matchedRows, run.okRows, run.issueRows, jsonParam(run.statementPaidAmount), jsonParam(run.statementRefundedAmount), jsonParam(run.localPaidAmount), jsonParam(run.localRefundedAmount), jsonParam(run.differenceAmount), run.differenceDirection, run.localNominalUsdValue, run.localPaidUsdValue, run.importedByUserId || null, run.importedByUsername || null, run.fileName || null, run.fileHash || null, run.note || null, jsonParam(run.metadata || {}), run.createdAt, run.updatedAt],
        );
        if (!inserted.rows[0]) return null;
        for (const row of rows) {
            await this.db.query(
                `INSERT INTO top_up_reconciliation_rows (
                    id, run_id, row_number, row_key, provider, order_no, provider_order_id, provider_payment_id,
                    statement_status, statement_payment_amount, local_order_id, local_order_no, local_order_status,
                    local_payment_amount, local_nominal_native_amount, local_payable_native_amount,
                    local_nominal_usd_value, local_paid_usd_value, issue_codes, issues, created_at, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15::numeric,$16::numeric,$17::numeric,$18::numeric,$19::jsonb,$20::jsonb,$21,$22)`,
                [row.id, row.runId, row.rowNumber, row.rowKey, row.provider, row.orderNo || null, row.providerOrderId || null, row.providerPaymentId || null, row.statementStatus, jsonParam(row.statementPaymentAmount), row.localOrderId || null, row.localOrderNo || null, row.localOrderStatus || null, jsonParam(row.localPaymentAmount), row.localNominalNativeAmount || null, row.localPayableNativeAmount || null, row.localNominalUsdValue || null, row.localPaidUsdValue || null, jsonParam(row.issueCodes), jsonParam(row.issues), row.createdAt, row.updatedAt],
            );
        }
        return mapReconciliationRun(inserted.rows[0]);
    }

    async getReconciliationRunByFileHash(provider: string, fileHash: string) {
        const result = await this.db.query("SELECT * FROM top_up_reconciliation_runs WHERE provider = $1 AND file_hash = $2 LIMIT 1", [provider, fileHash]);
        return result.rows[0] ? mapReconciliationRun(result.rows[0]) : null;
    }

    async getReconciliationRun(id: string) {
        const result = await this.db.query("SELECT * FROM top_up_reconciliation_runs WHERE id = $1", [id]);
        return result.rows[0] ? mapReconciliationRun(result.rows[0]) : null;
    }

    async listReconciliationRuns(input: { page: number; pageSize: number; provider?: string }) {
        const offset = (input.page - 1) * input.pageSize;
        const result = await this.db.query(`SELECT *, count(*) OVER()::int AS total FROM top_up_reconciliation_runs WHERE ($1::text IS NULL OR provider = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [input.provider || null, input.pageSize, offset]);
        return { items: result.rows.map(mapReconciliationRun), total: numberValue(result.rows[0]?.total), page: input.page, pageSize: input.pageSize };
    }

    async listReconciliationRows(input: { runId: string; page: number; pageSize: number }) {
        const offset = (input.page - 1) * input.pageSize;
        const result = await this.db.query("SELECT *, count(*) OVER()::int AS total FROM top_up_reconciliation_rows WHERE run_id = $1 ORDER BY row_number ASC LIMIT $2 OFFSET $3", [input.runId, input.pageSize, offset]);
        return { items: result.rows.map(mapReconciliationRow), total: numberValue(result.rows[0]?.total), page: input.page, pageSize: input.pageSize };
    }
}

function mapReconciliationRun(row: Record<string, unknown>): TopUpReconciliationRunRecord {
    return { id: stringValue(row.id), provider: stringValue(row.provider), source: row.source === "provider-api" || row.source === "manual" ? row.source : "csv", status: row.status === "failed" ? "failed" : "completed", totalRows: numberValue(row.total_rows), matchedRows: numberValue(row.matched_rows), okRows: numberValue(row.ok_rows), issueRows: numberValue(row.issue_rows), statementPaidAmount: jsonValue(row.statement_paid_amount), statementRefundedAmount: jsonValue(row.statement_refunded_amount), localPaidAmount: jsonValue(row.local_paid_amount), localRefundedAmount: jsonValue(row.local_refunded_amount), differenceAmount: jsonValue(row.difference_amount), differenceDirection: row.difference_direction === "statement_over" || row.difference_direction === "local_over" ? row.difference_direction : "balanced", localNominalUsdValue: stringValue(row.local_nominal_usd_value), localPaidUsdValue: stringValue(row.local_paid_usd_value), importedByUserId: optionalString(row.imported_by_user_id), importedByUsername: optionalString(row.imported_by_username), fileName: optionalString(row.file_name), fileHash: optionalString(row.file_hash), note: optionalString(row.note), metadata: optionalJson(row.metadata), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function mapReconciliationRow(row: Record<string, unknown>): TopUpReconciliationRowRecord {
    return { id: stringValue(row.id), runId: stringValue(row.run_id), rowNumber: numberValue(row.row_number), rowKey: stringValue(row.row_key), provider: stringValue(row.provider), orderNo: optionalString(row.order_no), providerOrderId: optionalString(row.provider_order_id), providerPaymentId: optionalString(row.provider_payment_id), statementStatus: row.statement_status === "paid" || row.statement_status === "refunded" || row.statement_status === "pending" || row.statement_status === "failed" ? row.statement_status : "unknown", statementPaymentAmount: optionalJson(row.statement_payment_amount), localOrderId: optionalString(row.local_order_id), localOrderNo: optionalString(row.local_order_no), localOrderStatus: optionalString(row.local_order_status), localPaymentAmount: optionalJson(row.local_payment_amount), localNominalNativeAmount: optionalString(row.local_nominal_native_amount), localPayableNativeAmount: optionalString(row.local_payable_native_amount), localNominalUsdValue: optionalString(row.local_nominal_usd_value), localPaidUsdValue: optionalString(row.local_paid_usd_value), issueCodes: jsonValue(row.issue_codes), issues: jsonValue(row.issues), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function mapTopUpPaymentRow(row: Record<string, unknown>) {
    return {
        id: stringValue(row.id),
        orderId: stringValue(row.order_id),
        userId: stringValue(row.user_id),
        provider: stringValue(row.provider),
        status: row.status === "refunded" ? ("refunded" as const) : row.status === "succeeded" ? ("succeeded" as const) : row.status === "failed" ? ("failed" as const) : ("pending" as const),
        amountMinor: stringValue(row.amount_minor),
        currency: stringValue(row.fiat_currency),
        providerTradeId: optionalString(row.provider_trade_id),
        providerPaymentId: optionalString(row.provider_payment_id),
    };
}

export function mapTopUpPresetRow(row: Record<string, unknown>): TopUpPreset {
    return {
        id: stringValue(row.id),
        name: stringValue(row.name),
        description: stringValue(row.description),
        nominalNativeAmount: stringValue(row.nominal_native_amount),
        enabled: row.enabled === true,
        sortOrder: numberValue(row.sort_order),
    };
}

export function mapTopUpOrderRow(row: Record<string, unknown>): TopUpOrder {
    const currency = stringValue(row.currency);
    const exponent = numberValue(row.currency_exponent);
    if (currency !== "VND" || exponent !== 0) throw new Error("充值订单币种快照无效");
    return {
        id: stringValue(row.id),
        orderNo: stringValue(row.order_no),
        userId: stringValue(row.user_id),
        status: orderStatus(row.status),
        paymentState: paymentState(row.payment_state),
        creditGrantState: grantState(row.credit_grant_state),
        providerRefundState: providerRefundState(row.provider_refund_state),
        creditRecoveryState: recoveryState(row.credit_recovery_state),
        subject: stringValue(row.subject),
        ...(optionalString(row.preset_id) ? { presetId: optionalString(row.preset_id) } : {}),
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: stringValue(row.nominal_native_amount),
        promotionDiscountNativeAmount: stringValue(row.promotion_discount_native_amount),
        couponDiscountNativeAmount: stringValue(row.coupon_discount_native_amount),
        payableNativeAmount: stringValue(row.payable_native_amount),
        nominalUsdValue: stringValue(row.nominal_usd_value),
        paidUsdValue: stringValue(row.paid_usd_value),
        creditAmount: stringValue(row.credit_amount),
        pricingVersion: stringValue(row.pricing_version),
        customerFxVersion: stringValue(row.customer_fx_version),
        customerFxRate: stringValue(row.customer_fx_rate),
        paymentAmount: validatePaymentAmount(jsonValue(row.payment_amount)),
        provider: stringValue(row.provider),
        ...(optionalString(row.provider_order_id) ? { providerOrderId: optionalString(row.provider_order_id) } : {}),
        ...(optionalString(row.provider_payment_id) ? { providerPaymentId: optionalString(row.provider_payment_id) } : {}),
        ...(optionalString(row.promotion_campaign_id) ? { promotionCampaignId: optionalString(row.promotion_campaign_id) } : {}),
        ...(optionalString(row.user_coupon_id) ? { userCouponId: optionalString(row.user_coupon_id) } : {}),
        ...(optionalJson(row.snapshot) ? { snapshot: optionalJson(row.snapshot) } : {}),
        ...(optionalJson(row.metadata) ? { metadata: optionalJson(row.metadata) } : {}),
        ...(optionalIso(row.expires_at) ? { expiresAt: optionalIso(row.expires_at) } : {}),
        ...(optionalIso(row.paid_at) ? { paidAt: optionalIso(row.paid_at) } : {}),
        ...(optionalIso(row.closed_at) ? { closedAt: optionalIso(row.closed_at) } : {}),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

function orderStatus(value: unknown): TopUpOrder["status"] {
    return value === "paid" || value === "canceled" || value === "refunding" || value === "refunded" ? value : "pending";
}
function paymentState(value: unknown): TopUpOrder["paymentState"] {
    return value === "paid" || value === "failed" || value === "refunded" ? value : "pending";
}
function grantState(value: unknown): TopUpOrder["creditGrantState"] {
    return value === "granted" || value === "manual_review" ? value : "pending";
}
function providerRefundState(value: unknown): TopUpOrder["providerRefundState"] {
    return value === "pending" || value === "succeeded" || value === "failed" || value === "manual" ? value : "none";
}
function recoveryState(value: unknown): TopUpOrder["creditRecoveryState"] {
    return value === "held" || value === "recovered" || value === "released" || value === "manual_review" ? value : "none";
}
function iso(value: unknown) {
    const parsed = optionalIso(value);
    if (!parsed) throw new Error("充值订单时间无效");
    return parsed;
}
