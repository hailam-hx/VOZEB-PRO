import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { getFreshAuthSettings, setAuthSettings } from "@/lib/auth/store";
import { ensurePostgresSchema } from "@/lib/server/database";
import { saveAdminModelPricing } from "./admin-model-pricing-service";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

postgresIt("preserves interleaved pricing and non-pricing logical-model edits in PostgreSQL", async () => {
    await ensurePostgresSchema();
    const original = await getFreshAuthSettings();
    const suffix = randomUUID();
    const modelId = `pricing-${suffix}`;
    const bindingId = `binding-${suffix}`;
    const channelId = `channel-${suffix}`;
    const channel = { id: channelId, name: "Pricing concurrency channel", baseUrl: "https://provider.example.com", apiKey: "integration-secret", apiFormat: "openai" as const, models: [`writer-${suffix}`], enabled: true };
    const initial = {
        id: modelId,
        name: "Pricing concurrency",
        capability: "text" as const,
        enabled: true,
        saleRateCard: rateCard("2"),
        bindings: [{ id: bindingId, channelId, upstreamModel: `writer-${suffix}`, enabled: true, priority: 1, costRateCard: rateCard("0.5"), providerCostUnit: { kind: "fiat" as const, currency: "USD" as const } }],
    };
    try {
        await setAuthSettings({ systemChannels: [...original.systemChannels, channel], logicalModels: [...original.logicalModels, initial] });
        await saveAdminModelPricing({ modelId, saleRateCard: rateCard("2"), bindings: [{ bindingId, costRateCard: rateCard("0.5"), providerCostUnit: { kind: "fiat", currency: "USD" } }] });
        const staleWorkspace = structuredClone((await getFreshAuthSettings()).logicalModels);

        const staleTarget = staleWorkspace.find((model) => model.id === modelId)!;
        staleTarget.name = "Pricing concurrency renamed";
        staleTarget.bindings[0].priority = 7;
        await Promise.all([
            saveAdminModelPricing({ modelId, saleRateCard: rateCard("2.75"), bindings: [{ bindingId, costRateCard: rateCard("0.25"), providerCostUnit: { kind: "fiat", currency: "USD" } }] }),
            setAuthSettings({ logicalModels: staleWorkspace }),
        ]);

        expect((await getFreshAuthSettings()).logicalModels.find((model) => model.id === modelId)).toMatchObject({
            name: "Pricing concurrency renamed",
            saleRateCard: { components: [{ unitPrice: "2.75" }] },
            bindings: [{ priority: 7, costRateCard: { components: [{ unitPrice: "0.25" }] } }],
        });
    } finally {
        await setAuthSettings({ systemChannels: original.systemChannels, logicalModels: original.logicalModels });
    }
});

function rateCard(unitPrice: string) {
    return { version: 1 as const, components: [{ id: "tokens", dimension: "inputTokens" as const, unitPrice, per: "1" }] };
}
