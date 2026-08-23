import Decimal from "decimal.js";

export type DecimalInput = Decimal.Value;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

export class ExactDecimal {
    constructor(
        readonly numerator: bigint,
        readonly denominator: bigint,
    ) {}

    static from(value: DecimalInput, label = "金额") {
        try {
            const parsed = new Decimal(value);
            if (!parsed.isFinite()) throw new Error();
            return fromDecimalText(parsed.toFixed());
        } catch {
            throw new Error(`${label}必须是有限小数`);
        }
    }

    plus(value: ExactDecimal) {
        return exact(this.numerator * value.denominator + value.numerator * this.denominator, this.denominator * value.denominator);
    }

    minus(value: ExactDecimal) {
        return exact(this.numerator * value.denominator - value.numerator * this.denominator, this.denominator * value.denominator);
    }

    times(value: ExactDecimal) {
        return exact(this.numerator * value.numerator, this.denominator * value.denominator);
    }

    dividedBy(value: ExactDecimal) {
        if (value.numerator === ZERO) throw new Error("计价单位不能为零");
        return exact(this.numerator * value.denominator, this.denominator * value.numerator);
    }

    greaterThan(value: ExactDecimal) {
        return this.numerator * value.denominator > value.numerator * this.denominator;
    }

    lessThanOrEqualTo(value: ExactDecimal) {
        return this.numerator * value.denominator <= value.numerator * this.denominator;
    }

    isNegative() {
        return this.numerator < ZERO;
    }

    isZero() {
        return this.numerator === ZERO;
    }

    hasAtMostDecimalPlaces(scale: number) {
        return this.toScaledInteger(scale).exact;
    }

    ceilToDecimalPlaces(scale: number) {
        const scaled = this.numerator * powerOfTen(scale);
        const quotient = scaled / this.denominator;
        const remainder = scaled % this.denominator;
        return fromScaledInteger(remainder && scaled > ZERO ? quotient + ONE : quotient, scale);
    }

    roundHalfUp(scale: number) {
        const factor = powerOfTen(scale);
        const sign = this.numerator < ZERO ? -ONE : ONE;
        const absolute = this.numerator < ZERO ? -this.numerator : this.numerator;
        const scaled = absolute * factor;
        const quotient = scaled / this.denominator;
        const remainder = scaled % this.denominator;
        return fromScaledInteger(sign * (remainder * TWO >= this.denominator ? quotient + ONE : quotient), scale);
    }

    toString() {
        const scale = terminatingScale(this.denominator);
        if (scale === undefined) throw new Error("小数无法精确表示");
        return formatScaledInteger(this.toScaledInteger(scale).value, scale);
    }

    private toScaledInteger(scale: number) {
        const numerator = this.numerator * powerOfTen(scale);
        return { value: numerator / this.denominator, exact: numerator % this.denominator === ZERO };
    }
}

export function decimal(value: DecimalInput, label = "金额") {
    return ExactDecimal.from(value, label);
}

export function decimalText(value: ExactDecimal) {
    return value.toString();
}

export function hasTerminatingDecimal(value: ExactDecimal) {
    return terminatingScale(value.denominator) !== undefined;
}

function fromDecimalText(value: string) {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new Error();
    const fraction = match[3] || "";
    const numerator = BigInt(`${match[1] || ""}${match[2]}${fraction}`);
    return exact(numerator, powerOfTen(fraction.length));
}

function fromScaledInteger(value: bigint, scale: number) {
    return exact(value, powerOfTen(scale));
}

function exact(numerator: bigint, denominator: bigint) {
    if (denominator < ZERO) return exact(-numerator, -denominator);
    const divisor = gcd(numerator < ZERO ? -numerator : numerator, denominator);
    return new ExactDecimal(numerator / divisor, denominator / divisor);
}

function gcd(left: bigint, right: bigint): bigint {
    let a = left;
    let b = right;
    while (b) [a, b] = [b, a % b];
    return a || ONE;
}

function powerOfTen(scale: number) {
    if (!Number.isSafeInteger(scale) || scale < 0) throw new Error("小数位数无效");
    return TEN ** BigInt(scale);
}

function terminatingScale(denominator: bigint) {
    let value = denominator;
    let twos = 0;
    let fives = 0;
    while (value % TWO === ZERO) {
        value /= TWO;
        twos += 1;
    }
    const FIVE = BigInt(5);
    while (value % FIVE === ZERO) {
        value /= FIVE;
        fives += 1;
    }
    return value === ONE ? Math.max(twos, fives) : undefined;
}

function formatScaledInteger(value: bigint, scale: number) {
    const sign = value < ZERO ? "-" : "";
    const digits = (value < ZERO ? -value : value).toString().padStart(scale + 1, "0");
    if (!scale) return `${sign}${digits}`;
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, "");
    return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
