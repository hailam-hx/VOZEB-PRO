import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readAuthDb: vi.fn(), getPublicUsersByIds: vi.fn() }));

vi.mock("@/lib/auth/store-repository", () => ({ readAuthDb: mocks.readAuthDb }));
vi.mock("@/lib/auth/store", () => ({ getPublicUsersByIds: mocks.getPublicUsersByIds }));
vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: vi.fn(),
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(() => false),
}));

import { getAdminUsageAttempts, getAdminUsageAudit } from "./admin-usage-audit-service";

describe("admin usage audit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPublicUsersByIds.mockImplementation(async (ids: string[]) => ids.map((id, index) => ({ id, accountId: String(index + 1).padStart(4, "0"), username: `creator-${index + 1}`, displayName: `创作者 ${index + 1}` })));
        const charge = (id: string, settledCredits: string, totalProviderCostUsd: string) => ({
            id,
            userId: `user-${id}`,
            holdId: `hold-${id}`,
            requestFingerprint: id.padEnd(64, "a"),
            reservedCredits: settledCredits,
            settledCredits,
            normalizedUsage: { capability: "image", source: "provider", dimensions: {} },
            saleRateSnapshot: { version: "sale-v1", components: [] },
            finalSaleCharge: { totalCredits: settledCredits, components: [] },
            estimated: false,
            totalProviderCostUsd,
            description: id,
            createdAt: `2026-08-23T00:00:0${id}.000Z`,
            settledAt: `2026-08-23T00:00:0${id}.000Z`,
        });
        mocks.readAuthDb.mockResolvedValue({
            usageCharges: [charge("1", "0", "0.25"), charge("2", "1", "2"), charge("3", "3", "1")],
            walletHolds: [
                {
                    id: "orphan",
                    userId: "user-4",
                    businessId: "task-4",
                    requestFingerprint: "b".repeat(64),
                    amount: "2",
                    status: "active",
                    description: "待恢复",
                    reviewReason: "需要任务证据",
                    createdAt: "2026-08-23T00:00:00.000Z",
                    updatedAt: "2026-08-23T00:00:00.000Z",
                },
                {
                    id: "orphan-2",
                    userId: "user-5",
                    businessId: "task-5",
                    requestFingerprint: "c".repeat(64),
                    amount: "3",
                    status: "active",
                    description: "待恢复 2",
                    reviewReason: "需要复核",
                    createdAt: "2026-08-23T00:00:01.000Z",
                    updatedAt: "2026-08-23T00:00:01.000Z",
                },
                {
                    id: "orphan-3",
                    userId: "user-6",
                    businessId: "task-6",
                    requestFingerprint: "d".repeat(64),
                    amount: "4",
                    status: "active",
                    description: "待恢复 3",
                    reviewReason: "未知状态",
                    createdAt: "2026-08-23T00:00:02.000Z",
                    updatedAt: "2026-08-23T00:00:02.000Z",
                },
            ],
            providerUsageAttempts: [
                {
                    id: "attempt-1",
                    holdId: "hold-3",
                    userId: "user-3",
                    attemptNumber: 1,
                    status: "failed",
                    provider: "native-vendor",
                    bindingId: "binding-a",
                    requestFingerprint: "e".repeat(64),
                    providerIdempotencySupported: false,
                    nativeCostAmount: "1250.125",
                    nativeCostUnit: { kind: "provider-native", provider: "native-vendor", unit: "compute", usdConversion: { version: "native-fx-v7", usdPerUnit: "0.0004" } },
                    usdConversionRate: "0.0004",
                    costUsd: "0.50005",
                    createdAt: "2026-08-23T00:00:00.000Z",
                    updatedAt: "2026-08-23T00:00:01.000Z",
                    completedAt: "2026-08-23T00:00:01.000Z",
                },
                {
                    id: "attempt-2",
                    holdId: "hold-3",
                    userId: "user-3",
                    attemptNumber: 2,
                    status: "failed",
                    provider: "usd-vendor",
                    bindingId: "binding-b",
                    requestFingerprint: "f".repeat(64),
                    providerIdempotencySupported: false,
                    nativeCostAmount: "0.25",
                    nativeCostUnit: { kind: "fiat", currency: "USD" },
                    usdConversionRate: "1",
                    costUsd: "0.25",
                    createdAt: "2026-08-23T00:00:02.000Z",
                    updatedAt: "2026-08-23T00:00:03.000Z",
                    completedAt: "2026-08-23T00:00:03.000Z",
                },
                {
                    id: "attempt-3",
                    holdId: "hold-3",
                    userId: "user-3",
                    attemptNumber: 3,
                    status: "succeeded",
                    provider: "usd-vendor",
                    bindingId: "binding-c",
                    requestFingerprint: "0".repeat(64),
                    providerIdempotencySupported: false,
                    nativeCostAmount: "0.5",
                    nativeCostUnit: { kind: "fiat", currency: "USD" },
                    usdConversionRate: "1",
                    costUsd: "0.5",
                    createdAt: "2026-08-23T00:00:04.000Z",
                    updatedAt: "2026-08-23T00:00:05.000Z",
                    completedAt: "2026-08-23T00:00:05.000Z",
                },
            ],
        });
    });

    it("projects zero-usage cost, negative margin, healthy margin, and orphan recovery separately", async () => {
        const result = await getAdminUsageAudit({ page: 1, pageSize: 20, recoveryPage: 2, recoveryPageSize: 2 });

        expect(result).toMatchObject({ total: 3, zeroUsage: 1, negativeMargin: 1 });
        expect(result.items.map(({ id, marginUsd, anomaly }) => ({ id, marginUsd, anomaly }))).toEqual([
            { id: "3", marginUsd: "2", anomaly: "none" },
            { id: "2", marginUsd: "-1", anomaly: "negative_margin" },
            { id: "1", marginUsd: "-0.25", anomaly: "zero_usage_cost" },
        ]);
        expect(result.items[0]).toMatchObject({ user: { accountId: "0001", username: "creator-1" } });
        expect(result.recovery).toEqual([expect.objectContaining({ id: "orphan", reviewReason: "需要任务证据", user: expect.objectContaining({ accountId: "0004" }) })]);
        expect(result).toMatchObject({ recoveryTotal: 3, recoveryPage: 2, recoveryPageSize: 2 });
        expect(result.items[0]).not.toHaveProperty("userId");
        expect(result.recovery[0]).not.toHaveProperty("userId");
        expect(result.items[0]).not.toHaveProperty("providerIdempotencyKey");
    });

    it("paginates every provider attempt for a charge and includes failed native-cost snapshots", async () => {
        const result = await getAdminUsageAttempts("3", { page: 1, pageSize: 2 });

        expect(result).toMatchObject({ total: 3, page: 1, pageSize: 2 });
        expect(result.items).toEqual([
            expect.objectContaining({
                id: "attempt-1",
                status: "failed",
                provider: "native-vendor",
                nativeCostAmount: "1250.125",
                nativeCostUnit: expect.objectContaining({ kind: "provider-native", unit: "compute", usdConversion: { version: "native-fx-v7", usdPerUnit: "0.0004" } }),
                usdConversionRate: "0.0004",
                costUsd: "0.50005",
            }),
            expect.objectContaining({ id: "attempt-2", status: "failed", nativeCostUnit: expect.objectContaining({ kind: "fiat", currency: "USD" }), costUsd: "0.25" }),
        ]);
        expect(result.items[0]).not.toHaveProperty("providerIdempotencyKey");
    });
});
