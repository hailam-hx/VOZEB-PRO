import { randomBytes, randomUUID } from "node:crypto";

import { normalizePaymentProvider } from "@/lib/payment-provider";
import { BillingInputError } from "@/lib/server/billing-errors";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, withPostgresTransaction, type QueryExecutor } from "@/lib/server/database";
import { getPaymentRuntimeConfig, isPaymentRuntimeProviderCheckoutReady } from "@/lib/server/payment-config-store";
import type { TopUpOrder } from "./top-up-payment";
import { quoteTopUp, type TopUpPricingConfig } from "./top-up-pricing";
import { decimal } from "@/lib/billing/decimal";
import type { TopUpPreset } from "./top-up-pricing";

type TopUpRequest = { userId: string; presetId?: unknown; customAmountVnd?: unknown; provider?: unknown; promotionId?: unknown; userCouponId?: unknown };

export async function listTopUpPresets(includeDisabled = false) {
    await assertTopUpDatabase();
    return createPostgresRepositories().topUps.listPresets(includeDisabled);
}

export async function saveTopUpPreset(input: { id?: unknown; name?: unknown; description?: unknown; nominalNativeAmount?: unknown; enabled?: unknown; sortOrder?: unknown }) {
    await assertTopUpDatabase();
    const id = normalizeId(input.id) || randomUUID();
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
    if (!name) throw new BillingInputError("充值预设名称不能为空");
    let amount;
    try {
        amount = decimal(input.nominalNativeAmount as string, "充值预设金额");
    } catch (error) {
        throw new BillingInputError(error instanceof Error ? error.message : "充值预设金额无效");
    }
    if (!amount.greaterThan(decimal(0)) || !amount.hasAtMostDecimalPlaces(0)) throw new BillingInputError("充值预设金额必须为正整数 VND");
    const preset: TopUpPreset = {
        id,
        name,
        description: typeof input.description === "string" ? input.description.trim().slice(0, 300) : "",
        nominalNativeAmount: amount.toString(),
        enabled: input.enabled !== false,
        sortOrder: Number.isSafeInteger(input.sortOrder) ? Number(input.sortOrder) : 0,
    };
    return createPostgresRepositories().topUps.savePreset(preset);
}

export async function deleteTopUpPreset(id: string) {
    await assertTopUpDatabase();
    if (!(await createPostgresRepositories().topUps.deletePreset(normalizeId(id)))) throw new BillingInputError("充值预设不存在", 404);
}

export async function quoteTopUpOrder(input: TopUpRequest) {
    await assertTopUpDatabase();
    const config = await pricingConfig();
    return withPostgresTransaction((client) => quoteInTransaction(client, input, config));
}

export async function createTopUpOrder(input: TopUpRequest) {
    await assertTopUpDatabase();
    const runtime = await getPaymentRuntimeConfig();
    const config = pricingConfigFromRuntime(runtime.topUp);
    const provider = normalizePaymentProvider(input.provider);
    if (!isPaymentRuntimeProviderCheckoutReady(runtime, provider)) throw new BillingInputError("该支付渠道未启用或配置不完整", 400);
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const { quote, presetName } = await quoteInTransaction(client, input, config, true);
        const now = new Date();
        const order: TopUpOrder = {
            id: randomUUID(),
            orderNo: generateOrderNo(),
            userId: input.userId,
            status: "pending",
            paymentState: "pending",
            creditGrantState: "pending",
            providerRefundState: "none",
            creditRecoveryState: "none",
            subject: presetName || "自定义积分充值",
            ...(quote.presetId ? { presetId: quote.presetId } : {}),
            currency: quote.currency,
            currencyExponent: quote.currencyExponent,
            nominalNativeAmount: quote.nominalNativeAmount,
            promotionDiscountNativeAmount: quote.promotionDiscountNativeAmount,
            couponDiscountNativeAmount: quote.couponDiscountNativeAmount,
            payableNativeAmount: quote.payableNativeAmount,
            nominalUsdValue: quote.nominalUsdValue,
            paidUsdValue: quote.paidUsdValue,
            creditAmount: quote.creditAmount,
            pricingVersion: quote.pricingVersion,
            customerFxVersion: quote.customerFx.version,
            customerFxRate: quote.customerFx.usdPerVnd,
            paymentAmount: quote.paymentAmount,
            provider,
            ...(quote.promotion ? { promotionCampaignId: quote.promotion.id } : {}),
            ...(quote.coupon ? { userCouponId: quote.coupon.userCouponId } : {}),
            snapshot: { quote: quote as never },
            expiresAt: new Date(now.getTime() + orderExpiresMinutes() * 60_000).toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
        const created = await repos.topUps.createOrder(order);
        if (quote.coupon && !(await repos.topUps.lockCoupon(quote.coupon.userCouponId, created.id))) throw new BillingInputError("优惠券状态已变化", 409);
        return created;
    });
}

