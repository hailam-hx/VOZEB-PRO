import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ProviderHealthService, bindingKey, channelKey, type ProviderRouteIdentity } from "../provider-health";
import { PostgresProviderHealthStore } from "../provider-health-store";
import { ensurePostgresSchema, postgresQuery } from "./index";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("PostgreSQL scoped provider health", () => {
    postgresIt("persists workload scope and atomically leases one half-open probe across service instances", async () => {
        await ensurePostgresSchema();
        const route: ProviderRouteIdentity = { workloadScope: "planner", provider: "integration", channelId: `channel-${randomUUID()}`, model: "model-a" };
        const service = () => new ProviderHealthService(new PostgresProviderHealthStore());
        try {
            await service().failure(route, { status: 503 }, 1_000);
            await service().failure(route, { status: 503 }, 2_000);
            await service().failure(route, { status: 503 }, 3_000);

            const decisions = await Promise.all(Array.from({ length: 8 }, () => service().acquire(route, 63_001)));
            expect(decisions.filter((decision) => decision.probe)).toHaveLength(1);
            expect(await service().get(route, 63_001)).toMatchObject({ workloadScope: "planner", state: "half_open", halfOpenProbeInFlight: true });
            const rows = await postgresQuery<{ workload_scope: string; scope: string; model: string }>("SELECT workload_scope, scope, model FROM provider_health WHERE binding_key = $1", [bindingKey(route)]);
            expect(rows.rows).toEqual([{ workload_scope: "planner", scope: "binding", model: "model-a" }]);
        } finally {
            await postgresQuery("DELETE FROM provider_health WHERE binding_key = ANY($1::text[])", [[bindingKey(route), channelKey(route)]]);
        }
    });

    postgresIt("reopens a channel after a failed half-open probe when its observation window expired", async () => {
        await ensurePostgresSchema();
        const channelId = `channel-${randomUUID()}`;
        const routeA: ProviderRouteIdentity = { workloadScope: "planner", provider: "integration", channelId, model: "model-a" };
        const routeB: ProviderRouteIdentity = { ...routeA, model: "model-b" };
        const service = () => new ProviderHealthService(new PostgresProviderHealthStore());
        try {
            await service().failure(routeA, { status: 503 }, 1_000);
            await service().failure(routeA, { status: 503 }, 2_000);
            await service().failure(routeA, { status: 503 }, 3_000);
            await service().failure(routeB, { status: 503 }, 4_000);
            expect(await service().getChannel(routeA, 4_000)).toMatchObject({ state: "open", openCount: 1 });

            const decisions = await Promise.all(Array.from({ length: 8 }, () => service().acquire(routeB, 306_001)));
            expect(decisions.filter((decision) => decision.eligible)).toHaveLength(1);
            expect(await service().getChannel(routeA, 306_001)).toMatchObject({ state: "half_open", halfOpenProbeInFlight: true });

            await service().failure(routeB, { status: 503 }, 306_100);

            expect(await service().getChannel(routeA, 306_100)).toMatchObject({ state: "open", openCount: 2, cooldownUntil: 426_100, halfOpenProbeInFlight: false });
            const rows = await postgresQuery<{ state: string; payload: { state: string; openCount: number; cooldownUntil?: number } }>("SELECT state, payload FROM provider_health WHERE binding_key = $1", [channelKey(routeA)]);
            expect(rows.rows).toEqual([{ state: "open", payload: expect.objectContaining({ state: "open", openCount: 2, cooldownUntil: 426_100 }) }]);
        } finally {
            await postgresQuery("DELETE FROM provider_health WHERE binding_key = ANY($1::text[])", [[bindingKey(routeA), bindingKey(routeB), channelKey(routeA)]]);
        }
    });
});
