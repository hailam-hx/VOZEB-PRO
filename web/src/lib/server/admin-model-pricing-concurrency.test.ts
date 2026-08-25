import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ value: undefined as unknown, beforeWrite: undefined as undefined | (() => Promise<void>) }));

vi.mock("@/lib/server/database", () => ({ isPostgresDatabaseEnabled: vi.fn(() => false) }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (_fileName: string, fallback: unknown) => memory.value ?? fallback),
    writeJsonDataFile: vi.fn(async (_fileName: string, value: unknown) => {
        await memory.beforeWrite?.();
        memory.value = structuredClone(value);
    }),
}));

import { getFreshAuthSettings, setAuthSettings } from "@/lib/auth/store";
import { saveAdminModelPricing } from "./admin-model-pricing-service";

describe("atomic file-provider model pricing", () => {
    beforeEach(() => {
        memory.value = undefined;
        memory.beforeWrite = undefined;
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "0123456789abcdef".repeat(4));
    });

    afterEach(() => vi.unstubAllEnvs());

    it("does not accept pricing snapshots from an upstream full-model replacement", async () => {
        await setAuthSettings({ systemChannels: [channelFixture()], logicalModels: [modelFixture()] });

        const saved = (await getFreshAuthSettings()).logicalModels[0];
        expect(saved.saleRateCard).toBeUndefined();
        expect(saved.bindings[0].costRateCard).toBeUndefined();
        expect(saved.bindings[0].providerCostUnit).toBeUndefined();
    });

    it("strips pricing snapshots from a new binding added to an existing model upstream", async () => {
        await setAuthSettings({ systemChannels: [channelFixture()], logicalModels: [modelFixture()] });
        const upstreamWorkspace = structuredClone((await getFreshAuthSettings()).logicalModels);
        upstreamWorkspace[0].bindings.push({
            id: "binding-two",
            channelId: "channel-two",
            upstreamModel: "writer-v1",
            enabled: true,
            priority: 2,
            costRateCard: rateCard("99"),
            providerCostUnit: { kind: "fiat", currency: "USD" },
        });

        await setAuthSettings({ systemChannels: [channelFixture(), secondChannelFixture()], logicalModels: upstreamWorkspace });

        const added = (await getFreshAuthSettings()).logicalModels[0].bindings.find((binding) => binding.id === "binding-two");
        expect(added).toMatchObject({ id: "binding-two", upstreamModel: "writer-v1" });
        expect(added?.costRateCard).toBeUndefined();
        expect(added?.providerCostUnit).toBeUndefined();
    });

    it("preserves a pricing edit when a stale upstream workspace saves non-pricing model changes", async () => {
        await setAuthSettings({ systemChannels: [channelFixture()], logicalModels: [modelFixture()] });
        await saveAdminModelPricing(pricingPatch("2", "0.5"));
        const staleWorkspace = structuredClone((await getFreshAuthSettings()).logicalModels);

        staleWorkspace[0].name = "Writer renamed upstream";
        staleWorkspace[0].bindings[0].priority = 9;
        const writeStarted = deferred<void>();
        const releaseWrite = deferred<void>();
        memory.beforeWrite = async () => {
            memory.beforeWrite = undefined;
            writeStarted.resolve();
            await releaseWrite.promise;
        };
        const pricingSave = saveAdminModelPricing(pricingPatch("2.5", "0.125"));
        await writeStarted.promise;
        const upstreamSave = setAuthSettings({ logicalModels: staleWorkspace });
        releaseWrite.resolve();
        await Promise.all([pricingSave, upstreamSave]);

        const saved = (await getFreshAuthSettings()).logicalModels[0];
        expect(saved).toMatchObject({
            name: "Writer renamed upstream",
            saleRateCard: { components: [{ unitPrice: "2.5" }] },
            bindings: [{ priority: 9, costRateCard: { components: [{ unitPrice: "0.125" }] }, providerCostUnit: { kind: "provider-native", usdConversion: { version: "fx-v2", usdPerUnit: "0.004" } } }],
        });
    });

    it("serializes concurrently queued same-target pricing writes in lock order while preserving omitted binding fields", async () => {
        await setAuthSettings({ systemChannels: [channelFixture()], logicalModels: [modelFixture()] });
        const firstWriteStarted = deferred<void>();
        const releaseFirstWrite = deferred<void>();
        const secondWriteStarted = deferred<void>();
        const releaseSecondWrite = deferred<void>();
        let writeNumber = 0;
        memory.beforeWrite = async () => {
            writeNumber += 1;
            if (writeNumber === 1) {
                firstWriteStarted.resolve();
                await releaseFirstWrite.promise;
            } else if (writeNumber === 2) {
                secondWriteStarted.resolve();
                await releaseSecondWrite.promise;
            }
        };
        const first = saveAdminModelPricing(pricingPatch("2.5", "0.125"));
        await firstWriteStarted.promise;
        const second = saveAdminModelPricing({ modelId: "writer", saleRateCard: rateCard("3.75"), bindings: [] });
        releaseFirstWrite.resolve();
        await secondWriteStarted.promise;
        releaseSecondWrite.resolve();

        await Promise.all([first, second]);

        const saved = (await getFreshAuthSettings()).logicalModels[0];
        expect(writeNumber).toBe(2);
        expect(saved.saleRateCard?.components[0].unitPrice).toBe("3.75");
        expect(saved.bindings[0].costRateCard?.components[0].unitPrice).toBe("0.125");
        expect(saved.bindings[0].providerCostUnit).toEqual({ kind: "provider-native", provider: "vendor", unit: "compute", usdConversion: { version: "fx-v2", usdPerUnit: "0.004" } });
    });
});

function modelFixture() {
    return {
        id: "writer",
        name: "Writer",
        capability: "text" as const,
        enabled: true,
        saleRateCard: rateCard("2"),
        bindings: [
            {
                id: "binding-one",
                channelId: "channel-one",
                upstreamModel: "writer-v1",
                enabled: true,
                priority: 1,
                costRateCard: rateCard("0.5"),
                providerCostUnit: { kind: "provider-native" as const, provider: "vendor", unit: "compute", usdConversion: { version: "fx-v1", usdPerUnit: "0.005" } },
            },
        ],
    };
}

function channelFixture() {
    return { id: "channel-one", name: "Channel one", baseUrl: "https://provider.example.com", apiKey: "secret", apiFormat: "openai" as const, models: ["writer-v1"], enabled: true };
}

function secondChannelFixture() {
    return { id: "channel-two", name: "Channel two", baseUrl: "https://backup.example.com", apiKey: "secret", apiFormat: "openai" as const, models: ["writer-v1"], enabled: true };
}

function pricingPatch(sale: string, cost: string) {
    return {
        modelId: "writer",
        saleRateCard: rateCard(sale),
        bindings: [
            {
                bindingId: "binding-one",
                costRateCard: rateCard(cost),
                providerCostUnit: { kind: "provider-native" as const, provider: "vendor", unit: "compute", usdConversion: { version: "fx-v2", usdPerUnit: "0.004" } },
            },
        ],
    };
}

function rateCard(unitPrice: string) {
    return { version: 1 as const, components: [{ id: "tokens", dimension: "inputTokens" as const, unitPrice, per: "1" }] };
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
