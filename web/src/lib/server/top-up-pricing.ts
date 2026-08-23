import type { PaymentAmount } from "@/lib/billing/money";
import { decimal } from "@/lib/billing/decimal";
import { BillingInputError } from "@/lib/server/billing-errors";

export type TopUpPreset = {
    id: string;
    name: string;
    description: string;
    nominalNativeAmount: string;
    enabled: boolean;
    sortOrder: number;
};

export type TopUpPricingConfig = {
    version: string;
    currency: "VND";
    minorUnitExponent: 0;
    customerFx: { version: string; usdPerVnd: string };
};

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
    customerFx: TopUpPricingConfig["customerFx"];
    paymentAmount: PaymentAmount;
    promotion?: { id: string; label: string };
    coupon?: { userCouponId: string; templateId: string; type: "fixed" | "percentage"; value: string; currency?: string };
};

export type TopUpCouponRule = NonNullable<TopUpQuote["coupon"]>;

export function quoteTopUp(_input: {
    request: { presetId?: unknown; customAmountVnd?: unknown };
    config: TopUpPricingConfig;
    preset?: TopUpPreset;
    promotion?: { id: string; label: string; payableNativeAmount: string };
    coupon?: TopUpCouponRule;
}): TopUpQuote {
    const input = _input;
    validateConfig(input.config);
    const requestedPresetId = text(input.request.presetId);
    let nominal;
    let presetId: string | undefined;
    if (requestedPresetId) {
        if (!input.preset || input.preset.id !== requestedPresetId || !input.preset.enabled) throw new BillingInputError("充值预设不存在或已停用", 404);
        nominal = positive(input.preset.nominalNativeAmount, "预设充值金额");
        presetId = input.preset.id;
    } else {
        nominal = positive(input.request.customAmountVnd, "自定义充值金额");
    }
    if (!nominal.hasAtMostDecimalPlaces(input.config.minorUnitExponent)) throw new BillingInputError("VND 充值金额必须是整数");

    const promoted = input.promotion ? positive(input.promotion.payableNativeAmount, "活动应付金额") : nominal;
    if (promoted.greaterThan(nominal)) throw new BillingInputError("活动金额不能高于标称金额");
    const promotionDiscount = nominal.minus(promoted);
    const couponDiscount = calculateCouponDiscount(promoted, input.coupon, input.config.currency);
    const payable = promoted.minus(couponDiscount);
    if (!payable.greaterThan(decimal(0))) throw new BillingInputError("应付金额必须大于零");
    const providerPayable = payable.roundHalfUp(input.config.minorUnitExponent);
    const usdPerVnd = positive(input.config.customerFx.usdPerVnd, "客户汇率");
    const nominalUsdValue = nominal.times(usdPerVnd);
    const paidUsdValue = providerPayable.times(usdPerVnd);

    return {
        ...(presetId ? { presetId } : {}),
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: nominal.toString(),
        promotionDiscountNativeAmount: promotionDiscount.toString(),
        couponDiscountNativeAmount: couponDiscount.toString(),
        payableNativeAmount: providerPayable.toString(),
        nominalUsdValue: nominalUsdValue.toString(),
        paidUsdValue: paidUsdValue.toString(),
        creditAmount: nominalUsdValue.roundHalfUp(8).toString(),
        pricingVersion: input.config.version,
        customerFx: { ...input.config.customerFx },
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: providerPayable.toString(), minorUnitExponent: 0 },
        ...(input.promotion ? { promotion: { id: input.promotion.id, label: input.promotion.label } } : {}),
        ...(input.coupon ? { coupon: { ...input.coupon } } : {}),
    };
}

function calculateCouponDiscount(base: ReturnType<typeof decimal>, coupon: TopUpCouponRule | undefined, currency: string) {
    if (!coupon) return decimal(0);
    const value = positive(coupon.value, "优惠券折扣");
    if (coupon.type === "fixed") {
        if (text(coupon.currency).toUpperCase() !== currency) throw new BillingInputError("固定优惠券币种与订单币种不一致", 409);
        if (value.greaterThan(base)) throw new BillingInputError("优惠券折扣不能高于应付金额", 409);
        return value;
    }
    if (value.greaterThan(decimal(10000))) throw new BillingInputError("百分比优惠券折扣无效");
    return base.times(value).dividedBy(decimal(10000));
}

function validateConfig(config: TopUpPricingConfig) {
    if (config.currency !== "VND" || config.minorUnitExponent !== 0) throw new BillingInputError("VND 币种指数配置无效");
    if (!text(config.version) || !text(config.customerFx.version)) throw new BillingInputError("充值价格或汇率版本不能为空");
    const rate = positive(config.customerFx.usdPerVnd, "客户汇率");
    if (!rate.hasAtMostDecimalPlaces(12)) throw new BillingInputError("客户汇率最多保留 12 位小数");
}

function positive(value: unknown, label: string) {
    let normalized;
    try {
        normalized = decimal(value as string, label);
    } catch (error) {
        throw new BillingInputError(error instanceof Error ? error.message : `${label}无效`);
    }
    if (!normalized.greaterThan(decimal(0))) throw new BillingInputError(`${label}必须大于零`);
    return normalized;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
