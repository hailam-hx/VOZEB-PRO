import { decimal } from "@/lib/billing/decimal";

export function projectAdminPointAdjustment(input: { settledBalance: string; heldBalance: string; operation: "increase" | "decrease"; amount: string }) {
    if (!input.amount.trim()) return { valid: false as const };
    try {
        const amount = decimal(input.amount);
        if (amount.isNegative() || amount.isZero()) return { valid: false as const };
        if (!amount.hasAtMostDecimalPlaces(8)) return { valid: false as const, error: "调整积分最多保留 8 位小数" };
        const balanceAfter = input.operation === "decrease" ? decimal(input.settledBalance).minus(amount) : decimal(input.settledBalance).plus(amount);
        const availableAfter = balanceAfter.minus(decimal(input.heldBalance));
        if (balanceAfter.isNegative() || availableAfter.isNegative()) return { balanceAfter: balanceAfter.toString(), availableAfter: availableAfter.toString(), valid: false as const, error: "扣减后结算余额不能低于当前预留积分" };
        return { balanceAfter: balanceAfter.toString(), availableAfter: availableAfter.toString(), valid: true as const };
    } catch {
        return { valid: false as const };
    }
}
