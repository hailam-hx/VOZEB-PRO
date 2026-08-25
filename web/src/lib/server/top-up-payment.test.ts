import { describe, expect, it } from "vitest";

import { assertFiatTopUpCheckout, processTopUpPaymentEvent, type TopUpOrder, type TopUpPaymentEvent, type TopUpPaymentSettlementStore } from "./top-up-payment";

const order: TopUpOrder = {
    id: "order-one",
    orderNo: "VZ001",
    userId: "user-one",
    status: "pending",
    paymentState: "pending",
    creditGrantState: "pending",
    providerRefundState: "none",
    creditRecoveryState: "none",
    subject: "充值",
    presetId: "starter",
    currency: "VND",
    currencyExponent: 0,
    nominalNativeAmount: "250000",
    promotionDiscountNativeAmount: "0",
    couponDiscountNativeAmount: "0",
    payableNativeAmount: "250000",
    nominalUsdValue: "10",
    paidUsdValue: "10",
    creditAmount: "10",
    pricingVersion: "top-up-v1",
    customerFxVersion: "fx-v1",
    customerFxRate: "0.00004",
    paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
    provider: "payply",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
};

const event: TopUpPaymentEvent = {
    signatureValid: true,
    provider: "payply",
    eventId: "evt-one",
    eventType: "payment.succeeded",
    orderId: order.id,
    orderNo: order.orderNo,
    status: "succeeded",
    amount: order.paymentAmount,
    providerPaymentId: "payment-one",
};

describe("verified top-up settlement", () => {
    it("keeps crypto validation available while disabling crypto checkout in V1", () => {
        expect(assertFiatTopUpCheckout(order.paymentAmount)).toEqual(order.paymentAmount);
        expect(() => assertFiatTopUpCheckout({ kind: "crypto", asset: "USDT", network: "TRON", amountAtomic: "1000000", decimals: 6, txHash: "0xabc" })).toThrow("暂未开放");
    });

    it.each([
        ["forged signature", { signatureValid: false }, "签名"],
        ["wrong provider", { provider: "stripe" }, "渠道"],
        ["missing event identity", { eventId: "" }, "事件编号"],
        ["wrong order identity", { orderNo: "VZ999" }, "订单"],
        ["wrong amount", { amount: { kind: "fiat", currency: "VND", amountMinor: "249999", minorUnitExponent: 0 } }, "金额"],
        ["wrong currency", { amount: { kind: "fiat", currency: "USD", amountMinor: "250000", minorUnitExponent: 0 } }, "支付金额"],
        ["unpaid status", { status: "pending" }, "状态"],
    ])("never grants for %s", async (_label, patch, message) => {
        const store = memoryStore();

        await expect(processTopUpPaymentEvent({ ...event, ...patch } as TopUpPaymentEvent, store)).rejects.toThrow(message);

        expect(store.state.balance).toBe("0");
        expect(store.state.order.creditGrantState).toBe("pending");
    });

    it("grants the server snapshot exactly once for a valid replay", async () => {
        const store = memoryStore();

        const first = await processTopUpPaymentEvent(event, store);
        const duplicate = await processTopUpPaymentEvent(event, store);

        expect(first).toMatchObject({ applied: true, creditAmount: "10", businessId: "top-up:order-one:grant" });
        expect(duplicate).toMatchObject({ applied: false, duplicate: true, creditAmount: "10" });
        expect(store.state.balance).toBe("10");
        expect(store.state.ledger).toEqual([{ businessId: "top-up:order-one:grant", amount: "10", orderId: "order-one" }]);
    });

    it("rejects an event ID replayed with a different payload", async () => {
        const store = memoryStore();
        await processTopUpPaymentEvent(event, store);

        await expect(processTopUpPaymentEvent({ ...event, providerPaymentId: "payment-forged" }, store)).rejects.toThrow("事件编号");

        expect(store.state.balance).toBe("10");
        expect(store.state.ledger).toHaveLength(1);
    });
});

function memoryStore(): TopUpPaymentSettlementStore & {
    state: { order: TopUpOrder; balance: string; ledger: Array<{ businessId: string; amount: string; orderId: string }>; events: Map<string, string> };
} {
    const state = { order: { ...order }, balance: "0", ledger: [] as Array<{ businessId: string; amount: string; orderId: string }>, events: new Map<string, string>() };
    return {
        state,
        async getLockedOrder(orderId) {
            return orderId === state.order.id ? state.order : null;
        },
        async settle(input) {
            const eventKey = `${input.event.provider}:${input.event.eventId}`;
            const existingFingerprint = state.events.get(eventKey);
            if (existingFingerprint && existingFingerprint !== input.eventFingerprint) return "conflict";
            if (existingFingerprint) return "duplicate";
            state.events.set(eventKey, input.eventFingerprint);
            if (state.order.creditGrantState === "granted") return "duplicate";
            state.balance = input.creditAmount;
            state.ledger.push({ businessId: input.businessId, amount: input.creditAmount, orderId: input.order.id });
            state.order = { ...state.order, status: "paid", paymentState: "paid", creditGrantState: "granted", providerPaymentId: input.event.providerPaymentId };
            return "applied";
        },
    };
}
