import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.VOZEB_PRO_DATA_DIR;
const originalDatabaseProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;

import { getFreshAuthSettings, mutateAuthLogicalModels, setAuthSettings } from "./store-settings-actions";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";

describe("file settings capability persistence", () => {
    let dataDir = "";

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "vozeb-capability-settings-"));
        vi.stubEnv("VOZEB_PRO_DATA_DIR", dataDir);
        vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", "file");
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
        else process.env.VOZEB_PRO_DATA_DIR = originalDataDir;
        if (originalDatabaseProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
        else process.env.VOZEB_PRO_DATABASE_PROVIDER = originalDatabaseProvider;
    });

    it("writes a nested generation profile and exposes it through an immediate fresh read", async () => {
        const systemChannels = [{ id: "one", name: "渠道", baseUrl: "https://api.example.com/v1", apiKey: "", apiFormat: "openai" as const, models: ["image"], enabled: true }];
        const logicalModels = [
            {
                id: "image",
                name: "图片",
                capability: "image" as const,
                enabled: true,
                bindings: [
                    {
                        id: "image:one",
                        channelId: "one",
                        upstreamModel: "image",
                        enabled: true,
                        priority: 1,
                        generationParameters: normalizeGenerationParameters({
                            aspectRatios: ["16 : 9", "16:9"],
                            pixelSizes: ["1024 × 768"],
                            qualities: ["ultra"],
                            maxBatchSize: 2,
                            supportsCustomBatchSize: true,
                            customBatchSizeRange: { min: 3, max: 8 },
                            supportsCustomDuration: true,
                            customDurationRange: { min: 2.5, max: 12.5 },
                        })!,
                    },
                ],
            },
        ];

        await setAuthSettings({ systemChannels, logicalModels, defaultModels: { imageModel: "image", videoModel: "", textModel: "", audioModel: "", voiceCloneModel: "" } });

        await expect(getFreshAuthSettings()).resolves.toMatchObject({
            logicalModels: [
                {
                    bindings: [
                        {
                            generationParameters: {
                                aspectRatios: ["16:9"],
                                pixelSizes: ["1024x768"],
                                qualities: ["ultra"],
                                maxBatchSize: 2,
                                supportsCustomBatchSize: true,
                                customBatchSizeRange: { min: 3, max: 8 },
                                supportsCustomDuration: true,
                                customDurationRange: { min: 2.5, max: 12.5 },
                            },
                        },
                    ],
                },
            ],
        });
    });

    it("preserves arbitrary concrete defaults through a file write and fresh read", async () => {
        await setAuthSettings({
            generationDefaults: { ...structuredClone((await getFreshAuthSettings()).generationDefaults), agentModeEnabled: false, imageQuality: "ultra", videoQuality: "2K", videoSeconds: 1.5, audioVoice: "narrator", audioFormat: "m4a" },
        });

        await expect(getFreshAuthSettings()).resolves.toMatchObject({ generationDefaults: { agentModeEnabled: false, imageQuality: "ultra", videoQuality: "2K", videoSeconds: 1.5, audioVoice: "narrator", audioFormat: "m4a" } });
    });

    it("preserves protected binding pricing when a settings save moves the binding to another logical model", async () => {
        const systemChannels = [{ id: "one", name: "渠道", baseUrl: "https://api.example.com/v1", apiKey: "", apiFormat: "openai" as const, models: ["gpt-5.6-sol", "gpt-6-astra"], enabled: true }];
        const primaryBinding = { id: "primary:one", channelId: "one", upstreamModel: "gpt-5.6-sol", enabled: true, priority: 1 };
        const fallbackBinding = { id: "fallback:one", channelId: "one", upstreamModel: "gpt-6-astra", enabled: true, priority: 2 };
        const logicalModels = [{ id: "primary", name: "Primary", capability: "text" as const, enabled: true, bindings: [primaryBinding, fallbackBinding] }];

        await setAuthSettings({ systemChannels, logicalModels });
        await mutateAuthLogicalModels((models) =>
            models.map((model) => ({
                ...model,
                bindings: model.bindings.map((binding) =>
                    binding.id === fallbackBinding.id
                        ? {
                              ...binding,
                              costRateCard: { version: 1, revision: "provider-v1", components: [{ id: "output", dimension: "outputTokens", unitPrice: "0.5" }] },
                              providerCostUnit: { kind: "provider-native", provider: "dflop", unit: "token", usdConversion: { version: "dflop-v1", usdPerUnit: "0.00001" } },
                          }
                        : binding,
                ),
            })),
        );
        const pricedBinding = (await getFreshAuthSettings()).logicalModels[0].bindings.find((binding) => binding.id === fallbackBinding.id)!;

        await setAuthSettings({
            logicalModels: [
                { ...logicalModels[0], bindings: [primaryBinding] },
                { id: "gpt-6-astra", name: "GPT-6 Astra", capability: "text", enabled: true, bindings: [fallbackBinding] },
            ],
        });

        const restoredBinding = (await getFreshAuthSettings()).logicalModels.find((model) => model.id === "gpt-6-astra")?.bindings[0];
        expect(restoredBinding?.costRateCard).toEqual(pricedBinding.costRateCard);
        expect(restoredBinding?.providerCostUnit).toEqual(pricedBinding.providerCostUnit);
    });
});
