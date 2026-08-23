import { randomUUID } from "node:crypto";

import { decimal } from "@/lib/billing/decimal";
import { BillingInputError } from "@/lib/server/billing-errors";
import { lockAuthMutation } from "@/lib/server/auth-mutation-lock";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, withPostgresTransaction } from "@/lib/server/database";
import { TOP_UP_ORDER_NOTIFY_CHANNEL } from "@/lib/server/database/top-up-repository";
import { getPaymentRuntimeConfig, getPaymentRuntimeValue } from "@/lib/server/payment-config-store";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { requestTopUpRefund, type TopUpRefundKind, type TopUpRefundProvider, type TopUpRefundProviderResult, type TopUpRefundStore } from "./top-up-refund";

export async function refundTopUpOrder(orderId: string, input: { kind?: TopUpRefundKind; reason?: unknown; operatorUserId: string }) {
    if (!isPostgresDatabaseEnabled()) throw new BillingInputError("充值退款需要启用 PostgreSQL", 501);
    await ensurePostgresSchema();
    return requestTopUpRefund(
        { orderId: required(orderId, "充值订单编号不能为空"), kind: input.kind || "full", reason: required(input.reason, "退款原因不能为空") },
        new PostgresTopUpRefundStore(input.operatorUserId),
        new ConfiguredTopUpRefundProvider(input.operatorUserId),
    );
}

class PostgresTopUpRefundStore implements TopUpRefundStore {
    constructor(private readonly operatorUserId: string) {}

    async getOrder(orderId: string) {
        return createPostgresRepositories().topUps.getOrderById(orderId);
    }

    async markManualReview(orderId: string, reason: string) {
        await withPostgresTransaction(async (client) => {
            const order = await createPostgresRepositories(client).topUps.getOrderById(orderId, true);
            if (!order) throw new BillingInputError("充值订单不存在", 404);
            await client.query(
                `INSERT INTO top_up_refunds (id, order_id, provider, kind, status, request_fingerprint, reason, operator_user_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'manual_review', $5, $6, $7, now(), now())
                 ON CONFLICT (order_id) DO UPDATE SET status = 'manual_review', reason = EXCLUDED.reason, operator_user_id = EXCLUDED.operator_user_id, updated_at = now()`,
                [randomUUID(), order.id, order.provider, reason === "partial" || reason === "chargeback" ? reason : "full", manualFingerprint(order.id, reason), reason, this.operatorUserId],
            );
            await client.query(
                `WITH updated_order AS (
                    UPDATE top_up_orders SET provider_refund_state = 'manual', credit_recovery_state = 'manual_review' WHERE id = $1 RETURNING id
                 ) SELECT updated_order.id, pg_notify('${TOP_UP_ORDER_NOTIFY_CHANNEL}', updated_order.id) FROM updated_order`,
                [order.id],
            );
        });
    }

