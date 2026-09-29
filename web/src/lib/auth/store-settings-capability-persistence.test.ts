import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.VOZEB_PRO_DATA_DIR;
const originalDatabaseProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const originalEncryptionKey = process.env.VOZEB_PRO_ENCRYPTION_KEY;

import { getFreshAuthSettings, mutateAuthLogicalModels, setAuthSettings } from "./store-settings-actions";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";
import { applyChannelProtocol, emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { parseDflopModelMetadata } from "@/lib/dflop-model-metadata";

describe("file settings capability persistence", () => {
    let dataDir = "";

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "vozeb-capability-settings-"));
        vi.stubEnv("VOZEB_PRO_DATA_DIR", dataDir);
        vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", "file");
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "0123456789abcdef".repeat(4));
    });

    it("round-trips the DFLOP root URL and fixed voice-clone operation", async () => {
        const upstreamMetadata = {
            ...parseDflopModelMetadata({ id: "voice-clone-pro", display_name: "Voice Clone Pro", category: "voice", description: "支持参考音频，最多2个参考音频", max_reference_audios: 1, price_per_voice_clone: "0.25" }),
            runtime: { healthStatus: "available" },
        };
        const channel = applyChannelProtocol(
            {
                id: "dflop",
                name: "DFLOP",
                baseUrl: "https://api.dflop.top",
                apiKey: "fixture-key",
                apiFormat: "openai",
                models: ["voice-clone-pro", "placeholder"],
                enabled: false,
                advancedConfig: {
                    ...emptyAdvancedConfig(),
                    protocol: "dflop",
                    modelCapabilities: { "voice-clone-pro": "audio" },
                    modelDiscovery: {
                        "voice-clone-pro": {
                            kind: "audio",
                            callable: true,
                            matched: true,
                            routable: true,
                            endpointType: "voice_clone",
                            upstreamMetadata,
                        },
                        placeholder: { kind: "text", callable: false, matched: true, routable: false, endpointType: null, supportedProtocols: ["openai_chat"] },
                    },
                },
            },
            "dflop",
        );
        await setAuthSettings({ systemChannels: [channel] });
        const saved = (await getFreshAuthSettings()).systemChannels.find((item) => item.id === "dflop");
        expect(saved).toMatchObject({
            baseUrl: "https://api.dflop.top/v1",
            advancedConfig: {
                protocol: "dflop",
                modelConfigs: { "voice-clone-pro": { createPath: "/audio/voices", queryPath: "/audio/voices/:task_id", deletePath: "/audio/voices/:voice_id" } },
                modelDiscovery: {
                    "voice-clone-pro": {
                        kind: "audio",
                        callable: true,
                        matched: true,
                        routable: true,
                        endpointType: "voice_clone",
                        upstreamMetadata: {
                            displayName: "Voice Clone Pro",
                            category: "voice",
                            descriptionCapabilities: { values: { referenceAudio: true, maxReferenceAudios: 1 }, sources: { referenceAudio: "description", maxReferenceAudios: "upstream" } },
                            metadataConflicts: [{ field: "maxReferenceAudios", structured: 1, description: 2 }],
                            runtime: { healthStatus: "available" },
                            providerPricingProfile: {
                                provider: "dflop",
                                status: "READY",
                                dimensions: [expect.objectContaining({ kind: "VOICE_CLONE_CALL", effectiveValue: "0.25" })],
                            },
                        },
                    },
                    placeholder: { kind: "text", callable: false, matched: true, routable: false, endpointType: null, supportedProtocols: ["openai_chat"] },
                },
            },
        });
        expect((await getFreshAuthSettings()).logicalModels[0]).toMatchObject({
            name: "Voice Clone Pro",
            nameSource: "upstream",
            bindings: [{ upstreamMetadata: { providerPricingProfile: { status: "READY", dimensions: [expect.objectContaining({ kind: "VOICE_CLONE_CALL", effectiveValue: "0.25" })] } } }],
        });
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
        else process.env.VOZEB_PRO_DATA_DIR = originalDataDir;
        if (originalDatabaseProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
        else process.env.VOZEB_PRO_DATABASE_PROVIDER = originalDatabaseProvider;
        if (originalEncryptionKey === undefined) delete process.env.VOZEB_PRO_ENCRYPTION_KEY;
        else process.env.VOZEB_PRO_ENCRYPTION_KEY = originalEncryptionKey;
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

    it("round-trips pricing policy, binding provider pricing, and the logical-model suggestion", async () => {
        const channel = { id: "pricing-channel", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "fixture", apiFormat: "openai" as const, models: ["priced-video"], enabled: true };
        const providerPricingProfile = parseDflopModelMetadata({ id: "priced-video", category: "video", price_per_video_second: "90.72", pricing_synced_at: "2026-09-24T00:00:00.000Z" }).providerPricingProfile!;
        providerPricingProfile.dimensions[0].source = "manual";
        providerPricingProfile.dimensions[0].effectiveValue = "95";
        providerPricingProfile.conversion = {
            pricingPolicyVersion: "pricing-policy-v1:test",
            dflopCreditsPerCny: "60",
            dflopCreditsPerCnySource: "upstream",
            dflopCurrencyConfigVersion: "dflop-currency-v1:test",
            cnyToUsd: "0.15",
            hotxUsdPerCredit: "1",
            calculatedAt: "2026-09-24T00:00:01.000Z",
        };
        const pricingPolicy = {
            version: "ignored-on-normalize",
            dflopCreditsPerCny: "60",
            dflopCreditsPerCnySource: "upstream" as const,
            dflopCurrencyConfigVersion: "dflop-currency-v1:test",
            cnyToUsd: "0.15",
            hotxUsdPerCredit: "1",
            markupMultiplier: "1",
            minimumMarginRate: null,
            costBasis: "max_active_binding_cost" as const,
            autoApplySalePrice: false,
        };
        const suggestedSaleRateCard = {
            rateCard: { version: 1 as const, revision: "suggested-v1", components: [{ id: "video-720", dimension: "durationSeconds" as const, unitPrice: "0.2268", when: { resolution: "720p" } }] },
            pricingPolicyVersion: "pricing-policy-v1:test",
            calculatedAt: "2026-09-24T00:00:02.000Z",
            costBasis: "max_active_binding_cost" as const,
            markupMultiplier: "1",
            bindingInputs: [{ bindingId: "priced-video:pricing-channel", channelId: "pricing-channel", provider: "dflop", costRateRevision: "cost-v1", pricingStatus: "READY" as const }],
            conversionInputs: [providerPricingProfile.conversion],
        };

        await setAuthSettings({
            pricingPolicy,
            systemChannels: [channel],
            logicalModels: [{ id: "priced-video", name: "Priced Video", capability: "video", enabled: true, bindings: [{ id: "priced-video:pricing-channel", channelId: channel.id, upstreamModel: "priced-video", enabled: true, priority: 1 }] }],
        });
        await mutateAuthLogicalModels((models) =>
            models.map((model) => ({
                ...model,
                saleRateCard: suggestedSaleRateCard.rateCard,
                salePriceSource: "approved" as const,
                salePriceApproval: {
                    suggestedRevision: suggestedSaleRateCard.rateCard.revision!,
                    pricingPolicyVersion: suggestedSaleRateCard.pricingPolicyVersion,
                    calculatedAt: suggestedSaleRateCard.calculatedAt,
                    costBasis: suggestedSaleRateCard.costBasis,
                    markupMultiplier: suggestedSaleRateCard.markupMultiplier,
                    approvedAt: "2026-09-24T00:00:03.000Z",
                    approvedBy: "admin-1",
                    batchOperationId: "batch-1",
                },
                suggestedSaleRateCard,
                bindings: model.bindings.map((binding) => ({ ...binding, providerPricingProfile })),
            })),
        );

        const restored = await getFreshAuthSettings();
        expect(restored.pricingPolicy).toMatchObject({ dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", costBasis: "max_active_binding_cost" });
        expect(restored.logicalModels[0].bindings[0].providerPricingProfile).toMatchObject({
            dimensions: [expect.objectContaining({ source: "manual", upstreamValue: "90.72", effectiveValue: "95" })],
            conversion: expect.objectContaining({ dflopCurrencyConfigVersion: "dflop-currency-v1:test" }),
        });
        expect(restored.logicalModels[0].suggestedSaleRateCard).toMatchObject({ calculatedAt: "2026-09-24T00:00:02.000Z", costBasis: "max_active_binding_cost", markupMultiplier: "1" });
        expect(restored.logicalModels[0]).toMatchObject({ salePriceSource: "approved", salePriceApproval: { suggestedRevision: expect.any(String), approvedBy: "admin-1", batchOperationId: "batch-1" } });

        await setAuthSettings({ pricingPolicy: { ...pricingPolicy, cnyToUsd: "0.1428571429" } });
        const updated = await getFreshAuthSettings();
        expect(updated.pricingPolicy.cnyToUsd).toBe("0.1428571429");
        expect(updated.logicalModels[0].bindings[0].providerPricingProfile?.dimensions[0].providerCostHotxCredits).toBe("0.226190476258333333333333333333333333");
        expect(updated.logicalModels[0].suggestedSaleRateCard?.rateCard.components[0].unitPrice).toBe("0.226190476258333333333333333333333333");
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