export async function getTopUpOrderForUser(userId: string, orderId: string) {
    await assertTopUpDatabase();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const order = await repos.topUps.getOrderById(normalizeId(orderId), true);
        if (!order || order.userId !== userId) throw new BillingInputError("充值订单不存在", 404);
        if (order.status === "pending" && order.expiresAt && Date.parse(order.expiresAt) <= Date.now() && !(order.provider === "zalopay" && order.providerOrderId)) {
            return (await repos.topUps.expirePendingOrder(order.id, new Date().toISOString())) || order;
        }
        return order;
    });
}

export async function cancelTopUpOrderForUser(userId: string, orderId: string) {
    await assertTopUpDatabase();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const current = await repos.topUps.getOrderById(normalizeId(orderId), true);
        if (!current || current.userId !== userId || current.status !== "pending") throw new BillingInputError("充值订单不存在或状态不可取消", 409);
        if (current.provider === "zalopay" && current.providerOrderId) throw new BillingInputError("ZaloPay 订单已发起支付，请先同步支付状态", 409);
        const order = await repos.topUps.cancelPendingOrder(normalizeId(orderId), userId);
        if (!order) throw new BillingInputError("充值订单不存在或状态不可取消", 409);
        if (order.userCouponId && !(await repos.topUps.releaseCouponForOrder(order.userCouponId, order.id))) throw new BillingInputError("充值订单优惠券绑定状态不可释放", 409);
        return order;
    });
}

export async function listTopUpOrdersForUser(userId: string, input: { page?: number; pageSize?: number } = {}) {
    await assertTopUpDatabase();
    return createPostgresRepositories().topUps.listOrdersForUser(userId, input);
}

export async function listAdminTopUpOrders(input: { page?: number; pageSize?: number; userId?: string; status?: TopUpOrder["status"]; keyword?: string } = {}) {
    await assertTopUpDatabase();
    return createPostgresRepositories().topUps.listOrders(input);
}

async function quoteInTransaction(client: QueryExecutor, input: TopUpRequest, config: TopUpPricingConfig, lockCoupon = false) {
    const repos = createPostgresRepositories(client);
    const user = await repos.users.getById(input.userId);
    if (!user || user.status !== "active") throw new BillingInputError("用户不可用", 403);
    const presetId = normalizeId(input.presetId);
    const preset = presetId ? await repos.topUps.getPresetById(presetId) : undefined;
    const promotionId = normalizeId(input.promotionId);
    const userCouponId = normalizeId(input.userCouponId);
    const promotionRule = promotionId ? await repos.topUps.getPromotion(promotionId, presetId || undefined) : null;
    if (promotionId && !promotionRule) throw new BillingInputError("充值活动不存在或不可用", 404);
    const coupon = userCouponId ? await repos.topUps.getAvailableCoupon(userCouponId, input.userId, lockCoupon) : null;
    if (userCouponId && !coupon) throw new BillingInputError("优惠券不存在或不可用", 404);
    const nominalText = preset?.nominalNativeAmount || (typeof input.customAmountVnd === "string" ? input.customAmountVnd : "");
    const nominal = decimal(nominalText, "充值金额");
    const promotion = promotionRule
        ? {
              id: promotionRule.id,
              label: promotionRule.label,
              payableNativeAmount: promotionRule.type === "fixed" ? nominal.minus(decimal(promotionRule.value)).toString() : nominal.minus(nominal.times(decimal(promotionRule.value)).dividedBy(decimal(10000))).toString(),
          }
        : undefined;
    if (promotionRule?.type === "fixed" && promotionRule.currency !== "VND") throw new BillingInputError("固定活动币种与订单币种不一致", 409);
    const quote = quoteTopUp({ request: { presetId: presetId || undefined, customAmountVnd: input.customAmountVnd }, config, preset: preset || undefined, promotion, coupon: coupon || undefined });
    return { quote, presetName: preset?.name };
}

async function pricingConfig() {
    return pricingConfigFromRuntime((await getPaymentRuntimeConfig()).topUp);
}

function pricingConfigFromRuntime(value: Awaited<ReturnType<typeof getPaymentRuntimeConfig>>["topUp"]): TopUpPricingConfig {
    if (!value) throw new BillingInputError("充值价格与 VND/USD 汇率尚未配置", 503);
    return { version: value.pricingVersion, currency: "VND", minorUnitExponent: 0, customerFx: { version: value.customerFxVersion, usdPerVnd: value.usdPerVnd } };
}

async function assertTopUpDatabase() {
    if (!isPostgresDatabaseEnabled()) throw new BillingInputError("充值交易需要启用 PostgreSQL", 501);
    await ensurePostgresSchema();
}

function generateOrderNo() {
    const now = new Date();
    const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].map((value, index) => (index ? String(value).padStart(2, "0") : String(value))).join("");
    return `VZ${stamp}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function orderExpiresMinutes() {
    const value = Number.parseInt(process.env.VOZEB_PRO_TOP_UP_ORDER_EXPIRES_MINUTES || "30", 10);
    return Number.isSafeInteger(value) && value >= 1 && value <= 24 * 60 ? value : 30;
}

function normalizeId(value: unknown) {
    return typeof value === "string"
        ? value
              .trim()
              .slice(0, 120)
              .replace(/[^a-zA-Z0-9_.:-]/g, "")
        : "";
}
