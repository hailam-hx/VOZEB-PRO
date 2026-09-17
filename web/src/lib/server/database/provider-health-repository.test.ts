import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/server/database", () => ({ ensurePostgresSchema: mocks.ensure, withPostgresTransaction: mocks.transaction }));

import { PostgresProviderHealthStore } from "../provider-health-store";

describe("PostgreSQL provider health repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensure.mockResolvedValue(undefined);
    });

    it("locks a health row and upserts the compare-and-set result", async () => {
        const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
        mocks.transaction.mockImplementation((handler) => handler({ query }));

        await new PostgresProviderHealthStore().update(
            "binding:text_task:provider:channel:model",
            () => ({
                bindingKey: "binding:text_task:provider:channel:model",
                workloadScope: "text_task",
                scope: "binding",
                provider: "provider",
                channelId: "channel",
                model: "model",
                state: "closed",
                consecutiveFailures: 0,
                consecutiveSuccesses: 0,
                windowFailures: 0,
                windowSuccesses: 0,
                windowStartedAt: 1,
                openCount: 0,
                halfOpenProbeInFlight: false,
                independentModels: [],
                updatedAt: 1,
                expiresAt: 2,
            }),
            1,
        );

        expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
        expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO provider_health"))).toBe(true);
        expect(query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO provider_health"))?.[1]).toContain("text_task");
        expect(query.mock.calls.some(([sql]) => String(sql).includes("ON CONFLICT (binding_key) DO UPDATE"))).toBe(true);
    });
});
