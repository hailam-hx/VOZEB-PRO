import { describe, expect, it } from "vitest";

import { POSTGRESQL_SCHEMA_SQL } from "./schema";

describe("Agent runtime V2 schema", () => {
    it("defines first-class immutable plans, durable tasks, dependencies, tool calls, and context snapshots", () => {
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_runs");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_plans");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("UNIQUE (run_id, version)");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_tasks");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("UNIQUE (plan_id, task_key)");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("ordinal integer NOT NULL");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_task_dependencies");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_tool_calls");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("idempotency_key text NOT NULL UNIQUE");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("generation_task_id text REFERENCES generation_tasks(id)");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_context_snapshots");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("agent_tasks_claim_due_idx");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("20260916_agent_runtime_v2");
    });
});
