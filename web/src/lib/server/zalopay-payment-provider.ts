import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { BillingInputError } from "@/lib/server/billing-errors";
import { getPaymentRuntimeEnv, type PaymentRuntimeConfig } from "./payment-config-store";
import type { CreatePaymentCheckoutOptions, PaymentCheckoutResult } from "./payment-checkout-types";
import type { ParsedPaymentWebhook } from "./payment-webhook-adapters";
import { assertFiatTopUpCheckout, type TopUpOrder } from "./top-up-payment";

const SANDBOX_API_BASE = "https://sb-openapi.zalopay.vn";
const PRODUCTION_API_BASE = "https://openapi.zalopay.vn";
const MIN_EXPIRY_SECONDS = 300;
const MAX_EXPIRY_SECONDS = 2_592_000;
const RETRYABLE_PAYMENT_FAILURE_CODES = new Set([-63, -217, -332, -333, -1330, -1331, -1332, -1333, -1340, -1341, -1342, -1343]);

export type ZaloPayQueryResult =
    | { status: "paid"; providerOrderId: string; providerPaymentId: string; amountMinor: string; paidAt: string; payload: unknown }
    | { status: "pending"; providerOrderId: string; payload: unknown }
    | { status: "expired"; providerOrderId: string; payload: unknown };

export function buildZaloPayAppTransId(orderId: string, now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
    const suffix = createHash("sha256").update(orderId).digest("hex").slice(0, 32);
    return `${part("year")}${part("month")}${part("day")}_${suffix}`;
}

export async function createZaloPayCheckout(order: TopUpOrder, options: CreatePaymentCheckoutOptions, config: PaymentRuntimeConfig, now = new Date()): Promise<PaymentCheckoutResult> {
    const amount = assertZaloPayAmount(order);
    const appId = requiredConfig(config, "VOZEB_PRO_ZALOPAY_APP_ID");
    const key1 = requiredConfig(config, "VOZEB_PRO_ZALOPAY_KEY1");
    const origin = normalizedOrigin(options.origin);
    const appTransId = buildZaloPayAppTransId(order.id, now);
    const redirectUrl = redirectUrlForOrder(getPaymentRuntimeEnv(config, "VOZEB_PRO_ZALOPAY_REDIRECT_URL") || `${origin}/billing/success`, order.id);
    const callbackUrl = getPaymentRuntimeEnv(config, "VOZEB_PRO_ZALOPAY_CALLBACK_URL") || `${origin}/api/billing/webhooks/zalopay`;
    const preferredPaymentMethods = commaSeparated(getPaymentRuntimeEnv(config, "VOZEB_PRO_ZALOPAY_PREFERRED_PAYMENT_METHODS"));
    const embedData = JSON.stringify({
        redirecturl: redirectUrl,
        vozebProOrderId: order.id,
        vozebProOrderNo: order.orderNo,
        ...(preferredPaymentMethods.length ? { preferred_payment_method: preferredPaymentMethods } : {}),
    });
    const item = "[]";
    const params = new URLSearchParams({
        app_id: appId,
        app_user: order.userId.slice(0, 50),
        app_trans_id: appTransId,
        app_time: String(now.getTime()),
        amount,
        item,
        description: order.subject.slice(0, 256),
        embed_data: embedData,
        callback_url: callbackUrl,
        bank_code: "",
    });
    const subAppId = getPaymentRuntimeEnv(config, "VOZEB_PRO_ZALOPAY_SUB_APP_ID");
    if (subAppId) params.set("sub_app_id", subAppId);
    params.set("expire_duration_seconds", String(expirySeconds(order, now)));
    params.set("mac", hmac(key1, [appId, appTransId, params.get("app_user"), amount, params.get("app_time"), embedData, item].join("|")));

    const response = await fetchZaloPay(`${apiBase(config)}/v2/create`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(20_000),
    });
    const payload = await responseJson(response);
    if (!response.ok || integer(payload.return_code) !== 1) throw new BillingInputError(providerError("ZaloPay 创建订单失败", payload), response.status >= 500 ? 502 : 400);
    const url = httpsUrl(payload.order_url);
    if (!url) throw new BillingInputError("ZaloPay 未返回有效支付链接", 502);
    return {
        provider: "zalopay",
        orderId: order.id,
        orderNo: order.orderNo,
        kind: "redirect",
        url,
        qrContent: optionalText(payload.qr_code, 10_000),
        providerOrderId: appTransId,
        expiresAt: order.expiresAt,
    };
}

