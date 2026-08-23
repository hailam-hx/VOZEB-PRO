import { describe, expect, it } from "vitest";

import { PointsWalletRepository } from "./points-wallet-repository";
import type { QueryExecutor } from "./postgres";

describe("PointsWalletRepository", () => {
    it("passes decimal strings through explicit numeric casts when creating a hold", async () => {
        const calls: Array<{ text: string; values?: unknown[] }> = [];
        const db = {
            async query(text: string, values?: unknown[]) {
                calls.push({ text, values });
                return { rows: [{ id: "hold-one", user_id: "user-one", business_id: "generation:one", request_fingerprint: "a".repeat(64), amount: "1.23456789", status: "active", description: "预留", created_at: new Date("2026-08-23T00:00:00Z"), updated_at: new Date("2026-08-23T00:00:00Z") }], rowCount: 1, command: "INSERT", oid: 0, fields: [] };
            },
        } as unknown as QueryExecutor;

        const hold = await new PointsWalletRepository(db).createHold({ id: "hold-one", userId: "user-one", businessId: "generation:one", requestFingerprint: "a".repeat(64), amount: "1.23456789", status: "active", description: "预留", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" });

        expect(hold.amount).toBe("1.23456789");
        expect(calls[0]?.text).toContain("$5::numeric");
        expect(calls[0]?.values?.[4]).toBe("1.23456789");
    });

    it("maps reconciliation aggregates without converting decimals to numbers", async () => {
        const db = {
            async query() {
                return { rows: [{ ledger_balance: "8.76543211", settled_balance: "8.76543211", active_holds: "1.125", available_balance: "7.64043211", invalid_charge_count: "0" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
            },
        } as unknown as QueryExecutor;

        await expect(new PointsWalletRepository(db).getReconciliationAggregate("user-one")).resolves.toEqual({ ledgerBalance: "8.76543211", settledBalance: "8.76543211", activeHolds: "1.125", availableBalance: "7.64043211", invalidChargeCount: 0 });
    });
});
