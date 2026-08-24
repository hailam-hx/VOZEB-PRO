import { BillingInputError } from "@/lib/server/billing-errors";

const QUOTE_FIELDS = new Set(["presetId", "customAmountVnd", "promotionId", "userCouponId"]);
const ORDER_FIELDS = new Set([...QUOTE_FIELDS, "provider"]);

export function assertTopUpRequestContract(body: Record<string, unknown>, kind: "quote" | "order") {
    const allowed = kind === "order" ? ORDER_FIELDS : QUOTE_FIELDS;
    const unexpected = Object.keys(body).find((field) => !allowed.has(field));
    if (unexpected) throw new BillingInputError(`充值请求包含不可接受字段：${unexpected}`);
    return body;
}
