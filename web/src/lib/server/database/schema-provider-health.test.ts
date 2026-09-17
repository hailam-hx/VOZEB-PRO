import { describe, expect, it } from "vitest";

import { POSTGRESQL_SCHEMA_SQL } from "./schema";

describe("provider health workload scope schema", () => {
    it("migrates existing records transactionally through schema initialization without losing payload state", () => {
        expect(POSTGRESQL_SCHEMA_SQL).toContain("workload_scope text NOT NULL DEFAULT 'text_task'");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("provider_health workload-scope migration key collision");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("jsonb_set(payload, '{workloadScope}'");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("WHERE workload_scope IS NULL");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("provider_health_route_idx ON provider_health (workload_scope, scope, provider, channel_id, model)");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("20260917_provider_health_workload_scope");
    });
});
