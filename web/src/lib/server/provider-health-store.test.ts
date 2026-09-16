import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderHealthService, type ProviderRouteIdentity } from "./provider-health";
import { FileProviderHealthStore } from "./provider-health-store";

const route: ProviderRouteIdentity = { provider: "openai-compatible", channelId: "channel-a", model: "model-a" };
let directory = "";

describe("provider health shared store", () => {
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "provider-health-"));
        vi.stubEnv("VOZEB_PRO_DATA_DIR", directory);
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
    });

    it("survives service recreation and expires stale state", async () => {
        const first = new ProviderHealthService(new FileProviderHealthStore());
        await first.failure(route, { status: 503 }, 1_000);
        await first.failure(route, { status: 503 }, 2_000);
        await first.failure(route, { status: 503 }, 3_000);

        const restarted = new ProviderHealthService(new FileProviderHealthStore());
        expect(await restarted.get(route, 4_000)).toMatchObject({ state: "open", consecutiveFailures: 3 });
        expect(await restarted.get(route, 3_000 + 31 * 60_000)).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });

    it("uses the file lock as compare-and-set for a single concurrent probe", async () => {
        const service = new ProviderHealthService(new FileProviderHealthStore());
        await service.failure(route, { status: 503 }, 1_000);
        await service.failure(route, { status: 503 }, 2_000);
        await service.failure(route, { status: 503 }, 3_000);

        const decisions = await Promise.all(Array.from({ length: 8 }, () => new ProviderHealthService(new FileProviderHealthStore()).acquire(route, 63_001)));
        expect(decisions.filter((decision) => decision.probe)).toHaveLength(1);
    });
});
