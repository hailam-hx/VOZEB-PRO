import { createHash } from "node:crypto";

import { validatePaymentAmount, type PaymentAmount } from "@/lib/billing/money";
import { BillingInputError } from "@/lib/server/billing-errors";
import type { JsonValue } from "@/lib/server/database";

export type TopUpPaymentState = "pending" | "paid" | "failed" | "refunded";
export type TopUpCreditGrantState = "pending" | "granted" | "manual_review";
export type TopUpProviderRefundState = "none" | "pending" | "succeeded" | "failed" | "manual";
export type TopUpCreditRecoveryState = "none" | "held" | "recovered" | "released" | "manual_review";

export type TopUpOrder = {
    id: string;
    orderNo: string;
    userId: string;
    status: "pending" | "paid" | "canceled" | "refunding" | "refunded";
    paymentState: TopUpPaymentState;
    creditGrantState: TopUpCreditGrantState;
    providerRefundState: TopUpProviderRefundState;
    creditRecoveryState: TopUpCreditRecoveryState;
    subject: string;
    presetId?: string;
    currency: "VND";
    currencyExponent: 0;
    nominalNativeAmount: string;
    promotionDiscountNativeAmount: string;
    couponDiscountNativeAmount: string;
    payableNativeAmount: string;
    nominalUsdValue: string;
    paidUsdValue: string;
    creditAmount: string;
    pricingVersion: string;
    customerFxVersion: string;
    customerFxRate: string;
    paymentAmount: PaymentAmount;
    provider: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    promotionCampaignId?: string;
    userCouponId?: string;
    snapshot?: JsonValue;
    metadata?: JsonValue;
    expiresAt?: string;
    paidAt?: string;
    closedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type TopUpPaymentEvent = {
    signatureValid: boolean;
    provider: string;
    eventId: string;
    eventType: string;
    orderId: string;
    orderNo: string;
    status: string;
    amount: PaymentAmount;
    providerOrderId?: string;
    providerPaymentId: string;
    paidAt?: string;
    rawPayload?: JsonValue;
};

export type TopUpPaymentSettlementStore = {
    getLockedOrder(orderId: string): Promise<TopUpOrder | null>;
    settle(input: { order: TopUpOrder; event: TopUpPaymentEvent; eventFingerprint: string; businessId: string; requestFingerprint: string; creditAmount: string }): Promise<"applied" | "duplicate" | "conflict">;
};

export function assertFiatTopUpCheckout(input: unknown) {
    const amount = validatePaymentAmount(input);
    if (amount.kind === "crypto") throw new BillingInputError("V1 暂未开放加密货币充值", 400);
    return amount;
}

export async function processTopUpPaymentEvent(event: TopUpPaymentEvent, store: TopUpPaymentSettlementStore) {
    if (!event.signatureValid) throw new BillingInputError("支付回调签名无效", 401);
    const orderId = required(event.orderId, "支付回调订单编号不能为空");
    const order = await store.getLockedOrder(orderId);
    if (!order) throw new BillingInputError("充值订单不存在", 404);
    const normalizedEvent = validateTopUpPaymentEventForOrder(event, order);
    const eventFingerprint = fingerprint({
        provider: event.provider,
        eventId: normalizedEvent.eventId,
        eventType: event.eventType,
        orderId: normalizedEvent.orderId,
        orderNo: event.orderNo,
        status: event.status,
        amount: normalizedEvent.amount,
        providerOrderId: event.providerOrderId || "",
        providerPaymentId: event.providerPaymentId,
    });
    const businessId = `top-up:${order.id}:grant`;
    const result = await store.settle({
        order,
        event: normalizedEvent,
        eventFingerprint,
        businessId,
        requestFingerprint: fingerprint({ businessId, userId: order.userId, creditAmount: order.creditAmount, orderId: order.id }),
        creditAmount: order.creditAmount,
    });
    if (result === "conflict") throw new BillingInputError("支付回调事件编号已对应不同载荷", 409);
    return { applied: result === "applied", duplicate: result === "duplicate", orderId: order.id, orderNo: order.orderNo, creditAmount: order.creditAmount, businessId };
}

export function validateTopUpPaymentEventForOrder(event: TopUpPaymentEvent, order: TopUpOrder): TopUpPaymentEvent {
    if (!event.signatureValid) throw new BillingInputError("支付回调签名无效", 401);
    const eventId = required(event.eventId, "支付回调事件编号不能为空");
    const orderId = required(event.orderId, "支付回调订单编号不能为空");
    if (required(event.provider, "支付回调渠道不能为空") !== order.provider) throw new BillingInputError("支付回调渠道与订单渠道不一致", 409);
    if (orderId !== order.id || event.orderNo !== order.orderNo) throw new BillingInputError("支付回调订单身份与订单快照不一致", 409);
    if (!acceptedPaidStatus(event.status)) throw new BillingInputError("支付回调状态尚未确认付款", 409);
    if (!event.providerPaymentId?.trim()) throw new BillingInputError("支付交易编号不能为空", 409);
    let amount: PaymentAmount;
    try {
        amount = validatePaymentAmount(event.amount);
    } catch (error) {
        throw new BillingInputError(`支付金额无效：${error instanceof Error ? error.message : "未知错误"}`, 409);
    }
    if (!sameAmount(amount, order.paymentAmount)) throw new BillingInputError("支付金额或币种与订单快照不一致", 409);
    if (order.paymentState === "refunded" || order.creditRecoveryState === "recovered") throw new BillingInputError("退款完成后的支付事件必须人工复核", 409);
    return { ...event, eventId, orderId, amount };
}

function acceptedPaidStatus(value: string) {
    return value === "succeeded" || value === "paid" || value === "completed";
}

function sameAmount(left: PaymentAmount, right: PaymentAmount) {
    try {
        const trusted = validatePaymentAmount(right);
        return JSON.stringify(left) === JSON.stringify(trusted);
    } catch {
        return false;
    }
}

function required(value: string, message: string) {
    const normalized = value?.trim();
    if (!normalized) throw new BillingInputError(message);
    return normalized;
}

function fingerprint(value: object) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