export async function queryZaloPayOrder(input: { appTransId: string }, config: PaymentRuntimeConfig): Promise<ZaloPayQueryResult> {
    const appId = requiredConfig(config, "VOZEB_PRO_ZALOPAY_APP_ID");
    const key1 = requiredConfig(config, "VOZEB_PRO_ZALOPAY_KEY1");
    const appTransId = normalizedAppTransId(input.appTransId);
    const params = new URLSearchParams({ app_id: appId, app_trans_id: appTransId, mac: hmac(key1, `${appId}|${appTransId}|${key1}`) });
    const response = await fetchZaloPay(`${apiBase(config)}/v2/query`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(20_000),
    });
    const payload = await responseJson(response);
    if (!response.ok) throw new BillingInputError(providerError("ZaloPay 查询订单失败", payload), response.status >= 500 ? 502 : 400);
    const returnCode = integer(payload.return_code);
    const subReturnCode = integer(payload.sub_return_code);
    if (returnCode === 3 || (returnCode === 2 && subReturnCode !== undefined && RETRYABLE_PAYMENT_FAILURE_CODES.has(subReturnCode))) return { status: "pending", providerOrderId: appTransId, payload };
    if (returnCode === 2 && subReturnCode === -54) return { status: "expired", providerOrderId: appTransId, payload };
    if (returnCode !== 1) throw new BillingInputError(providerError("ZaloPay 查询订单失败", payload), returnCode === 2 ? 409 : 502);
    const amountMinor = positiveIntegerText(payload.amount);
    const providerPaymentId = positiveIntegerText(payload.zp_trans_id);
    const paidAt = timestampIso(payload.server_time);
    if (!amountMinor || !providerPaymentId || !paidAt) throw new BillingInputError("ZaloPay 查询结果缺少有效支付信息", 502);
    return { status: "paid", providerOrderId: appTransId, providerPaymentId, amountMinor, paidAt, payload };
}

export function parseZaloPayCallback(rawBody: string, config: PaymentRuntimeConfig): ParsedPaymentWebhook {
    const envelope = jsonObject(rawBody, "ZaloPay 回调内容不是有效 JSON");
    const data = typeof envelope.data === "string" ? envelope.data : "";
    const signature = text(envelope.mac, 256);
    if (integer(envelope.type) !== 1) throw new BillingInputError("ZaloPay 回调类型无效", 400);
    if (!data || !signature) throw new BillingInputError("ZaloPay 回调缺少签名数据", 400);
    const key2 = requiredConfig(config, "VOZEB_PRO_ZALOPAY_KEY2");
    if (!safeHexEqual(signature, hmac(key2, data))) {
        return { eventId: invalidEventId(rawBody), eventType: "zalopay.payment.invalid", status: "ignored", payload: { type: envelope.type }, signatureValid: false };
    }

    const callback = jsonObject(data, "ZaloPay 回调数据不是有效 JSON");
    if (text(callback.app_id, 100) !== requiredConfig(config, "VOZEB_PRO_ZALOPAY_APP_ID")) throw new BillingInputError("ZaloPay 回调 App ID 不匹配", 400);
    const embedData = typeof callback.embed_data === "string" ? jsonObject(callback.embed_data, "ZaloPay 回调关联数据无效") : object(callback.embed_data);
    const providerPaymentId = positiveIntegerText(callback.zp_trans_id);
    const providerTradeId = normalizedAppTransId(callback.app_trans_id);
    const amountMinor = positiveIntegerText(callback.amount);
    const paidAt = timestampIso(callback.server_time);
    if (!providerPaymentId || !amountMinor || !paidAt) throw new BillingInputError("ZaloPay 回调缺少有效支付信息", 400);
    return {
        eventId: providerPaymentId,
        eventType: "zalopay.payment.succeeded",
        orderId: identifier(embedData.vozebProOrderId),
        orderNo: identifier(embedData.vozebProOrderNo),
        status: "succeeded",
        providerTradeId,
        providerPaymentId,
        amountMinor,
        currency: "VND",
        paidAt,
        payload: callback,
        signatureValid: true,
    };
}

export function assertZaloPayWebhookOrder(parsed: ParsedPaymentWebhook, order: TopUpOrder) {
    const expectedSuffix = createHash("sha256").update(order.id).digest("hex").slice(0, 32);
    if (parsed.orderId !== order.id || parsed.orderNo !== order.orderNo) throw new BillingInputError("ZaloPay 回调订单身份不匹配", 409);
    if (!parsed.providerTradeId || !new RegExp(`^\\d{6}_${expectedSuffix}$`).test(parsed.providerTradeId)) throw new BillingInputError("ZaloPay 商户交易号与订单不匹配", 409);
    if (order.providerOrderId && parsed.providerTradeId !== order.providerOrderId) throw new BillingInputError("ZaloPay 商户交易号与已保存订单不匹配", 409);
    if (order.providerPaymentId && parsed.providerPaymentId !== order.providerPaymentId) throw new BillingInputError("ZaloPay 支付交易号与已保存订单不匹配", 409);
}

