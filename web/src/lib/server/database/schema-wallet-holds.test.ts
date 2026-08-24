import { describe, expect, it } from "vitest";

import { POSTGRESQL_SCHEMA_SQL } from "./schema";

describe("wallet hold recovery schema", () => {
    it("persists and indexes the evidence-check cursor separately from hold expiry", () => {
        expect(POSTGRESQL_SCHEMA_SQL).toContain("recovery_checked_at timestamptz");
        expect(POSTGRESQL_SCHEMA_SQL).toContain("COALESCE(recovery_checked_at, expires_at)");
    });
});