    async beginRecovery(input: { orderId: string; creditAmount: string; businessId: string; requestFingerprint: string }) {
        return withPostgresTransaction(async (client) => {
            await lockAuthMutation(client);
            const repos = createPostgresRepositories(client);
            const order = await repos.topUps.getOrderById(input.orderId, true);
            if (!order) throw new BillingInputError("充值订单不存在", 404);
            if (order.creditRecoveryState === "recovered" || order.status === "refunded") return "duplicate" as const;
            const existing = await client.query("SELECT status, recovery_hold_id, request_fingerprint FROM top_up_refunds WHERE order_id = $1 FOR UPDATE", [order.id]);
            if (existing.rows[0]) {
                if (String(existing.rows[0].request_fingerprint) !== input.requestFingerprint) throw new BillingInputError("退款业务 ID 已对应不同请求", 409);
                if (existing.rows[0].status === "completed") return "duplicate" as const;
                if (existing.rows[0].status === "provider_pending" && existing.rows[0].recovery_hold_id) return "held" as const;
            }
            const user = await repos.users.getById(order.userId, true);
            if (!user) throw new BillingInputError("用户不存在", 404);
            const held = decimal(await repos.pointsWallet.getActiveHeldBalance(user.id));
            if (decimal(input.creditAmount).greaterThan(decimal(user.settledBalance).minus(held))) return "insufficient" as const;
            const holdId = randomUUID();
            await repos.pointsWallet.createHold({
                id: holdId,
                userId: user.id,
                businessId: input.businessId,
                requestFingerprint: input.requestFingerprint,
                amount: input.creditAmount,
                status: "active",
                description: `充值退款积分回收：${order.orderNo}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            await client.query(
                `INSERT INTO top_up_refunds (id, order_id, provider, kind, status, recovery_hold_id, request_fingerprint, reason, operator_user_id, created_at, updated_at)
                 VALUES ($1, $2, $3, 'full', 'provider_pending', $4, $5, 'full_refund', $6, now(), now())
                 ON CONFLICT (order_id) DO UPDATE SET status = 'provider_pending', recovery_hold_id = EXCLUDED.recovery_hold_id, request_fingerprint = EXCLUDED.request_fingerprint, operator_user_id = EXCLUDED.operator_user_id, updated_at = now()`,
                [randomUUID(), order.id, order.provider, holdId, input.requestFingerprint, this.operatorUserId],
            );
            await client.query("UPDATE top_up_orders SET status = 'refunding', provider_refund_state = 'pending', credit_recovery_state = 'held', recovery_hold_id = $2 WHERE id = $1", [order.id, holdId]);
            return "held" as const;
        });
    }

    async releaseRecovery(input: { orderId: string; businessId: string; requestFingerprint: string; reason: string }) {
        await withPostgresTransaction(async (client) => {
            await lockAuthMutation(client);
            const repos = createPostgresRepositories(client);
            const order = await repos.topUps.getOrderById(input.orderId, true);
            if (!order) throw new BillingInputError("充值订单不存在", 404);
            const refund = await client.query("SELECT recovery_hold_id, request_fingerprint, status FROM top_up_refunds WHERE order_id = $1 FOR UPDATE", [order.id]);
            const row = refund.rows[0];
            if (!row || String(row.request_fingerprint) !== input.requestFingerprint) throw new BillingInputError("退款回收记录不存在或不匹配", 409);
            if (row.status === "released" || row.status === "failed") return;
            const hold = await repos.pointsWallet.getHoldById(String(row.recovery_hold_id), true);
            if (hold?.status === "active")
                await repos.pointsWallet.closeHold(hold.id, { status: "released", releaseBusinessId: `${input.businessId}:release`, releaseRequestFingerprint: input.requestFingerprint, releaseReason: input.reason, closedAt: new Date().toISOString() });
            await client.query("UPDATE top_up_refunds SET status = 'failed', updated_at = now() WHERE order_id = $1", [order.id]);
            await client.query("UPDATE top_up_orders SET status = 'paid', provider_refund_state = 'failed', credit_recovery_state = 'released' WHERE id = $1", [order.id]);
        });
    }

    async finalizeRecovery(input: { orderId: string; creditAmount: string; businessId: string; requestFingerprint: string; providerRefund: TopUpRefundProviderResult }) {
        return withPostgresTransaction(async (client) => {
            await lockAuthMutation(client);
            const repos = createPostgresRepositories(client);
            const order = await repos.topUps.getOrderById(input.orderId, true);
            if (!order) throw new BillingInputError("充值订单不存在", 404);
            if (order.creditRecoveryState === "recovered" || order.status === "refunded") return "duplicate" as const;
            const refund = await client.query("SELECT recovery_hold_id, request_fingerprint, status FROM top_up_refunds WHERE order_id = $1 FOR UPDATE", [order.id]);
            const row = refund.rows[0];
            if (!row || String(row.request_fingerprint) !== input.requestFingerprint || row.status !== "provider_pending") throw new BillingInputError("退款回收状态不可结算", 409);
            const hold = await repos.pointsWallet.getHoldById(String(row.recovery_hold_id), true);
            if (!hold || hold.status !== "active" || hold.amount !== input.creditAmount) throw new BillingInputError("退款回收预留无效", 409);
            const user = await repos.users.getById(order.userId, true);
            if (!user) throw new BillingInputError("用户不存在", 404);
            const nextBalance = decimal(user.settledBalance).minus(decimal(input.creditAmount));
            if (nextBalance.isNegative()) throw new BillingInputError("退款回收余额不足，必须人工复核", 409);
            const recordId = randomUUID();
            await repos.users.update(user.id, { settledBalance: nextBalance.toString() });
            await repos.points.addRecord({
                id: recordId,
                userId: user.id,
                type: "refund",
                amount: `-${decimal(input.creditAmount).toString()}`,
                balanceAfter: nextBalance.toString(),
                description: `充值退款积分回收：${order.orderNo}`,
                idempotencyKey: input.businessId,
                requestFingerprint: input.requestFingerprint,
                sourceRecordId: order.id,
                createdAt: new Date().toISOString(),
            });
            await repos.pointsWallet.closeHold(hold.id, { status: "settled", closedAt: new Date().toISOString() });
            await client.query(`UPDATE top_up_refunds SET status = 'completed', provider_refund_id = $2, raw_payload = $3::jsonb, completed_at = now(), updated_at = now() WHERE order_id = $1`, [
                order.id,
                input.providerRefund.providerRefundId || null,
                JSON.stringify(input.providerRefund.rawPayload || {}),
            ]);
            await client.query(
                `WITH updated_order AS (
                    UPDATE top_up_orders SET status = 'refunded', payment_state = 'refunded', provider_refund_state = 'succeeded', credit_recovery_state = 'recovered', reversal_point_record_id = $2, closed_at = now() WHERE id = $1 RETURNING id
                 ) SELECT updated_order.id, pg_notify('${TOP_UP_ORDER_NOTIFY_CHANNEL}', updated_order.id) FROM updated_order`,
                [order.id, recordId],
            );
            return "applied" as const;
        });
    }
}

class ConfiguredTopUpRefundProvider implements TopUpRefundProvider {
    constructor(private readonly operatorUserId: string) {}

    async refund(order: Parameters<TopUpRefundProvider["refund"]>[0], context: Parameters<TopUpRefundProvider["refund"]>[1]) {
        if (order.provider !== "stripe") return { status: "manual" as const, rawPayload: { provider: order.provider, reason: "automatic_refund_not_configured" } };
        const config = await getPaymentRuntimeConfig();
        const secret = getPaymentRuntimeValue(config, "VOZEB_PRO_STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY");
        if (!secret || !order.providerPaymentId) return { status: "manual" as const, rawPayload: { provider: "stripe", reason: "missing_refund_configuration" } };
        const params = new URLSearchParams({ payment_intent: order.providerPaymentId, amount: order.paymentAmount.kind === "fiat" ? order.paymentAmount.amountMinor : "", reason: "requested_by_customer" });
        params.set("metadata[orderId]", order.id);
        params.set("metadata[operatorUserId]", this.operatorUserId);
        params.set("metadata[creditRecoveryAmount]", context.recoveryHeldAmount);
        const response = await fetchSafeOutbound("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded", "Idempotency-Key": `vozeb-pro-top-up-refund-${order.id}` },
            body: params,
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok || payload.status !== "succeeded") return { status: "failed" as const, rawPayload: payload };
        return { status: "succeeded" as const, providerRefundId: typeof payload.id === "string" ? payload.id : undefined, rawPayload: payload };
    }
}

function required(value: unknown, message: string) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) throw new BillingInputError(message);
    return normalized;
}

function manualFingerprint(orderId: string, reason: string) {
    return `${orderId}:${reason}`;
}
