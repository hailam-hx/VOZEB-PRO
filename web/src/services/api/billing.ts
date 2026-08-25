import type { PaymentAmount } from "@/lib/billing/money";

export type TopUpPreset = { id: string; name: string; description: string; nominalNativeAmount: string; enabled: boolean; sortOrder: number };
export type TopUpOrderStatus = "pending" | "paid" | "canceled" | "refunding" | "refunded";
export type TopUpQuote = {
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
    customerFx: { version: string; usdPerVnd: string };
    paymentAmount: PaymentAmount;
    promotion?: { id: string; label: string };
    coupon?: { userCouponId: string; templateId: string; type: "fixed" | "percentage"; value: string; currency?: string };
};
export type TopUpOrder = Omit<TopUpQuote, "customerFx" | "promotion" | "coupon"> & {
    id: string;
    orderNo: string;
    userId?: string;
    status: TopUpOrderStatus;
    paymentState: "pending" | "paid" | "failed" | "refunded";
    creditGrantState: "pending" | "granted" | "manual_review";
    providerRefundState: "none" | "pending" | "succeeded" | "failed" | "manual";
    creditRecoveryState: "none" | "held" | "recovered" | "released" | "manual_review";
    subject: string;
    customerFxVersion: string;
    customerFxRate: string;
    provider: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    promotionCampaignId?: string;
    userCouponId?: string;
    expiresAt?: string;
    paidAt?: string;
    closedAt?: string;
    snapshot?: unknown;
    metadata?: unknown;
    createdAt: string;
    updatedAt: string;
};
export type TopUpSelection = ({ presetId: string; customAmountVnd?: never } | { presetId?: never; customAmountVnd: string }) & { promotionId?: string; userCouponId?: string };
export type PaymentCheckout = {
    provider: string;
    orderId: string;
    orderNo: string;
    kind: "manual" | "redirect" | "form" | "qr";
    url?: string;
    form?: { action: string; method: "GET" | "POST"; fields: Array<{ name: string; value: string }> };
    qrContent?: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    expiresAt?: string;
};

const TOP_UP_ROUTE = "/api/billing/top-ups";

export async function listTopUpPresets() {
    return requestCommerce<{ presets: TopUpPreset[]; paymentProviders: string[] }>(`${TOP_UP_ROUTE}/presets`);
}

export async function quoteTopUpOrder(input: TopUpSelection) {
    return requestCommerce<{ quote: TopUpQuote }>(`${TOP_UP_ROUTE}/quotes`, jsonPost(input));
}

export async function createTopUpOrder(input: TopUpSelection & { provider: string }) {
    return requestCommerce<{ order: TopUpOrder }>(`${TOP_UP_ROUTE}/orders`, jsonPost(input));
}

export async function listTopUpOrders(input: { page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    if (input.page) params.set("page", String(input.page));
    if (input.pageSize) params.set("pageSize", String(input.pageSize));
    const query = params.toString();
    return requestCommerce<{ orders: TopUpOrder[]; total: number; page: number; pageSize: number }>(`${TOP_UP_ROUTE}/orders${query ? `?${query}` : ""}`);
}

export async function getTopUpOrder(orderId: string) {
    return requestCommerce<{ order: TopUpOrder }>(`${TOP_UP_ROUTE}/orders/${encodeURIComponent(orderId)}`);
}

export async function cancelTopUpOrder(orderId: string) {
    return requestCommerce<{ order: TopUpOrder }>(`${TOP_UP_ROUTE}/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
}

export async function createTopUpCheckout(orderId: string) {
    return requestCommerce<{ checkout: PaymentCheckout }>(`${TOP_UP_ROUTE}/orders/${encodeURIComponent(orderId)}/checkout`, jsonPost({}));
}

export function subscribeTopUpOrder(orderId: string, onOrder: (order: TopUpOrder) => void, onError: () => void) {
    const source = new EventSource(`${TOP_UP_ROUTE}/orders/${encodeURIComponent(orderId)}/events`);
    source.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data) as { code?: number; data?: { order?: TopUpOrder } | null };
            if (payload.code !== 0 || !payload.data?.order) throw new Error("订单状态响应无效");
            onOrder(payload.data.order);
            if (payload.data.order.status !== "pending") source.close();
        } catch {
            onError();
        }
    };
    source.onerror = onError;
    return () => source.close();
}

function jsonPost(value: unknown): RequestInit {
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

async function requestCommerce<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...init });
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: T; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0 || payload.data === undefined) throw new Error(payload?.msg || "请求失败");
    return payload.data;
}
