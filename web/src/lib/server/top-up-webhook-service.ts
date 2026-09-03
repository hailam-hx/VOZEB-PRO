import { BillingInputError, PaymentWebhookProcessingError } from "@/lib/server/billing-errors";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import { getPaymentRuntimeConfig } from "@/lib/server/payment-config-store";
import { normalizeProvider, resolveWebhookAdapter } from "./payment-webhook-adapters";
import { processTopUpPaymentEvent, validateTopUpPaymentEventForOrder } from "./top-up-payment";
import { PostgresTopUpPaymentStore } from "./top-up-postgres-settlement";

export async function processTopUpWebhook(input: { provider: string; rawBody: string; headers: Headers }) {
    if (!isPostgresDatabaseEnabled()) throw new BillingInputError("支付回调需要启用 PostgreSQL", 501);
    await ensurePostgresSchema();
    const provider = normalizeProvider(input.provider);
    const adapter = resolveWebhookAdapter(provider);
    const parsed = adapter.parse(provider, input.rawBody, input.headers, await getPaymentRuntimeConfig());
    if (!parsed.signatureValid) throw new BillingInputError("支付回调签名无效", 401);
    const repos = createPostgresRepositories();
    const order = parsed.orderId ? await repos.topUps.getOrderById(parsed.orderId) : parsed.orderNo ? await repos.topUps.getOrderByOrderNo(parsed.orderNo) : null;
    if (!order) throw new BillingInputError("充值订单不存在", 404);
    adapter.assertOrder?.(parsed, order);
    const amountMinor = parsed.amountMinor || "";
    if (!amountMinor) throw new BillingInputError("支付回调缺少安全的最小单位金额", 409);
    const providerPaymentId = parsed.providerPaymentId || parsed.providerTradeId || "";
    const event = {
        signatureValid: parsed.signatureValid,
        provider,
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        orderId: order.id,
        orderNo: parsed.orderNo || order.orderNo,
        status: parsed.status,
        amount: { kind: "fiat" as const, currency: parsed.currency || "", amountMinor, minorUnitExponent: order.currencyExponent },
        providerOrderId: parsed.providerTradeId,
        providerPaymentId,
        paidAt: parsed.paidAt,
        rawPayload: parsed.payload as never,
    };
    validateTopUpPaymentEventForOrder(event, order);
    let result;
    try {
        result = await processTopUpPaymentEvent(event, new PostgresTopUpPaymentStore());
    } catch (error) {
        throw new PaymentWebhookProcessingError(error);
    }
    return { received: true, provider, eventId: parsed.eventId, eventType: parsed.eventType, orderId: order.id, orderNo: order.orderNo, orderStatus: result.applied ? "paid" : order.status, creditAmount: result.creditAmount, duplicate: result.duplicate };
}
