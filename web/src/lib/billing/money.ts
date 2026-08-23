import { decimal, decimalText, type DecimalInput } from "./decimal";

export type ProviderCostUnit =
    | { kind: "fiat"; currency: "USD" }
    | { kind: "provider-native"; provider: string; unit: string; usdConversion: { version: string; usdPerUnit: string } };

export type FiatPaymentAmount = {
    kind: "fiat";
    currency: string;
    amount: string;
    exponent: number;
};

export type CryptoPaymentAmount = {
    kind: "crypto";
    asset: string;
    amount: string;
    network: string;
};

export type PaymentAmount = FiatPaymentAmount | CryptoPaymentAmount;

export function normalizeProviderCostUnit(input: unknown): ProviderCostUnit | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
    const value = input as Partial<ProviderCostUnit>;
    if (value.kind === "fiat") return value.currency === "USD" ? { kind: "fiat", currency: "USD" } : undefined;
    if (value.kind !== "provider-native") return undefined;
    try {
        const provider = text(value.provider);
        const unit = text(value.unit);
        const version = text(value.usdConversion?.version);
        const usdPerUnit = positiveDecimal(value.usdConversion?.usdPerUnit);
        return provider && unit && version ? { kind: "provider-native", provider, unit, usdConversion: { version, usdPerUnit: usdPerUnit.toString() } } : undefined;
    } catch {
        return undefined;
    }
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
    return decimalText(attempts.reduce((total, attempt) => total.plus(convertProviderCostToUsd(attempt.amount, attempt.unit)), decimal(0)));
}

function nonNegativeDecimal(value: DecimalInput, label: string) {
    const normalized = decimal(value, label);
    if (normalized.isNegative()) throw new Error(`${label}不能为负数`);
    return normalized;
}

function positiveDecimal(value: DecimalInput | undefined) {
    const normalized = decimal(value || "", "USD 转换快照");
    if (!normalized.greaterThan(0)) throw new Error("USD 转换快照必须大于零");
    return normalized;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 120) : "";
}
