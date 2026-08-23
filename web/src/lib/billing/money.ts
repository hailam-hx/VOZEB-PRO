import { decimal, decimalText, type DecimalInput } from "./decimal";

export type ProviderCostUnit = { kind: "fiat"; currency: "USD" } | { kind: "provider-native"; provider: string; unit: string; usdConversion: { version: string; usdPerUnit: string } };

export type FiatPaymentAmount = {
    kind: "fiat";
    currency: string;
    amountMinor: string;
    minorUnitExponent: number;
};

export type CryptoPaymentAmount = {
    kind: "crypto";
    asset: string;
    network: string;
    amountAtomic: string;
    decimals: number;
    txHash?: string;
};

export type PaymentAmount = FiatPaymentAmount | CryptoPaymentAmount;

export function validatePaymentAmount(input: unknown): PaymentAmount {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("支付金额无效");
    const value = input as Record<string, unknown>;
    if (value.kind === "fiat") {
        const currency = text(value.currency).toUpperCase();
        if (currency !== "VND") throw new Error("暂不支持该法币");
        const amountMinor = unsignedIntegerText(value.amountMinor, "支付最小单位");
        if (value.minorUnitExponent !== 0) throw new Error("支付币种指数与服务端配置不一致");
        return { kind: "fiat", currency, amountMinor, minorUnitExponent: 0 };
    }
    if (value.kind !== "crypto") throw new Error("支付金额类型无效");
    const asset = text(value.asset).toUpperCase();
    const network = text(value.network).toUpperCase();
    if (!asset || !network) throw new Error("加密资产和网络不能为空");
    const amountAtomic = unsignedIntegerText(value.amountAtomic, "加密原子单位");
    if (!Number.isSafeInteger(value.decimals) || Number(value.decimals) < 0 || Number(value.decimals) > 30) throw new Error("加密资产小数位无效");
    const txHash = text(value.txHash).toLowerCase();
    return { kind: "crypto", asset, network, amountAtomic, decimals: Number(value.decimals), ...(txHash ? { txHash } : {}) };
}

export function validateProviderCostUnit(input: unknown): ProviderCostUnit {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("供应商成本单位无效");
    const value = input as Partial<ProviderCostUnit>;
    if (value.kind === "fiat") {
        if (value.currency !== "USD") throw new Error("供应商法币成本必须为 USD");
        return { kind: "fiat", currency: "USD" };
    }
    if (value.kind !== "provider-native") throw new Error("供应商成本单位无效");
    const provider = text(value.provider);
    const unit = text(value.unit);
    const version = text(value.usdConversion?.version);
    if (!provider || !unit || !version) throw new Error("供应商原生单位需要版本化 USD 转换快照");
    return { kind: "provider-native", provider, unit, usdConversion: { version, usdPerUnit: positiveDecimal(value.usdConversion?.usdPerUnit).toString() } };
}

export function convertProviderCostToUsd(amount: DecimalInput, unit: ProviderCostUnit) {
    const cost = nonNegativeDecimal(amount, "供应商成本");
    if (unit.kind === "fiat") {
        if (unit.currency !== "USD") throw new Error("供应商法币成本必须为 USD");
        return cost.toString();
    }
    const conversion = unit.usdConversion;
    if (!conversion?.version || !conversion.usdPerUnit) throw new Error("供应商原生单位需要版本化 USD 转换快照");
    return cost.times(positiveDecimal(conversion.usdPerUnit)).toString();
}

export function sumProviderAttemptCostUsd(attempts: Array<{ amount: DecimalInput; unit: ProviderCostUnit }>) {
    return decimalText(attempts.reduce((total, attempt) => total.plus(decimal(convertProviderCostToUsd(attempt.amount, attempt.unit))), decimal(0)));
}

function nonNegativeDecimal(value: DecimalInput, label: string) {
    const normalized = decimal(value, label);
    if (normalized.isNegative()) throw new Error(`${label}不能为负数`);
    return normalized;
}

function positiveDecimal(value: DecimalInput | undefined) {
    const normalized = decimal(value || "", "USD 转换快照");
    if (!normalized.greaterThan(decimal(0))) throw new Error("USD 转换快照必须大于零");
    return normalized;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function unsignedIntegerText(value: unknown, label: string) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${label}必须使用整数文本`);
    return BigInt(value).toString();
}
