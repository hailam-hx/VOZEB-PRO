import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { createPostgresRepositories, ensurePostgresSchema, initializePostgresSchema, postgresQuery } from "@/lib/server/database";
import type { TopUpOrder } from "./top-up-payment";
import { closeManualTopUpOrder, receiveManualTopUpOrder } from "./top-up-admin-order-service";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("PostgreSQL admin manual top-up actions", () => {
    beforeAll(async () => {
        if (process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1") await initializePostgresSchema();
    });

    postgresIt("serializes concurrent receipt confirmation into one payment and one credit record", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `manual-receive-user-${suffix}`;
        const order = topUpOrder(`manual-receive-order-${suffix}`, `VZMANUAL${suffix.replaceAll("-", "").slice(0, 12)}`, userId);
        try {
            await createUser(userId, suffix);
            await repositories.topUps.createOrder(order);

            const results = await Promise.all([receiveManualTopUpOrder(order.id, "admin-one"), receiveManualTopUpOrder(order.id, "admin-one")]);

            expect(results.filter((result) => result.applied)).toHaveLength(1);
            expect(results.filter((result) => result.duplicate)).toHaveLength(1);
            expect(await repositories.users.getById(userId)).toMatchObject({ settledBalance: "10" });
            expect(await repositories.points.getRecordByIdempotencyKey(`top-up:${order.id}:grant`)).toMatchObject({ userId, type: "credit", amount: "10", balanceAfter: "10", sourceRecordId: order.id });
            expect(await repositories.topUps.listPaymentsByOrderId(order.id)).toHaveLength(1);
            expect(await repositories.topUps.getOrderById(order.id)).toMatchObject({ status: "paid", paymentState: "paid", creditGrantState: "granted" });
        } finally {
            await cleanupOrder(order.id, userId);
        }
    });

    postgresIt("closes a pending manual order idempotently without payment or credit", async () => {
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const suffix = randomUUID();
        const userId = `manual-close-user-${suffix}`;
        const order = topUpOrder(`manual-close-order-${suffix}`, `VZCLOSE${suffix.replaceAll("-", "").slice(0, 12)}`, userId);
        try {
            await createUser(userId, suffix);
            await repositories.topUps.createOrder(order);

            const first = await closeManualTopUpOrder(order.id);
            const replay = await closeManualTopUpOrder(order.id);

            expect(first).toMatchObject({ applied: true, duplicate: false });
            expect(replay).toMatchObject({ applied: false, duplicate: true });
            expect(await repositories.users.getById(userId)).toMatchObject({ settledBalance: "0" });
            expect(await repositories.points.getRecordByIdempotencyKey(`top-up:${order.id}:grant`)).toBeNull();
            expect(await repositories.topUps.listPaymentsByOrderId(order.id)).toEqual([]);
            expect(await repositories.topUps.getOrderById(order.id)).toMatchObject({ status: "canceled", paymentState: "pending", creditGrantState: "pending" });
        } finally {
            await cleanupOrder(order.id, userId);
        }
    });
});

async function cleanupOrder(orderId: string, userId: string) {
    await postgresQuery("DELETE FROM top_up_payment_events WHERE order_id = $1", [orderId]);
    await postgresQuery("DELETE FROM top_up_payments WHERE order_id = $1", [orderId]);
    await postgresQuery("UPDATE top_up_orders SET grant_point_record_id = NULL WHERE id = $1", [orderId]);
    await postgresQuery("DELETE FROM top_up_orders WHERE id = $1", [orderId]);
    await postgresQuery("DELETE FROM point_records WHERE source_record_id = $1", [orderId]);
    await createPostgresRepositories().users.delete(userId);
}

async function createUser(userId: string, suffix: string) {
    const now = new Date().toISOString();
    await createPostgresRepositories().users.createWithNextAccountId({
        id: userId,
        username: `manual_${suffix.replaceAll("-", "").slice(0, 16)}`,
        displayName: "人工收款测试用户",
        bio: "",
        role: "user",
        adminPermissions: [],
        status: "active",
        settledBalance: "0",
        passwordHash: "integration-test-only",
        createdAt: now,
        updatedAt: now,
    });
}

function topUpOrder(id: string, orderNo: string, userId: string): TopUpOrder {
    const now = new Date();
    return {
        id,
        orderNo,
        userId,
        status: "pending",
        paymentState: "pending",
        creditGrantState: "pending",
        providerRefundState: "none",
        creditRecoveryState: "none",
        subject: "人工确认充值",
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: "250000",
        promotionDiscountNativeAmount: "0",
        couponDiscountNativeAmount: "0",
        payableNativeAmount: "250000",
        nominalUsdValue: "10",
        paidUsdValue: "10",
        creditAmount: "10",
        pricingVersion: "payg-test-v1",
        customerFxVersion: "fx-test-v1",
        customerFxRate: "0.00004",
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 },
        provider: "manual",
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}
