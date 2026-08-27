import { describe, expect, it } from "vitest";

import { PointsRepository } from "./user-repository";
import type { QueryExecutor } from "./postgres";

describe("admin points repository", () => {
    it("uses bounded filters and preserves decimal strings in the global ledger", async () => {
        const calls: Array<{ text: string; values?: unknown[] }> = [];
        const db = {
            async query(text: string, values?: unknown[]) {
                calls.push({ text, values });
                return {
                    rows: [
                        {
                            id: "record-one",
                            user_id: "user-one",
                            operator_user_id: "admin-one",
                            type: "admin-adjust",
                            amount: "-1.25000001",
                            balance_after: "8.74999999",
                            description: "冲正",
                            created_at: new Date("2026-08-25T00:00:00.000Z"),
                            total_count: "1",
                        },
                    ],
                    rowCount: 1,
                    command: "SELECT",
                    oid: 0,
                    fields: [],
                };
            },
        } as unknown as QueryExecutor;

        const result = await new PointsRepository(db).listAdminRecords({
            page: 1,
            pageSize: 20,
            userId: "user-one",
            type: "admin-adjust",
            direction: "debit",
            startAt: "2026-08-24T00:00:00.000Z",
            endBefore: "2026-08-26T00:00:00.000Z",
        });

        expect(result).toMatchObject({ total: 1, items: [{ amount: "-1.25000001", balanceAfter: "8.74999999", operatorUserId: "admin-one" }] });
        expect(calls[0]?.text).toContain("user_id = $1");
        expect(calls[0]?.text).toContain("created_at >= $4::timestamptz");
        expect(calls[0]?.text).toContain("created_at < $5::timestamptz");
        expect(calls[0]?.values).toEqual(["user-one", "admin-adjust", "debit", "2026-08-24T00:00:00.000Z", "2026-08-26T00:00:00.000Z", 20, 0]);
    });

    it("returns exact global wallet aggregates", async () => {
        const db = {
            async query() {
                return { rows: [{ settled_balance: "12.50000001", held_balance: "2.25", available_balance: "10.25000001", record_count: "7" }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
            },
        } as unknown as QueryExecutor;

        await expect(new PointsRepository(db).getAdminSummary()).resolves.toEqual({ settledBalance: "12.50000001", heldBalance: "2.25", availableBalance: "10.25000001", recordCount: 7 });
    });
});
