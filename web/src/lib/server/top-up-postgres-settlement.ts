import { createHash, randomUUID } from "node:crypto";

import { decimal } from "@/lib/billing/decimal";
import { BillingInputError } from "@/lib/server/billing-errors";
import { lockAuthMutation } from "@/lib/server/auth-mutation-lock";
import { createPostgresRepositories, withPostgresTransaction } from "@/lib/server/database";
import { TOP_UP_ORDER_NOTIFY_CHANNEL } from "@/lib/server/database/top-up-repository";
import { prepareReferralRewardsForPaidOrder } from "@/lib/server/referral-service";
import type { TopUpPaymentSettlementStore } from "./top-up-payment";

export class PostgresTopUpPaymentStore implements TopUpPaymentSettlementStore {
    async getLockedOrder(orderId: string) {
        return createPostgresRepositories().topUps.getOrderById(orderId);
    }

    async settle(input: Parameters<TopUpPaymentSettlementStore["settle"]>[0]) {
        return withPostgresTransaction(async (client) => {
            await lockAuthMutation(client);
            const repos = createPostgresRepositories(client);
            const order = await repos.topUps.getOrderById(input.order.id, true);
            if (!order) throw new BillingInputError("充值订单不存在", 404);
            if (order.userId !== input.order.userId || order.creditAmount !== input.creditAmount || JSON.stringify(order.paymentAmount) !== JSON.stringify(input.order.paymentAmount)) {
                throw new BillingInputError("充值订单权威快照已变化", 409);
            }
            const eventInsert = await client.query(
                `INSERT INTO top_up_payment_events (id, provider, event_id, event_type, order_id, payload_fingerprint, signature_valid, status, payload, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, true, 'processing', $7::jsonb, now(), now())
                 ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
                [randomUUID(), input.event.provider, input.event.eventId, input.event.eventType, order.id, input.eventFingerprint, JSON.stringify(input.event.rawPayload || {})],
            );
            if (!eventInsert.rowCount) {
                const existing = await client.query("SELECT id, payload_fingerprint, status FROM top_up_payment_events WHERE provider = $1 AND event_id = $2 FOR UPDATE", [input.event.provider, input.event.eventId]);
                const event = existing.rows[0];
                if (!event || String(event.payload_fingerprint) !== input.eventFingerprint) return "conflict" as const;
                if (event.status === "processed") return "duplicate" as const;
            }
            if (order.creditGrantState === "granted") {
                await markEventProcessed(client, input.event.provider, input.event.eventId);
                return "duplicate" as const;
            }
            if (order.status !== "pending" || order.paymentState !== "pending") throw new BillingInputError("充值订单支付状态不可授信", 409);
            const amount = input.event.amount;
            if (amount.kind !== "fiat") throw new BillingInputError("V1 暂未开放加密货币充值", 400);
            const paidAt = input.event.paidAt || new Date().toISOString();
            const paymentId = `top-up-payment:${input.event.provider}:${input.event.providerPaymentId}`;
            const paymentSnapshotFingerprint = authoritativeOrderFingerprint(order);
            const paymentInsert = await client.query(
                `INSERT INTO top_up_payments (id, order_id, user_id, provider, provider_event_id, order_snapshot_fingerprint, status, payment_kind, fiat_currency, amount_minor, minor_unit_exponent, provider_trade_id, provider_payment_id, raw_payload, paid_at, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', 'fiat', $7, $8::numeric, $9, $10, $11, $12::jsonb, $13, $13, $13)
                 ON CONFLICT DO NOTHING RETURNING id`,
                [paymentId, order.id, order.userId, input.event.provider, input.event.eventId, paymentSnapshotFingerprint, amount.currency, amount.amountMinor, amount.minorUnitExponent, input.event.providerOrderId || null, input.event.providerPaymentId, JSON.stringify(input.event.rawPayload || {}), paidAt],
            );
            if (!paymentInsert.rowCount) {
                const existing = await client.query("SELECT * FROM top_up_payments WHERE provider = $1 AND provider_payment_id = $2 FOR UPDATE", [input.event.provider, input.event.providerPaymentId]);
                if (!sameOwnedPayment(existing.rows[0], { paymentId, order, eventId: input.event.eventId, provider: input.event.provider, amount, providerTradeId: input.event.providerOrderId, providerPaymentId: input.event.providerPaymentId, paymentSnapshotFingerprint })) {
                    throw new BillingInputError("支付身份已归属于不同充值订单或快照", 409);
                }
                await markEventProcessed(client, input.event.provider, input.event.eventId);
                return "duplicate" as const;
            }
            const user = await repos.users.getById(order.userId, true);
            if (!user || user.status !== "active") throw new BillingInputError("用户不可用", 403);
            const existingRecord = await repos.points.getRecordByIdempotencyKey(input.businessId);
            let pointRecordId = existingRecord?.id;
            if (existingRecord) {
                if (existingRecord.userId !== user.id || existingRecord.amount !== input.creditAmount || existingRecord.type !== "credit") throw new BillingInputError("充值授信业务 ID 已对应不同流水", 409);
            } else {
                const nextBalance = decimal(user.settledBalance).plus(decimal(input.creditAmount)).toString();
                const updated = await repos.users.update(user.id, { settledBalance: nextBalance });
                if (!updated) throw new BillingInputError("用户不存在", 404);
                const record = await repos.points.addRecord({
                    id: randomUUID(),
                    userId: user.id,
                    type: "credit",
                    amount: input.creditAmount,
                    balanceAfter: nextBalance,
                    description: `充值订单支付：${order.subject}`,
                    idempotencyKey: input.businessId,
                    requestFingerprint: input.requestFingerprint,
                    sourceRecordId: order.id,
                    createdAt: input.event.paidAt || new Date().toISOString(),
                });
                pointRecordId = record.id;
            }
            const updatedOrder = await client.query(
                `WITH updated_order AS (
                    UPDATE top_up_orders SET status = 'paid', payment_state = 'paid', credit_grant_state = 'granted', provider_order_id = $2, provider_payment_id = $3, grant_point_record_id = $4, paid_at = $5, updated_at = $5
                    WHERE id = $1 AND credit_grant_state = 'pending' RETURNING id
                 ) SELECT updated_order.id, pg_notify('${TOP_UP_ORDER_NOTIFY_CHANNEL}', updated_order.id) AS notified FROM updated_order`,
                [order.id, input.event.providerOrderId || null, input.event.providerPaymentId, pointRecordId, paidAt],
            );
            if (!updatedOrder.rowCount) throw new BillingInputError("充值授信状态已变化", 409);
            if (order.userCouponId && !(await repos.topUps.redeemCouponForOrder(order.userCouponId, order.id))) throw new BillingInputError("充值订单优惠券绑定状态不可核销", 409);
            await prepareReferralRewardsForPaidOrder(client, {
                order: { ...order, status: "paid", paymentState: "paid", creditGrantState: "granted", providerOrderId: input.event.providerOrderId, providerPaymentId: input.event.providerPaymentId, paidAt },
                provider: input.event.provider,
                rawPayload: input.event.rawPayload,
                paidAt: input.event.paidAt || new Date().toISOString(),
            });
            await markEventProcessed(client, input.event.provider, input.event.eventId);
            return "applied" as const;
        });
    }
}

function authoritativeOrderFingerprint(order: Parameters<TopUpPaymentSettlementStore["settle"]>[0]["order"]) {
    return createHash("sha256")
        .update(JSON.stringify({ id: order.id, userId: order.userId, paymentAmount: order.paymentAmount, creditAmount: order.creditAmount, nominalNativeAmount: order.nominalNativeAmount, payableNativeAmount: order.payableNativeAmount, nominalUsdValue: order.nominalUsdValue, paidUsdValue: order.paidUsdValue, pricingVersion: order.pricingVersion, customerFxVersion: order.customerFxVersion, customerFxRate: order.customerFxRate }))
        .digest("hex");
}

function sameOwnedPayment(row: Record<string, unknown> | undefined, input: { paymentId: string; order: Parameters<TopUpPaymentSettlementStore["settle"]>[0]["order"]; eventId: string; provider: string; amount: { kind: "fiat"; currency: string; amountMinor: string; minorUnitExponent: number }; providerTradeId?: string; providerPaymentId: string; paymentSnapshotFingerprint: string }) {
    return Boolean(
        row &&
            String(row.id) === input.paymentId &&
            String(row.order_id) === input.order.id &&
            String(row.user_id) === input.order.userId &&
            String(row.provider) === input.provider &&
            String(row.provider_event_id) === input.eventId &&
            String(row.order_snapshot_fingerprint) === input.paymentSnapshotFingerprint &&
            row.status === "succeeded" &&
            row.payment_kind === "fiat" &&
            String(row.fiat_currency) === input.amount.currency &&
            String(row.amount_minor) === input.amount.amountMinor &&
            Number(row.minor_unit_exponent) === input.amount.minorUnitExponent &&
            String(row.provider_trade_id || "") === (input.providerTradeId || "") &&
            String(row.provider_payment_id) === input.providerPaymentId,
    );
}

async function markEventProcessed(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, provider: string, eventId: string) {
    await client.query("UPDATE top_up_payment_events SET status = 'processed', processed_at = now(), updated_at = now() WHERE provider = $1 AND event_id = $2", [provider, eventId]);
}
