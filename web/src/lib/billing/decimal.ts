import Decimal from "decimal.js";

const DecimalValue = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

export type DecimalInput = Decimal.Value;

export function decimal(value: DecimalInput, label = "金额") {
    try {
        const result = new DecimalValue(value);
        if (!result.isFinite()) throw new Error();
        return result;
    } catch {
        throw new Error(`${label}必须是有限小数`);
    }
}

export function decimalText(value: Decimal.Value) {
    return decimal(value).toString();
}
