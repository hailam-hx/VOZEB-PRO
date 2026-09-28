import { describe, expect, it, vi } from "vitest";

import { POSTGRESQL_SCHEMA_SQL } from "./schema";
import { VideoValidationRepository } from "./video-validation-repository";

describe("video validation repository", () => {
    it("defines validation runs, items, constraints and due-work indexes", () => {
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS video_validation_runs");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS video_validation_items");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("max_budget_hotx_credits numeric(30, 8)");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("video_validation_items_identity_unique");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("video_validation_items_claim_due_idx");
    });

    it("reserves from stored item cost under a locked run and item", async () => {
        const query = vi.fn(async (sql: string) =>
            sql.includes("FROM video_validation_runs")
                ? { rows: [{ id: "run", status: "pending", max_budget_hotx_credits: "0.7", active_reserved_credits: "0", total_settled_credits: "0" }], rowCount: 1 }
                : sql.includes("FROM video_validation_items")
                  ? { rows: [{ id: "item", status: "queued", reservation_state: "NONE", execution_snapshot_hash: "snapshot", fingerprint_hash: "fingerprint", request_payload_digest: "payload", estimated_credits: "0.2268" }], rowCount: 1 }
                  : { rows: [], rowCount: 1 },
        );
        const repository = new VideoValidationRepository({ query } as never, async (callback) => callback({ query } as never));
        await expect(repository.reserveItemBudget({ runId: "run", itemId: "item", executionSnapshotHash: "snapshot", now: "2026-09-26T00:00:00.000Z" })).resolves.toBe("RESERVED");
        expect(query.mock.calls[0]?.[0]).toContain("FOR UPDATE");
        expect(query.mock.calls[1]?.[0]).toContain("FOR UPDATE");
        expect(query.mock.calls.some(([sql]) => sql.includes("$2::numeric"))).toBe(true);
    });

    it("returns false when another worker consumed the remaining budget", async () => {
        const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
        const repository = new VideoValidationRepository({ query } as never, async (callback) => callback({ query } as never));
        await expect(repository.reserveItemBudget({ runId: "run", itemId: "item", executionSnapshotHash: "snapshot", now: "2026-09-26T00:00:00.000Z" })).resolves.toBe("NOT_ELIGIBLE");
    });

    it("claims only free per-run concurrency slots under a locked run row", async () => {
        const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 0 }));
        const repository = new VideoValidationRepository({ query } as never);
        await repository.claimNextItems({ workerId: "worker", now: "2026-09-26T00:00:00.000Z", leaseUntil: "2026-09-26T00:04:00.000Z", limit: 8 });
        const [sql] = query.mock.calls[0];
        expect(sql).toContain("FOR UPDATE OF run");
        expect(sql).toContain("row_number() OVER (PARTITION BY item.run_id");
        expect(sql).toContain("ranked.slot <= locked_runs.concurrency - coalesce(active.count, 0)");
    });
});
