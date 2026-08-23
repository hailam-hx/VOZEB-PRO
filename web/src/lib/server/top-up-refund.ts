import { createHash } from "node:crypto";

import { decimal } from "@/lib/billing/decimal";
import { BillingInputError } from "@/lib/server/billing-errors";
import type { TopUpOrder } from "./top-up-payment";

export type TopUpRefundKind = "full" | "partial" | "chargeback";

export type TopUpRefundProviderResult = { status: "succeeded" | "failed" | "manual"; providerRefundId?: string; rawPayload?: unknown };

export type TopUpRefundProvider = {
    refund(order: TopUpOrder, context: { recoveryHeldAmount: string; reason: string }): Promise<TopUpRefundProviderResult>;
};

export type TopUpRefundStore = {
    getOrder(orderId: string): Promise<TopUpOrder | null>;
    markManualReview(orderId: string, reason: string): Promise<void>;
    beginRecovery(input: { orderId: string; creditAmount: string; businessId: string; requestFingerprint: string }): Promise<"held" | "duplicate" | "insufficient">;
    releaseRecovery(input: { orderId: string; businessId: string; requestFingerprint: string; reason: string }): Promise<void>;
    finalizeRecovery(input: { orderId: string; creditAmount: string; businessId: string; requestFingerprint: string; providerRefund: TopUpRefundProviderResult }): Promise<"applied" | "duplicate">;
};

export async function requestTopUpRefund(input: { orderId: string; kind: TopUpRefundKind; reason: string }, store: TopUpRefundStore, provider: TopUpRefundProvider) {
    const order = await store.getOrder(input.orderId);
    if (!order) throw new BillingInputError("充值订单不存在", 404);
    if (input.kind !== "full") {
        await store.markManualReview(order.id, input.kind);
        return { orderId: order.id, manualReview: true, reason: input.kind };
    }
    if (order.creditRecoveryState === "recovered" || order.status === "refunded") {
        return { orderId: order.id, applied: false, duplicate: true, recoveredCreditAmount: order.creditAmount, recoveryState: "recovered" as const };
    }
    if (order.creditRecoveryState === "released" && order.providerRefundState === "failed") {
        await store.markManualReview(order.id, "provider_retry_review");
        return { orderId: order.id, manualReview: true, reason: "provider_retry_review" as const };
    }
    if (order.paymentState !== "paid" || order.creditGrantState !== "granted") throw new BillingInputError("只有已完成授信的充值订单可以全额退款", 409);
    const credits = decimal(order.creditAmount, "原始授信积分");
    if (!credits.greaterThan(decimal(0)) || !credits.hasAtMostDecimalPlaces(8)) throw new BillingInputError("原始授信积分快照无效", 409);
    const businessId = `top-up:${order.id}:refund-recovery`;
    const requestFingerprint = createHash("sha256")
        .update(JSON.stringify({ businessId, orderId: order.id, userId: order.userId, creditAmount: credits.toString() }))
        .digest("hex");
    const begun = await store.beginRecovery({ orderId: order.id, creditAmount: credits.toString(), businessId, requestFingerprint });
    if (begun === "duplicate") return { orderId: order.id, applied: false, duplicate: true, recoveredCreditAmount: credits.toString(), recoveryState: "recovered" as const };
    if (begun === "insufficient") {
        await store.markManualReview(order.id, "insufficient_balance");
        return { orderId: order.id, manualReview: true, reason: "insufficient_balance" as const };
    }

    let providerRefund: TopUpRefundProviderResult;
    try {
        providerRefund = await provider.refund(order, { recoveryHeldAmount: credits.toString(), reason: input.reason });
    } catch (error) {
        await store.releaseRecovery({ orderId: order.id, businessId, requestFingerprint, reason: "provider_failed" });
        return { orderId: order.id, failed: true, recoveryState: "released" as const, error: error instanceof Error ? error.message : "退款渠道调用失败" };
    }
    if (providerRefund.status !== "succeeded") {
        await store.releaseRecovery({ orderId: order.id, businessId, requestFingerprint, reason: "provider_failed" });
        if (providerRefund.status === "manual") {
            await store.markManualReview(order.id, "provider_manual");
            return { orderId: order.id, manualReview: true, providerRefund, recoveryState: "released" as const };
        }
        return { orderId: order.id, failed: true, providerRefund, recoveryState: "released" as const };
    }
    const finalized = await store.finalizeRecovery({ orderId: order.id, creditAmount: credits.toString(), businessId, requestFingerprint, providerRefund });
    return {
        orderId: order.id,
        applied: finalized === "applied",
        duplicate: finalized === "duplicate",
        recoveredCreditAmount: credits.toString(),
        providerRefund,
        recoveryState: "recovered" as const,
    };
}