function assertZaloPayAmount(order: TopUpOrder) {
    const amount = assertFiatTopUpCheckout(order.paymentAmount);
    if (amount.currency !== "VND" || amount.minorUnitExponent !== 0 || !/^[1-9]\d*$/.test(amount.amountMinor)) throw new BillingInputError("ZaloPay 仅支持正整数 VND 充值", 400);
    return amount.amountMinor;
}

function expirySeconds(order: TopUpOrder, now: Date) {
    const expiresAt = order.expiresAt ? Date.parse(order.expiresAt) : Number.NaN;
    const seconds = Math.floor((expiresAt - now.getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < MIN_EXPIRY_SECONDS || seconds > MAX_EXPIRY_SECONDS) throw new BillingInputError("ZaloPay 订单有效期必须在 300 至 2592000 秒之间", 409);
    return seconds;
}

function apiBase(config: PaymentRuntimeConfig) {
    const environment = requiredConfig(config, "VOZEB_PRO_ZALOPAY_ENVIRONMENT");
    if (environment !== "sandbox" && environment !== "production") throw new BillingInputError("ZaloPay 运行环境配置无效", 500);
    const override = getPaymentRuntimeEnv(config, "VOZEB_PRO_ZALOPAY_API_BASE").replace(/\/+$/, "");
    if (override) return override;
    return environment === "sandbox" ? SANDBOX_API_BASE : PRODUCTION_API_BASE;
}

function requiredConfig(config: PaymentRuntimeConfig, name: string) {
    const value = getPaymentRuntimeEnv(config, name);
    if (!value) throw new BillingInputError(`缺少 ZaloPay 支付配置：${name}`, 500);
    return value;
}

function normalizedOrigin(value?: string) {
    const origin = (value || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
    try {
        return new URL(origin).origin;
    } catch {
        throw new BillingInputError("站点地址无效", 500);
    }
}

function redirectUrlForOrder(value: string, orderId: string) {
    try {
        const url = new URL(value);
        url.searchParams.set("orderId", orderId);
        return url.toString();
    } catch {
        throw new BillingInputError("ZaloPay 支付返回地址无效", 500);
    }
}

function normalizedAppTransId(value: unknown) {
    const result = text(value, 40);
    if (!/^\d{6}_[a-zA-Z0-9]+$/.test(result)) throw new BillingInputError("ZaloPay 商户交易号无效", 400);
    return result;
}

function hmac(key: string, data: string) {
    return createHmac("sha256", key).update(data).digest("hex");
}

function safeHexEqual(left: string, right: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(left) || !/^[a-fA-F0-9]{64}$/.test(right)) return false;
    try {
        const leftBuffer = Buffer.from(left, "hex");
        const rightBuffer = Buffer.from(right, "hex");
        return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
    } catch {
        return false;
    }
}

async function responseJson(response: Response) {
    const value = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingInputError("ZaloPay 返回内容无效", 502);
    return value as Record<string, unknown>;
}

function jsonObject(value: string, message: string) {
    try {
        return object(JSON.parse(value));
    } catch {
        throw new BillingInputError(message, 400);
    }
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingInputError("ZaloPay 数据结构无效", 400);
    return value as Record<string, unknown>;
}

function integer(value: unknown) {
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : undefined;
}

function positiveIntegerText(value: unknown) {
    const result = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    return /^[1-9]\d*$/.test(result) ? BigInt(result).toString() : undefined;
}

function timestampIso(value: unknown) {
    const milliseconds = Number(value);
    const date = new Date(milliseconds);
    return milliseconds > 0 && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function identifier(value: unknown) {
    const result = text(value, 160).replace(/[^a-zA-Z0-9_.:-]/g, "");
    return result || undefined;
}

function text(value: unknown, maxLength: number) {
    return (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value)).trim().slice(0, maxLength);
}

function optionalText(value: unknown, maxLength: number) {
    return text(value, maxLength) || undefined;
}

function httpsUrl(value: unknown) {
    try {
        const url = new URL(text(value, 2_000));
        return url.protocol === "https:" ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

function commaSeparated(value: string) {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function providerError(fallback: string, payload: Record<string, unknown>) {
    const returnCode = integer(payload.return_code);
    const subReturnCode = integer(payload.sub_return_code);
    return `${fallback}${returnCode === undefined ? "" : `（return_code: ${returnCode}${subReturnCode === undefined ? "" : `, sub_return_code: ${subReturnCode}`}）`}`;
}

function invalidEventId(rawBody: string) {
    return `zalopay_invalid_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

async function fetchZaloPay(url: string, init: RequestInit) {
    const { fetchSafeOutbound } = await import("@/lib/server/safe-outbound-fetch");
    try {
        return await fetchSafeOutbound(url, init);
    } catch {
        throw new BillingInputError("连接 ZaloPay 失败", 502);
    }
}
