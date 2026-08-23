import { describe, expect, it } from "vitest";

import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store";
import { normalizeLogicalModelsConfig } from "./model-routing-config";

describe("model routing pricing contracts", () => {
    it("preserves valid sale and provider cost rate cards through model synchronization", () => {
        const channels: SystemModelChannel[] = [{ id: "channel", name: "Channel", baseUrl: "https://channel.example.com", apiKey: "secret", apiFormat: "openai", models: ["writer"], enabled: true }];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                saleRateCard: { version: 1, components: [{ id: "input", dimension: "inputTokens", unitPrice: "0.01" }] },
                bindings: [
                    {
                        id: "binding",
                        channelId: "channel",
                        upstreamModel: "writer",
                        enabled: true,
                        priority: 1,
                        costRateCard: { version: 1, components: [{ id: "input", dimension: "inputTokens", unitPrice: "0.0001" }] },
                        providerCostUnit: { kind: "provider-native", provider: "vendor", unit: "token", usdConversion: { version: "vendor-1", usdPerUnit: "0.00001" } },
                    },
                ],
            },
        ];

        expect(normalizeLogicalModelsConfig(models, channels)[0]).toMatchObject({
            saleRateCard: models[0].saleRateCard,
            bindings: [{ costRateCard: models[0].bindings[0].costRateCard, providerCostUnit: models[0].bindings[0].providerCostUnit }],
        });
    });
});
