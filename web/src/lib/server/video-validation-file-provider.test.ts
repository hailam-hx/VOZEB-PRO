import { describe, expect, it, vi } from "vitest";

vi.mock("./database", () => ({
    getDatabaseProvider: () => "file",
    createPostgresRepositories: () => {
        throw new Error("PostgreSQL repository must not be opened");
    },
}));

import { listVideoValidationRuns } from "./video-validation-service";

describe("video validation with file provider", () => {
    it("lists no runs and reports that atomic validation requires PostgreSQL", async () => {
        await expect(listVideoValidationRuns({ page: 1, pageSize: 10 })).resolves.toEqual({ items: [], total: 0, unavailableReason: "POSTGRES_REQUIRED" });
    });
});
