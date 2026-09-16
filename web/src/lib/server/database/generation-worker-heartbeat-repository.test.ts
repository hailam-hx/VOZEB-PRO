import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    pool: vi.fn(),
}));

vi.mock("pg", () => ({
    Pool: mocks.pool,
}));

import { latestGenerationWorkerHeartbeats, upsertGenerationWorkerHeartbeat } from "./generation-worker-heartbeat-repository";

describe("generation Worker heartbeat PostgreSQL repository", () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__vozebProPostgresPool;
        delete (globalThis as Record<string, unknown>).__vozebProPostgresSchemaReady;
        process.env.DATABASE_URL = "postgres://vozeb:test@localhost:5432/vozeb";
        mocks.query.mockReset().mockImplementation(async (sql: string) => {
            if (sql.includes("to_regclass")) return { rows: [{ table_name: "vozeb_pro_users" }] };
            if (sql.includes("SELECT worker_id")) return { rows: [{ worker_id: "worker-1", last_seen_at: "2026-07-29T12:00:00.000Z", build_version: "v0.0.6", git_sha: "sha", schema_version: "schema", runtime_protocol_version: "1" }] };
            return { rows: [] };
        });
        mocks.pool.mockReset().mockImplementation(function PoolMock() {
            return {
                query: mocks.query,
                connect: vi.fn(async () => ({ query: mocks.query, release: vi.fn() })),
            };
        });
    });

    it("writes, prunes, and reads heartbeats through prefixed parameterized SQL", async () => {
        const at = new Date("2026-07-29T12:00:00.000Z");

        await upsertGenerationWorkerHeartbeat("worker-1", at, { buildVersion: "v0.0.6", gitSha: "sha", schemaVersion: "schema", runtimeProtocolVersion: "1" });
        await expect(latestGenerationWorkerHeartbeats()).resolves.toEqual([expect.objectContaining({ workerId: "worker-1", lastSeenAt: at.getTime(), buildVersion: "v0.0.6" })]);

        const statements = mocks.query.mock.calls.map(([sql]) => String(sql));
        const insertCall = mocks.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO vozeb_pro_generation_worker_heartbeats"));
        const deleteCall = mocks.query.mock.calls.find(([sql]) => String(sql).includes("DELETE FROM vozeb_pro_generation_worker_heartbeats"));
        const selectCall = mocks.query.mock.calls.find(([sql]) => String(sql).includes("SELECT worker_id"));

        expect(statements.filter((sql) => sql.includes("SELECT to_regclass('public.vozeb_pro_users')"))).toHaveLength(1);
        expect(statements.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS vozeb_pro_schema_migrations"))).toHaveLength(1);
        expect(insertCall?.[1]).toEqual(["worker-1", at, "v0.0.6", "sha", "schema", "1"]);
        expect(deleteCall?.[1]).toEqual([new Date(at.getTime() - 10 * 60_000)]);
        expect(selectCall?.[1]).toBeUndefined();
    });
});
