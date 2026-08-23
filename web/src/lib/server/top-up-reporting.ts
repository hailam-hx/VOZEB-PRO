import { decimal } from "@/lib/billing/decimal";
import { BillingInputError } from "@/lib/server/billing-errors";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import type { TopUpOrder } from "./top-up-payment";

export function summarizeTopUpFinancials(orders: TopUpOrder[]) {
    const currencies = new Map<string, { currency: string; paidNativeAmount: ReturnType<typeof decimal>; refundedNativeAmount: ReturnType<typeof decimal>; paidOrders: number; refundedOrders: number }>();
    let paidUsdValue = decimal(0);
    let refundedUsdValue = decimal(0);
    let nominalUsdValue = decimal(0);
    for (const order of orders) {
        if (order.paymentState !== "paid" && order.paymentState !== "refunded") continue;
        nominalUsdValue = nominalUsdValue.plus(decimal(order.nominalUsdValue));
        const group = currencies.get(order.currency) || { currency: order.currency, paidNativeAmount: decimal(0), refundedNativeAmount: decimal(0), paidOrders: 0, refundedOrders: 0 };
        if (order.paymentState === "paid") {
            group.paidNativeAmount = group.paidNativeAmount.plus(decimal(order.payableNativeAmount));
            group.paidOrders += 1;
            paidUsdValue = paidUsdValue.plus(decimal(order.paidUsdValue));
        } else {
            group.refundedNativeAmount = group.refundedNativeAmount.plus(decimal(order.payableNativeAmount));
            group.refundedOrders += 1;
            refundedUsdValue = refundedUsdValue.plus(decimal(order.paidUsdValue));
        }
        currencies.set(order.currency, group);
    }
    return {
        currencies: [...currencies.values()]
            .sort((left, right) => left.currency.localeCompare(right.currency))
            .map((group) => ({ ...group, paidNativeAmount: group.paidNativeAmount.toString(), refundedNativeAmount: group.refundedNativeAmount.toString() })),
        paidUsdValue: paidUsdValue.toString(),
        refundedUsdValue: refundedUsdValue.toString(),
        nominalUsdValue: nominalUsdValue.toString(),
    };
}

export function qualifiesReferralFromVerifiedTopUp(order: TopUpOrder, minimumUsdValue: string) {
    if (order.paymentState !== "paid" || order.creditGrantState !== "granted") return false;
    return decimal(minimumUsdValue, "推荐门槛").lessThanOrEqualTo(decimal(order.nominalUsdValue, "充值 USD 快照"));
}

export async function getTopUpFinancialSummary(input: { startDate?: string; endDate?: string } = {}) {
    if (!isPostgresDatabaseEnabled()) throw new BillingInputError("充值财务汇总需要启用 PostgreSQL", 501);
    await ensurePostgresSchema();
    const startAt = input.startDate ? dateBoundary(input.startDate, false) : undefined;
    const endBefore = input.endDate ? dateBoundary(input.endDate, true) : undefined;
    if (startAt && endBefore && Date.parse(startAt) >= Date.parse(endBefore)) throw new BillingInputError("财务汇总时间范围无效");
    return createPostgresRepositories().topUps.getFinancialSummary({ startAt, endBefore });
}

function dateBoundary(value: string, nextDay: boolean) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BillingInputError("财务汇总日期格式无效");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BillingInputError("财务汇总日期无效");
    if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
}
