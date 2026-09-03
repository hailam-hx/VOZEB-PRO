import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { PaymentRuntimeConfig } from "./payment-config-store";
import { resolveWebhookAdapter } from "./payment-webhook-adapters";

const alipayKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const alipayPublicKey = alipayKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

describe("Alipay payment webhook adapter", () => {
    it("verifies and parses the shared official/face-to-face callback", () => {
        const params = signedAlipayCallback();
        const parsed = resolveWebhookAdapter("alipay").parse("alipay", params.toString(), new Headers(), alipayConfig());

        expect(parsed).toMatchObject({
            signatureValid: true,
            status: "succeeded",
            eventType: "alipay.trade_success",
            orderId: "order-one",
            orderNo: "VZ001",
            providerTradeId: "2026072800000001",
            amountMinor: "1299",
            currency: "CNY",
        });
    });

    it("rejects callback data changed after signing", () => {
        const params = signedAlipayCallback();
        params.set("total_amount", "0.01");

        const parsed = resolveWebhookAdapter("alipay").parse("alipay", params.toString(), new Headers(), alipayConfig());

        expect(parsed.signatureValid).toBe(false);
    });
});

describe("ZaloPay payment webhook adapter", () => {
    it("uses the ZaloPay Key2 callback contract instead of the custom-provider signature", () => {
        const data = JSON.stringify({
            app_id: 2553,
            app_trans_id: "260824_0123456789abcdef0123456789abcdef",
            amount: 250000,
            embed_data: JSON.stringify({ vozebProOrderId: "order-one", vozebProOrderNo: "VZ001" }),
            zp_trans_id: 240824000000001,
            server_time: Date.parse("2026-08-24T10:00:00.000Z"),
        });
        const rawBody = JSON.stringify({ data, mac: createHmac("sha256", "callback-key").update(data).digest("hex"), type: 1 });
        const paymentConfig: PaymentRuntimeConfig = {
            saved: { providers: {} },
            providers: { zalopay: { enabled: true, saved: true } },
            valuesByEnvName: { VOZEB_PRO_ZALOPAY_APP_ID: "2553", VOZEB_PRO_ZALOPAY_KEY2: "callback-key" },
        };

        expect(resolveWebhookAdapter("zalopay").parse("zalopay", rawBody, new Headers(), paymentConfig)).toMatchObject({
            signatureValid: true,
            eventType: "zalopay.payment.succeeded",
            orderId: "order-one",
            orderNo: "VZ001",
            amountMinor: "250000",
            currency: "VND",
        });
    });
});

function signedAlipayCallback() {
    const params = new URLSearchParams({
        app_id: "2026000000000000",
        sign_type: "RSA2",
        notify_id: "notify-one",
        trade_no: "2026072800000001",
        trade_status: "TRADE_SUCCESS",
        out_trade_no: "VZ001",
        passback_params: encodeURIComponent("order-one"),
        total_amount: "12.99",
        gmt_payment: "2026-07-28 16:20:00",
    });
    const content = [...params.entries()]
        .filter(([key, value]) => key !== "sign_type" && value !== "")
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
    params.set("sign", createSign("RSA-SHA256").update(content, "utf8").sign(alipayKeyPair.privateKey, "base64"));
    return params;
}

function alipayConfig(): PaymentRuntimeConfig {
    return {
        saved: { providers: {} },
        providers: { alipay: { enabled: true, saved: true } },
        valuesByEnvName: {
            VOZEB_PRO_ALIPAY_MODE: "face_to_face",
            VOZEB_PRO_ALIPAY_APP_ID: "2026000000000000",
            VOZEB_PRO_ALIPAY_PUBLIC_KEY: alipayPublicKey,
        },
    };
}
