import { BillingInputError } from "@/lib/server/billing-errors";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import { getPaymentRuntimeConfig, isPaymentRuntimeProviderCheckoutReady } from "@/lib/server/payment-config-store";
import { processTopUpPaymentEvent } from "./top-up-payment";
import { PostgresTopUpPaymentStore } from "./top-up-postgres-settlement";
import { queryZaloPayOrder } from "./zalopay-payment-provider";

export type TopUpPaymentSyncStatus = "paid" | "pending" | "already_final";

export async function syncTopUpOrderForUser(userId: string, orderId: string) {
    if (!isPostgresDatabaseEnabled()) throw new BillingInputError("支付状态同步需要启用 PostgreSQL", 501);
    await ensurePostgresSchema();
    const repos = createPostgresRepositories();
    const normalizedOrderId = normalizeId(orderId);
    const order = await repos.topUps.getOrderById(normalizedOrderId);
    if (!order || order.userId !== userId) throw new BillingInputError("充值订单不存在", 404);
    if (order.status !== "pending") return { order, syncStatus: "already_final" as const };
    if (order.provider !== "zalopay") throw new BillingInputError("当前支付渠道不支持主动同步", 400);
    if (!order.providerOrderId) throw new BillingInputError("ZaloPay 支付订单尚未创建", 409);

    const paymentConfig = await getPaymentRuntimeConfig();
    if (!isPaymentRuntimeProviderCheckoutReady(paymentConfig, "zalopay")) throw new BillingInputError("ZaloPay 支付配置不完整", 503);
    const query = await queryZaloPayOrder({ appTransId: order.providerOrderId }, paymentConfig);
    if (query.status === "pending") return { order, syncStatus: "pending" as const };
    if (query.status === "expired") {
        const expired = await repos.topUps.expirePendingOrder(order.id, new Date().toISOString());
        if (expired) return { order: expired, syncStatus: "already_final" as const };
        const current = await repos.topUps.getOrderById(order.id);
        if (!current || current.userId !== userId) throw new BillingInputError("充值订单同步结果不存在", 500);
        return { order: current, syncStatus: current.status === "pending" ? ("pending" as const) : ("already_final" as const) };
    }

    await processTopUpPaymentEvent(
        {
            signatureValid: true,
            provider: "zalopay",
            eventId: query.providerPaymentId,
            eventType: "zalopay.payment.succeeded",
            orderId: order.id,
            orderNo: order.orderNo,
            status: "succeeded",
            amount: { kind: "fiat", currency: "VND", amountMinor: query.amountMinor, minorUnitExponent: order.currencyExponent },
            providerOrderId: query.providerOrderId,
            providerPaymentId: query.providerPaymentId,
            paidAt: query.paidAt,
            rawPayload: query.payload as never,
        },
        new PostgresTopUpPaymentStore(),
    );
    const updated = await repos.topUps.getOrderById(order.id);
    if (!updated || updated.userId !== userId) throw new BillingInputError("充值订单同步结果不存在", 500);
    return { order: updated, syncStatus: "paid" as const };
}

function normalizeId(value: string) {
    const id = value
        .trim()
        .slice(0, 160)
        .replace(/[^a-zA-Z0-9_.:-]/g, "");
    if (!id) throw new BillingInputError("充值订单编号无效");
    return id;
}
