import { describe, expect, it } from "vitest";

import { PointsWalletRepository } from "./points-wallet-repository";
import type { QueryExecutor } from "./postgres";

describe("PointsWalletRepository", () => {
    it("passes decimal strings through explicit numeric casts when creating a hold", async () => {
        const calls: Array<{ text: string; values?: unknown[] }> = [];
        const db = {
            async query(text: string, values?: unknown[]) {
                calls.push({ text, values });
                return {
                    rows: [
                        {
                            id: "hold-one",
                            user_id: "user-one",
                            business_id: "generation:one",
                            request_fingerprint: "a".repeat(64),
                            amount: "1.23456789",
                            status: "active",
                            description: "预留",
                            created_at: new Date("2026-08-23T00:00:00Z"),
                            updated_at: new Date("2026-08-23T00:00:00Z"),
                        },
                    ],
                    rowCount: 1,
                    command: "INSERT",
                    oid: 0,
                    fields: [],
                };
            },
        } as unknown as QueryExecutor;

        const hold = await new PointsWalletRepository(db).createHold({
            id: "hold-one",
            userId: "user-one",
            businessId: "generation:one",
            requestFingerprint: "a".repeat(64),
            amount: "1.23456789",
            status: "active",
            description: "预留",
            createdAt: "2026-08-23T00:00:00.000Z",
            updatedAt: "2026-08-23T00:00:00.000Z",
        });

        expect(hold.amount).toBe("1.23456789");
        expect(calls[0]?.text).toContain("$5::numeric");
        expect(calls[0]?.values?.[4]).toBe("1.23456789");
    });

    it("maps reconciliation aggregates without converting decimals to numbers", async () => {
        let statement = "";
        const db = {
            async query(text: string) {
                statement = text;
                return { rows: [{ ledger_balance: "8.76543211", settled_balance: "8.76543211", active_holds: "1.125", available_balance: "7.64043211", invalid_charge_count: "0" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
            },
        } as unknown as QueryExecutor;

        await expect(new PointsWalletRepository(db).getReconciliationAggregate("user-one")).resolves.toEqual({ ledgerBalance: "8.76543211", settledBalance: "8.76543211", activeHolds: "1.125", availableBalance: "7.64043211", invalidChargeCount: 0 });
        expect(statement).toContain("records.user_id = charges.user_id");
    });

    it("casts the native USD conversion rate and supports a locked pending-to-terminal transition", async () => {
        const calls: Array<{ text: string; values?: unknown[] }> = [];
        const row = {
            id: "attempt-one",
            hold_id: "hold-one",
            user_id: "user-one",
            attempt_number: 1,
            status: "failed",
            provider: "vendor",
            binding_id: "binding",
            request_fingerprint: "a".repeat(64),
            native_cost_amount: "1.25",
            native_cost_unit: { kind: "provider-native", provider: "vendor", unit: "job", usdConversion: { version: "v1", usdPerUnit: "0.125" } },
            usd_conversion_rate: "0.125",
            cost_usd: "0.15625",
            created_at: new Date(),
            updated_at: new Date(),
            completed_at: new Date(),
        };
        const db = {
            async query(text: string, values?: unknown[]) {
                calls.push({ text, values });
                return { rows: [row], rowCount: 1, command: "UPDATE", oid: 0, fields: [] };
            },
        } as unknown as QueryExecutor;
        const repository = new PointsWalletRepository(db);
        const attempt = {
            id: "attempt-one",
            holdId: "hold-one",
            userId: "user-one",
            attemptNumber: 1,
            status: "pending" as const,
            provider: "vendor",
            bindingId: "binding",
            requestFingerprint: "a".repeat(64),
            providerIdempotencySupported: false,
            nativeCostAmount: "1.25",
            nativeCostUnit: row.native_cost_unit as never,
            usdConversionRate: "0.125",
            costUsd: "0.15625",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await repository.createProviderAttempt(attempt);
        await repository.updatePendingProviderAttempt(attempt.id, { ...attempt, status: "failed", completedAt: new Date().toISOString() });

        expect(calls[0]?.text).toContain("$14::numeric");
        expect(calls[0]?.values?.[13]).toBe("0.125");
        expect(calls[1]?.text).toContain("status = 'pending'");
    });

    it("upserts non-empty backup records by primary identity without weakening business constraints", async () => {
        const statements: string[] = [];
        const now = new Date("2026-08-23T00:00:00.000Z");
        const db = {
            async query(text: string) {
                statements.push(text);
                if (text.includes("wallet_holds"))
                    return { rows: [{ id: "hold-one", user_id: "user-one", business_id: "generation:one", request_fingerprint: "a".repeat(64), amount: "1", status: "active", description: "预留", created_at: now, updated_at: now }], rowCount: 1 };
                if (text.includes("usage_charges"))
                    return {
                        rows: [
                            {
                                id: "charge-one",
                                user_id: "user-one",
                                hold_id: "hold-one",
                                request_fingerprint: "b".repeat(64),
                                reserved_credits: "1",
                                settled_credits: "0",
                                normalized_usage: { capability: "image", source: "actual", count: "1" },
                                sale_rate_snapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0" }] },
                                final_sale_charge: { credits: "0", usage: { capability: "image", source: "actual", count: "1" }, estimated: false, capped: false, uncappedCredits: "0", platformLossCredits: "0" },
                                estimated: false,
                                total_provider_cost_usd: "0",
                                description: "结算",
                                created_at: now,
                                settled_at: now,
                            },
                        ],
                        rowCount: 1,
                    };
                return {
                    rows: [
                        {
                            id: "attempt-one",
                            hold_id: "hold-one",
                            user_id: "user-one",
                            attempt_number: 1,
                            status: "failed",
                            provider: "vendor",
                            binding_id: "binding",
                            request_fingerprint: "c".repeat(64),
                            native_cost_amount: "0.1",
                            native_cost_unit: { kind: "fiat", currency: "USD" },
                            usd_conversion_rate: "1",
                            cost_usd: "0.1",
                            created_at: now,
                            updated_at: now,
                            completed_at: now,
                        },
                    ],
                    rowCount: 1,
                };
            },
        } as unknown as QueryExecutor;
        const repository = new PointsWalletRepository(db);

        await repository.upsertHoldForRestore({
            id: "hold-one",
            userId: "user-one",
            businessId: "generation:one",
            requestFingerprint: "a".repeat(64),
            amount: "1",
            status: "active",
            description: "预留",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
        await repository.upsertUsageChargeForRestore({
            id: "charge-one",
            userId: "user-one",
            holdId: "hold-one",
            requestFingerprint: "b".repeat(64),
            reservedCredits: "1",
            settledCredits: "0",
            normalizedUsage: { capability: "image", source: "actual", count: "1" },
            saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0" }] },
            finalSaleCharge: { credits: "0", usage: { capability: "image", source: "actual", count: "1" }, estimated: false, capped: false, uncappedCredits: "0", platformLossCredits: "0" },
            estimated: false,
            totalProviderCostUsd: "0",
            description: "结算",
            createdAt: now.toISOString(),
            settledAt: now.toISOString(),
        });
        await repository.upsertProviderAttemptForRestore({
            id: "attempt-one",
            holdId: "hold-one",
            userId: "user-one",
            attemptNumber: 1,
            status: "failed",
            provider: "vendor",
            bindingId: "binding",
            requestFingerprint: "c".repeat(64),
            providerIdempotencySupported: false,
            nativeCostAmount: "0.1",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            usdConversionRate: "1",
            costUsd: "0.1",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            completedAt: now.toISOString(),
        });

        expect(statements).toHaveLength(3);
        for (const statement of statements) expect(statement).toContain("ON CONFLICT (id) DO UPDATE");
        expect(statements[0]).toContain("business_id = EXCLUDED.business_id");
        expect(statements[2]).toContain("usd_conversion_rate = EXCLUDED.usd_conversion_rate");
    });

    it("uses bounded offsets for recovery holds and provider-attempt audit pages", async () => {
        const calls: Array<{ text: string; values?: unknown[] }> = [];
        const now = new Date("2026-08-23T00:00:00.000Z");
        const db = {
            async query(text: string, values?: unknown[]) {
                calls.push({ text, values });
                if (text.startsWith("SELECT count(*)") && text.includes("wallet_holds")) return { rows: [{ total: "21" }] };
                if (text.startsWith("SELECT * FROM wallet_holds"))
                    return {
                        rows: [
                            { id: "hold-last", user_id: "user-one", business_id: "generation:last", request_fingerprint: "d".repeat(64), amount: "2.25", status: "active", description: "复核", review_reason: "需要复核", created_at: now, updated_at: now },
                        ],
                    };
                if (text.startsWith("SELECT count(*)") && text.includes("provider_usage_attempts")) return { rows: [{ total: "11" }] };
                return {
                    rows: [
                        {
                            id: "attempt-last",
                            hold_id: "hold-last",
                            user_id: "user-one",
                            attempt_number: 11,
                            status: "failed",
                            provider: "vendor",
                            binding_id: "binding",
                            request_fingerprint: "e".repeat(64),
                            native_cost_amount: "0.125",
                            native_cost_unit: { kind: "provider-native", provider: "vendor", unit: "compute", usdConversion: { version: "fx-v2", usdPerUnit: "0.004" } },
                            usd_conversion_rate: "0.004",
                            cost_usd: "0.0005",
                            created_at: now,
                            updated_at: now,
                            completed_at: now,
                        },
                    ],
                };
            },
        } as unknown as QueryExecutor;
        const repository = new PointsWalletRepository(db);

        const recovery = await repository.listRecoveryHoldsPage({ now: now.toISOString(), page: 2, pageSize: 20 });
        const attempts = await repository.listProviderAttemptsPage({ holdId: "hold-last", page: 2, pageSize: 10 });

        expect(recovery).toMatchObject({ total: 21, page: 2, pageSize: 20, items: [{ id: "hold-last", amount: "2.25" }] });
        expect(attempts).toMatchObject({ total: 11, page: 2, pageSize: 10, items: [{ id: "attempt-last", status: "failed", nativeCostAmount: "0.125", costUsd: "0.0005" }] });
        expect(calls[1]?.values).toEqual([now.toISOString(), 20, 20]);
        expect(calls[3]?.values).toEqual(["hold-last", 10, 10]);
    });

    it("atomically rotates expired recovery candidates by their last evidence check", async () => {
        const calls: Array<{ text: string; values?: unknown[] }> = [];
        const now = new Date("2026-08-23T01:00:00.000Z");
        const db = {
            async query(text: string, values?: unknown[]) {
                calls.push({ text, values });
                return {
                    rows: [
                        {
                            id: "hold-one",
                            user_id: "user-one",
                            business_id: "generation:one",
                            request_fingerprint: "f".repeat(64),
                            amount: "1",
                            status: "active",
                            description: "恢复",
                            expires_at: new Date("2026-08-23T00:00:00.000Z"),
                            recovery_checked_at: now,
                            created_at: new Date("2026-08-22T00:00:00.000Z"),
                            updated_at: new Date("2026-08-22T00:00:00.000Z"),
                        },
                    ],
                };
            },
        } as unknown as QueryExecutor;

        const holds = await new PointsWalletRepository(db).listExpiredActiveHolds(now.toISOString(), 5);

        expect(calls[0]?.text).toContain("FOR UPDATE SKIP LOCKED");
        expect(calls[0]?.text).toContain("ORDER BY COALESCE(recovery_checked_at, expires_at) ASC");
        expect(calls[0]?.text).toContain("SET recovery_checked_at = $1::timestamptz");
        expect(calls[0]?.values).toEqual([now.toISOString(), 5]);
        expect(holds[0]).toMatchObject({ id: "hold-one", recoveryCheckedAt: now.toISOString() });
    });
});
