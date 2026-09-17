import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLogicalModelCandidates, resolveRuntimeLogicalModelCandidates } from "./logical-model-router";
import { ProviderHealthService, type ProviderRouteIdentity } from "./provider-health";
import { FileProviderHealthStore } from "./provider-health-store";
import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { acquirePlannerProviderRoute, rankPlannerProviderCandidates, resolvedProviderRouteIdentity } from "./provider-health-runtime";

let directory = "";
const channel = (id: string, models: string[]) => ({
    id,
    name: id,
    baseUrl: `https://${id}.example.com`,
    apiKey: "secret",
    apiFormat: "openai" as const,
    models,
    enabled: true,
    advancedConfig: { ...emptyAdvancedConfig(), protocol: "compatible" as const },
});
const settings = {
    systemChannels: [channel("channel-a", ["model-a", "model-b"]), channel("channel-b", ["model-c"])],
    logicalModels: [
        {
            id: "writer",
            name: "Writer",
            capability: "text" as const,
            enabled: true,
            bindings: [
                { id: "a", channelId: "channel-a", upstreamModel: "model-a", enabled: true, priority: 1 },
                { id: "b", channelId: "channel-a", upstreamModel: "model-b", enabled: true, priority: 2 },
                { id: "c", channelId: "channel-b", upstreamModel: "model-c", enabled: true, priority: 3 },
            ],
        },
    ],
};

describe("provider health logical routing integration", () => {
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "provider-routing-"));
        vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", "file");
        vi.stubEnv("VOZEB_PRO_DATA_DIR", directory);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
    });

    it("skips two repeatedly failing bindings, routes directly to the healthy fallback, then restores priority after a successful probe", async () => {
        const service = new ProviderHealthService(new FileProviderHealthStore());
        const baseCandidates = resolveLogicalModelCandidates(settings, "text", "writer");
        const first = resolvedProviderRouteIdentity(baseCandidates[0]);
        const second = resolvedProviderRouteIdentity(baseCandidates[1]);
        for (const route of [first, second]) {
            await service.failure(route, { providerError: { kind: "provider_error", code: "overloaded", status: 503 } }, 1_000);
            await service.failure(route, { providerError: { kind: "provider_error", code: "internal_error", status: 500 } }, 2_000);
            await service.failure(route, { status: 503 }, 3_000);
        }

        const now = vi.spyOn(Date, "now").mockReturnValue(4_000);
        const nextRequest = await resolveRuntimeLogicalModelCandidates(settings, "text", "writer");
        expect(nextRequest.map((candidate) => candidate.upstreamModel)).toEqual(["model-c", "model-a", "model-b"]);

        const probe = await service.acquire(first, 243_001);
        expect(probe).toMatchObject({ eligible: true, probe: true, state: "half_open" });
        await service.success(first, 243_100);

        now.mockReturnValue(243_100);
        const recovered = await resolveRuntimeLogicalModelCandidates(settings, "text", "writer");
        expect(recovered[0]).toMatchObject({ channelId: "channel-a", upstreamModel: "model-a" });
    });

    it("uses persistent planner scope without changing text-task ordering", async () => {
        const service = new ProviderHealthService(new FileProviderHealthStore());
        const candidates = resolveLogicalModelCandidates(settings, "text", "writer");
        const plannerFirst = resolvedProviderRouteIdentity(candidates[0], "planner");
        await service.failure(plannerFirst, { status: 503 }, 1_000);
        await service.failure(plannerFirst, { status: 503 }, 2_000);
        await service.failure(plannerFirst, { status: 503 }, 3_000);

        const plannerRanked = await rankPlannerProviderCandidates(candidates, 4_000);
        expect(plannerRanked.map((candidate) => candidate.upstreamModel)).toEqual(["model-c", "model-b", "model-a"]);
        expect(await service.get(resolvedProviderRouteIdentity(candidates[0]), 4_000)).toMatchObject({ state: "closed", workloadScope: "text_task" });
    });

    it("emits a scoped skip event before dispatch for an open planner binding", async () => {
        const service = new ProviderHealthService(new FileProviderHealthStore());
        const candidate = resolveLogicalModelCandidates(settings, "text", "writer")[0];
        const route = resolvedProviderRouteIdentity(candidate, "planner");
        await service.failure(route, { status: 503 }, 1_000);
        await service.failure(route, { status: 503 }, 2_000);
        await service.failure(route, { status: 503 }, 3_000);
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

        await expect(acquirePlannerProviderRoute(candidate, 4_000)).resolves.toMatchObject({ eligible: false, state: "open", reason: "circuit_open" });
        expect(info).toHaveBeenCalledWith("provider_route_skipped", expect.objectContaining({ workloadScope: "planner", channelId: "channel-a", model: "model-a", reason: "circuit_open" }));
        info.mockRestore();
    });
});
