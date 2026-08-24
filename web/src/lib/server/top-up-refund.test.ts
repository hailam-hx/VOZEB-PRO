import { describe, expect, it } from "vitest";

import { decimal } from "@/lib/billing/decimal";
import { requestTopUpRefund, type TopUpRefundProvider, type TopUpRefundStore } from "./top-up-refund";
import type { TopUpOrder } from "./top-up-payment";

describe("top-up full refund recovery", () => {
    it("finalizes payment state and referral reversal in the PostgreSQL transaction", async () => {
        const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./top-up-refund-service.ts", import.meta.url), "utf8"));
        expect(source).toContain("UPDATE top_up_payments SET status = 'refunded'");
        expect(source).toContain("reverseReferralRewardsForRefundedOrder(client");
        expect(source.indexOf("UPDATE top_up_payments SET status = 'refunded'")).toBeLessThan(source.indexOf("UPDATE top_up_orders SET status = 'refunded'"));
    });
    it("does not call the provider when the entire original grant cannot be held", async () => {
        const store = memoryRefundStore("5");
        const provider = memoryProvider("succeeded");

        const result = await requestTopUpRefund({ orderId: "order-one", kind: "full", reason: "客户申请" }, store, provider);

        expect(result).toMatchObject({ manualReview: true, reason: "insufficient_balance" });
        expect(provider.state.calls).toBe(0);
        expect(store.state.balance).toBe("5");
        expect(store.state.held).toBe("0");
        expect(store.state.ledger).toEqual([]);
        expect(store.state.paymentStatus).toBe("succeeded");
        expect(store.state.referralReversals).toBe(0);
    });

    it("releases the full recovery hold when the provider fails without changing settled balance", async () => {
        const store = memoryRefundStore("10.12345678");
        const provider = memoryProvider("failed");

        const result = await requestTopUpRefund({ orderId: "order-one", kind: "full", reason: "客户申请" }, store, provider);

        expect(result).toMatchObject({ failed: true, recoveryState: "released" });
        expect(provider.state.calls).toBe(1);
        expect(provider.state.heldWhenCalled).toBe("10.12345678");
        expect(store.state.balance).toBe("10.12345678");
        expect(store.state.held).toBe("0");
        expect(store.state.ledger).toEqual([]);
        expect(store.state.paymentStatus).toBe("succeeded");
        expect(store.state.referralReversals).toBe(0);

        const retry = await requestTopUpRefund({ orderId: "order-one", kind: "full", reason: "retry" }, store, provider);
        expect(retry).toMatchObject({ manualReview: true, reason: "provider_retry_review" });
        expect(provider.state.calls).toBe(1);
    });

    it("recovers the exact full grant once after provider success", async () => {
        const store = memoryRefundStore("10.12345678");
        const provider = memoryProvider("succeeded");

        const first = await requestTopUpRefund({ orderId: "order-one", kind: "full", reason: "客户申请" }, store, provider);
        const duplicate = await requestTopUpRefund({ orderId: "order-one", kind: "full", reason: "客户申请" }, store, provider);

        expect(first).toMatchObject({ applied: true, recoveredCreditAmount: "10.12345678", recoveryState: "recovered" });
        expect(duplicate).toMatchObject({ applied: false, duplicate: true, recoveredCreditAmount: "10.12345678" });
        expect(provider.state.calls).toBe(1);
        expect(store.state.balance).toBe("0");
        expect(store.state.held).toBe("0");
        expect(store.state.ledger).toEqual([{ businessId: "top-up:order-one:refund-recovery", amount: "-10.12345678", orderId: "order-one" }]);
        expect(store.state.paymentStatus).toBe("refunded");
        expect(store.state.referralReversals).toBe(1);
    });

    it.each(["partial", "chargeback"] as const)("routes %s to manual review without wallet or provider mutation", async (kind) => {
        const store = memoryRefundStore("10.12345678");
        const provider = memoryProvider("succeeded");

        const result = await requestTopUpRefund({ orderId: "order-one", kind, reason: "provider notice" }, store, provider);

        expect(result).toMatchObject({ manualReview: true, reason: kind });
        expect(provider.state.calls).toBe(0);
        expect(store.state.balance).toBe("10.12345678");
        expect(store.state.held).toBe("0");
        expect(store.state.ledger).toEqual([]);
    });
});

function paidOrder(): TopUpOrder {
    return {
        id: "order-one",
        orderNo: "VZ001",
        userId: "user-one",
        status: "paid",
        paymentState: "paid",
        creditGrantState: "granted",
        providerRefundState: "none",
        creditRecoveryState: "none",
        subject: "充值",
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: "253086.4195",
        promotionDiscountNativeAmount: "0",
        couponDiscountNativeAmount: "0",
        payableNativeAmount: "253086",
        nominalUsdValue: "10.12345678",
        paidUsdValue: "10.12344",
        creditAmount: "10.12345678",
        pricingVersion: "top-up-v1",
        customerFxVersion: "fx-v1",
        customerFxRate: "0.00004",
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "253086", minorUnitExponent: 0 },
        provider: "payply",
        providerPaymentId: "payment-one",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
    };
}

function memoryRefundStore(
    balance: string,
): TopUpRefundStore & { state: { order: TopUpOrder; balance: string; held: string; ledger: Array<{ businessId: string; amount: string; orderId: string }>; paymentStatus: "succeeded" | "refunded"; referralReversals: number } } {
    const state = { order: paidOrder(), balance, held: "0", ledger: [] as Array<{ businessId: string; amount: string; orderId: string }>, paymentStatus: "succeeded" as "succeeded" | "refunded", referralReversals: 0 };
    return {
        state,
        async getOrder() {
            return state.order;
        },
        async markManualReview(_orderId, reason) {
            state.order = { ...state.order, creditRecoveryState: "manual_review", metadata: { reason } };
        },
        async beginRecovery(input) {
            if (state.order.creditRecoveryState === "recovered") return "duplicate";
            if (decimal(input.creditAmount).greaterThan(decimal(state.balance).minus(decimal(state.held)))) return "insufficient";
            state.held = input.creditAmount;
            state.order = { ...state.order, status: "refunding", providerRefundState: "pending", creditRecoveryState: "held" };
            return "held";
        },
        async releaseRecovery() {
            state.held = "0";
            state.order = { ...state.order, status: "paid", providerRefundState: "failed", creditRecoveryState: "released" };
        },
        async finalizeRecovery(input) {
            if (state.order.creditRecoveryState === "recovered") return "duplicate";
            state.balance = "0";
            state.held = "0";
            state.ledger.push({ businessId: input.businessId, amount: `-${input.creditAmount}`, orderId: input.orderId });
            state.paymentStatus = "refunded";
            state.referralReversals += 1;
            state.order = { ...state.order, status: "refunded", paymentState: "refunded", providerRefundState: "succeeded", creditRecoveryState: "recovered" };
            return "applied";
        },
    };
}

function memoryProvider(status: "succeeded" | "failed"): TopUpRefundProvider & { state: { calls: number; heldWhenCalled: string } } {
    const state = { calls: 0, heldWhenCalled: "" };
    return {
        state,
        async refund(_order, context) {
            state.calls += 1;
            state.heldWhenCalled = context.recoveryHeldAmount;
            return { status, providerRefundId: "refund-one" };
        },
    };
}
