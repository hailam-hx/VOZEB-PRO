import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readAuthDb: vi.fn() }));

vi.mock("@/lib/auth/store-repository", () => ({ readAuthDb: mocks.readAuthDb }));
vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: vi.fn(),
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(() => false),
}));

import { getAdminUsageAudit } from "./admin-usage-audit-service";

describe("admin usage audit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            ],
        });
    });

    it("projects zero-usage cost, negative margin, healthy margin, and orphan recovery separately", async () => {
        const result = await getAdminUsageAudit({ page: 1, pageSize: 20 });

        expect(result).toMatchObject({ total: 3, zeroUsage: 1, negativeMargin: 1 });
        expect(result.items.map(({ id, marginUsd, anomaly }) => ({ id, marginUsd, anomaly }))).toEqual([
            { id: "3", marginUsd: "2", anomaly: "none" },
            { id: "2", marginUsd: "-1", anomaly: "negative_margin" },
            { id: "1", marginUsd: "-0.25", anomaly: "zero_usage_cost" },
        ]);
        expect(result.recovery).toEqual([expect.objectContaining({ id: "orphan", reviewReason: "需要任务证据" })]);
        expect(result.items[0]).not.toHaveProperty("providerIdempotencyKey");
    });
});
