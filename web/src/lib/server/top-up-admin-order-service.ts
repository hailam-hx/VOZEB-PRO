import { BillingInputError } from "@/lib/server/billing-errors";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, withPostgresTransaction } from "@/lib/server/database";
import { processTopUpPaymentEvent, type TopUpOrder } from "./top-up-payment";
import { PostgresTopUpPaymentStore } from "./top-up-postgres-settlement";

export async function receiveManualTopUpOrder(orderId: string, operatorUserId: string) {
    await assertTopUpDatabase();
    const id = requiredId(orderId);
    const operatorId = requiredId(operatorUserId);
    const order = await createPostgresRepositories().topUps.getOrderById(id);
    if (!order) throw new BillingInputError("充值订单不存在", 404);
    assertManualOrder(order);
    const settled = order.status === "paid" && order.paymentState === "paid" && order.creditGrantState === "granted";
    if (!settled && (order.status !== "pending" || order.paymentState !== "pending" || order.creditGrantState !== "pending")) throw new BillingInputError("充值订单状态不可确认收款", 409);

    const identity = `admin-receive:${order.id}`;
    return processTopUpPaymentEvent(
        {
            signatureValid: true,
            provider: "manual",
            eventId: identity,
            eventType: "admin.payment.received",
            orderId: order.id,
            orderNo: order.orderNo,
            status: "paid",
            amount: order.paymentAmount,
            providerPaymentId: identity,
            rawPayload: { source: "admin", operatorUserId: operatorId },
        },
        new PostgresTopUpPaymentStore(),
    );
}

export async function closeManualTopUpOrder(orderId: string) {
    await assertTopUpDatabase();
    const id = requiredId(orderId);
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const order = await repos.topUps.getOrderById(id, true);
        if (!order) throw new BillingInputError("充值订单不存在", 404);
        assertManualOrder(order);
        if (order.status === "canceled" && order.paymentState === "pending" && order.creditGrantState === "pending") return closeResult(order, false, true);
        if (order.status !== "pending" || order.paymentState !== "pending" || order.creditGrantState !== "pending") throw new BillingInputError("充值订单状态不可关闭", 409);

        const closed = await repos.topUps.cancelPendingOrder(order.id, order.userId);
        if (!closed) throw new BillingInputError("充值订单状态不可关闭", 409);
        if (order.userCouponId && !(await repos.topUps.releaseCouponForOrder(order.userCouponId, order.id))) throw new BillingInputError("充值订单优惠券绑定状态不可释放", 409);
        return closeResult(closed, true, false);
    });
}

function assertManualOrder(order: TopUpOrder) {
    if (order.provider !== "manual") throw new BillingInputError("仅支持人工确认渠道的充值订单", 409);
}

function closeResult(order: TopUpOrder, applied: boolean, duplicate: boolean) {
    return { orderId: order.id, orderNo: order.orderNo, applied, duplicate };
}

async function assertTopUpDatabase() {
    if (!isPostgresDatabaseEnabled()) throw new BillingInputError("充值交易需要启用 PostgreSQL", 501);
    await ensurePostgresSchema();
}

function requiredId(value: string) {
    const normalized = value
        .trim()
        .slice(0, 120)
        .replace(/[^a-zA-Z0-9_.:-]/g, "");
    if (!normalized) throw new BillingInputError("充值订单编号不能为空");
    return normalized;
}
