import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string | URL, init?: RequestInit) => fetch(url, init) }));

import type { PaymentRuntimeConfig } from "./payment-config-store";
import type { TopUpOrder } from "./top-up-payment";
import { assertZaloPayWebhookOrder, buildZaloPayAppTransId, createZaloPayCheckout, parseZaloPayCallback, queryZaloPayOrder } from "./zalopay-payment-provider";

const now = new Date("2026-08-23T17:00:00.000Z");
const order: TopUpOrder = {
    id: "64ed4cb9-4cba-44cc-a11d-b2f65f29d60a",
    orderNo: "VZ202608240001",
    userId: "user-one",
    status: "pending",
    paymentState: "pending",
    creditGrantState: "pending",
    providerRefundState: "none",
    creditRecoveryState: "none",
    subject: "Nạp điểm VOZEB PRO",
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
    provider: "zalopay",
    expiresAt: "2026-08-23T17:30:00.000Z",
    createdAt: "2026-08-23T17:00:00.000Z",
    updatedAt: "2026-08-23T17:00:00.000Z",
};

describe("ZaloPay payment provider", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("builds a deterministic transaction id with the Vietnam calendar date", () => {
        const value = buildZaloPayAppTransId(order.id, now);

        expect(value).toMatch(/^260824_[a-f0-9]{32}$/);
        expect(value).toBe(buildZaloPayAppTransId(order.id, now));
        expect(value).toHaveLength(39);
    });

    it("creates an order with the authoritative VND amount and Key1 MAC", async () => {
        const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ return_code: 1, order_url: "https://sbgateway.zalopay.vn/pay/order-one", qr_code: "qr-content" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const paymentConfig = config();
        paymentConfig.valuesByEnvName.VOZEB_PRO_ZALOPAY_PREFERRED_PAYMENT_METHODS = "zalopay_wallet, vietqr";
        const checkout = await createZaloPayCheckout(order, { origin: "https://app.test" }, paymentConfig, now);
        const [url, init] = fetchMock.mock.calls[0] || [];
        const body = init?.body as URLSearchParams;
        const canonical = ["app_id", "app_trans_id", "app_user", "amount", "app_time", "embed_data", "item"].map((key) => body.get(key)).join("|");

        expect(url).toBe("https://sb-openapi.zalopay.vn/v2/create");
        expect(body.get("amount")).toBe("250000");
        expect(body.get("callback_url")).toBe("https://app.test/api/billing/webhooks/zalopay");
        expect(JSON.parse(body.get("embed_data") || "{}")).toMatchObject({
            redirecturl: `https://app.test/billing/success?orderId=${encodeURIComponent(order.id)}`,
            vozebProOrderId: order.id,
            vozebProOrderNo: order.orderNo,
            preferred_payment_method: ["zalopay_wallet", "vietqr"],
        });
        expect(body.get("mac")).toBe(createHmac("sha256", "key-one").update(canonical).digest("hex"));
        expect(checkout).toMatchObject({ provider: "zalopay", kind: "redirect", url: "https://sbgateway.zalopay.vn/pay/order-one", qrContent: "qr-content", providerOrderId: body.get("app_trans_id") });
    });

    it("queries the stored transaction id with the Key1 contract", async () => {
        const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ return_code: 1, amount: 250000, zp_trans_id: 240824000000001, server_time: now.getTime() }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const appTransId = buildZaloPayAppTransId(order.id, now);

        const result = await queryZaloPayOrder({ appTransId }, config());
        const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;

        expect(body.get("mac")).toBe(createHmac("sha256", "key-one").update(`2553|${appTransId}|key-one`).digest("hex"));
        expect(result).toMatchObject({ status: "paid", amountMinor: "250000", providerOrderId: appTransId, providerPaymentId: "240824000000001", paidAt: now.toISOString() });
    });

    it("only treats the documented processing query state as pending", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ return_code: 3, is_processing: true }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ return_code: 2, sub_return_code: -63 }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ return_code: 2, sub_return_code: -54 }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ return_code: 2, sub_return_code: -402 }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const appTransId = buildZaloPayAppTransId(order.id, now);

        await expect(queryZaloPayOrder({ appTransId }, config())).resolves.toMatchObject({ status: "pending", providerOrderId: appTransId });
        await expect(queryZaloPayOrder({ appTransId }, config())).resolves.toMatchObject({ status: "pending", providerOrderId: appTransId });
        await expect(queryZaloPayOrder({ appTransId }, config())).resolves.toMatchObject({ status: "expired", providerOrderId: appTransId });
        await expect(queryZaloPayOrder({ appTransId }, config())).rejects.toThrow("ZaloPay 查询订单失败");
    });

    it("verifies callback MAC over the original data string before parsing", () => {
        const data = JSON.stringify({
            app_id: 2553,
            app_trans_id: buildZaloPayAppTransId(order.id, now),
            amount: 250000,
            embed_data: JSON.stringify({ vozebProOrderId: order.id, vozebProOrderNo: order.orderNo }),
            zp_trans_id: 240824000000001,
            server_time: now.getTime(),
        });
        const rawBody = JSON.stringify({ data, mac: createHmac("sha256", "key-two").update(data).digest("hex"), type: 1 });

        expect(parseZaloPayCallback(rawBody, config())).toMatchObject({
            signatureValid: true,
            status: "succeeded",
            eventId: "240824000000001",
            orderId: order.id,
            orderNo: order.orderNo,
            providerTradeId: buildZaloPayAppTransId(order.id, now),
            providerPaymentId: "240824000000001",
            amountMinor: "250000",
            currency: "VND",
            paidAt: now.toISOString(),
        });

        const reserializedData = JSON.stringify(JSON.parse(data), null, 2);
        const tampered = JSON.stringify({ data: reserializedData, mac: createHmac("sha256", "key-two").update(data).digest("hex"), type: 1 });
        expect(parseZaloPayCallback(tampered, config()).signatureValid).toBe(false);
    });

    it("does not expose signing keys from an untrusted provider error", async () => {
        const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ return_code: -1, return_message: "invalid key-one" }), { status: 400 }));
        vi.stubGlobal("fetch", fetchMock);

        const failure = createZaloPayCheckout(order, { origin: "https://app.test" }, config(), now);

        await expect(failure).rejects.not.toThrow("key-one");
        await expect(failure).rejects.toThrow("ZaloPay 创建订单失败");
    });

    it("rejects checkout when the remaining provider lifetime is below the official minimum", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(createZaloPayCheckout({ ...order, expiresAt: new Date(now.getTime() + 299_000).toISOString() }, { origin: "https://app.test" }, config(), now)).rejects.toThrow("300");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects checkout when the remaining provider lifetime exceeds the official maximum", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(createZaloPayCheckout({ ...order, expiresAt: new Date(now.getTime() + 2_592_001_000).toISOString() }, { origin: "https://app.test" }, config(), now)).rejects.toThrow("2592000");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ["production", "", "https://openapi.zalopay.vn/v2/create"],
        ["sandbox", "https://zalopay-override.test/", "https://zalopay-override.test/v2/create"],
    ])("selects the %s API base and honors an explicit override", async (environment, override, expectedUrl) => {
        const paymentConfig = config();
        paymentConfig.valuesByEnvName.VOZEB_PRO_ZALOPAY_ENVIRONMENT = environment;
        paymentConfig.valuesByEnvName.VOZEB_PRO_ZALOPAY_API_BASE = override;
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ return_code: 1, order_url: "https://gateway.zalopay.vn/order-one" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await createZaloPayCheckout(order, { origin: "https://app.test" }, paymentConfig, now);

        expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.anything());
    });

    it("rejects malformed, URL-less, and network create responses without leaking secrets", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ return_code: 1 }), { status: 200 }))
            .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
            .mockRejectedValueOnce(new Error("network failed with key-one"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(createZaloPayCheckout(order, { origin: "https://app.test" }, config(), now)).rejects.toThrow("支付链接");
        await expect(createZaloPayCheckout(order, { origin: "https://app.test" }, config(), now)).rejects.toThrow("返回内容无效");
        const networkFailure = createZaloPayCheckout(order, { origin: "https://app.test" }, config(), now);
        await expect(networkFailure).rejects.toThrow("连接 ZaloPay 失败");
        await expect(networkFailure).rejects.not.toThrow("key-one");
    });

    it("validates the deterministic merchant transaction even before checkout persistence commits", () => {
        const parsed = parseZaloPayCallback(signedCallback({ app_trans_id: buildZaloPayAppTransId(order.id, now) }), config());

        expect(() => assertZaloPayWebhookOrder(parsed, order)).not.toThrow();
        expect(() => assertZaloPayWebhookOrder({ ...parsed, providerTradeId: "260824_wrong" }, order)).toThrow("商户交易号");
        expect(() => assertZaloPayWebhookOrder(parsed, { ...order, providerOrderId: "260824_different" })).toThrow("已保存订单");
        expect(() => assertZaloPayWebhookOrder(parsed, { ...order, providerPaymentId: "240824000000002" })).toThrow("支付交易号");
    });

    it("rejects callback MAC values that are not exactly 64 hexadecimal characters", () => {
        const rawBody = signedCallback();
        const envelope = JSON.parse(rawBody) as { data: string; mac: string; type: number };

        expect(parseZaloPayCallback(JSON.stringify({ ...envelope, mac: `${envelope.mac}zz` }), config()).signatureValid).toBe(false);
        expect(parseZaloPayCallback(JSON.stringify({ ...envelope, mac: `${envelope.mac}0` }), config()).signatureValid).toBe(false);
    });

    it("rejects a signed callback without a valid provider payment time", () => {
        expect(() => parseZaloPayCallback(signedCallback({ server_time: 0 }), config())).toThrow("支付信息");
        expect(() => parseZaloPayCallback(signedCallback({ server_time: Number.MAX_VALUE }), config())).toThrow("支付信息");
    });

    it("rejects a signed callback for another configured app", () => {
        expect(() => parseZaloPayCallback(signedCallback({ app_id: 9999 }), config())).toThrow("App ID");
    });

    it("preserves every byte of the callback data string during MAC verification", () => {
        const data = `  ${JSON.stringify({ app_id: 2553, app_trans_id: buildZaloPayAppTransId(order.id, now), amount: 250000, embed_data: JSON.stringify({ vozebProOrderId: order.id, vozebProOrderNo: order.orderNo }), zp_trans_id: 240824000000001, server_time: now.getTime() })}\n`;
        const rawBody = JSON.stringify({ data, mac: createHmac("sha256", "key-two").update(data).digest("hex"), type: 1 });

        expect(parseZaloPayCallback(rawBody, config()).signatureValid).toBe(true);
    });

    it("still requires an explicit environment when an API base override is configured", async () => {
        const paymentConfig = config();
        paymentConfig.valuesByEnvName.VOZEB_PRO_ZALOPAY_ENVIRONMENT = "";
        paymentConfig.valuesByEnvName.VOZEB_PRO_ZALOPAY_API_BASE = "https://zalopay.test";
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(createZaloPayCheckout(order, { origin: "https://app.test" }, paymentConfig, now)).rejects.toThrow("ENVIRONMENT");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function config(): PaymentRuntimeConfig {
    return {
        saved: { providers: {} },
        providers: { zalopay: { enabled: true, saved: true } },
        valuesByEnvName: {
            VOZEB_PRO_ZALOPAY_ENVIRONMENT: "sandbox",
            VOZEB_PRO_ZALOPAY_APP_ID: "2553",
            VOZEB_PRO_ZALOPAY_KEY1: "key-one",
            VOZEB_PRO_ZALOPAY_KEY2: "key-two",
        },
    };
}

function signedCallback(overrides: Record<string, unknown> = {}) {
    const data = JSON.stringify({
        app_id: 2553,
        app_trans_id: buildZaloPayAppTransId(order.id, now),
        amount: 250000,
        embed_data: JSON.stringify({ vozebProOrderId: order.id, vozebProOrderNo: order.orderNo }),
        zp_trans_id: 240824000000001,
        server_time: now.getTime(),
        ...overrides,
    });
    return JSON.stringify({ data, mac: createHmac("sha256", "key-two").update(data).digest("hex"), type: 1 });
}
