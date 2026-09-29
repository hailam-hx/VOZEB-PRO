import { describe, expect, it } from "vitest";

import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store";
import {
    channelDetectedCapabilities,
    channelModelCapability,
    deriveLogicalModelsConfig,
    dflopModelSyncStats,
    isLogicalModelResolvable,
    mergeChannelModelsIntoLogicalModels,
    modelRoutingValidationErrors,
    normalizeDefaultModelsConfig,
    normalizeLogicalModelsConfig,
    resolveLogicalModelConfig,
    resolveLogicalModelCapabilityProfile,
    synchronizeLogicalModelsWithChannels,
} from "./model-routing-config";
import { normalizeImageQualityProfile } from "./image-quality-profile";
import { parseDflopPricing } from "./dflop-pricing";
import { DEFAULT_SYSTEM_PRICING_POLICY } from "./billing/pricing-policy";
import { applyCapabilityProbeToPricingProfile, capabilityProbeFingerprint } from "./billing/provider-capability-probe";
import { applyProviderPricingConversion } from "./billing/provider-pricing";

const channel = (id: string, models: string[], enabled = true): SystemModelChannel => ({ id, name: id, baseUrl: `https://${id}.example.com/v1`, apiKey: "test-secret", apiFormat: "openai", models, enabled });

describe("model routing config", () => {
    it("synchronizes DFLOP text token limits from public metadata and refreshes upstream-managed values", () => {
        const upstream = channel("dflop", ["writer"]);
        const runtime: Record<string, unknown> = { contextWindow: 1050000, defaultMaxTokens: 8192 };
        upstream.advancedConfig = {
            protocol: "dflop",
            modelDiscovery: {
                writer: { kind: "text", matched: true, routable: true, upstreamMetadata: { category: "text", runtime } },
            },
        } as never;
        const first = synchronizeLogicalModelsWithChannels([], [upstream]);
        expect(first[0].bindings[0].capabilityProfile).toMatchObject({ maxInputTokens: 1041808, maxOutputTokens: 8192, maxInputTokensSource: "upstream", maxOutputTokensSource: "upstream" });

        runtime.contextWindow = 2000000;
        runtime.defaultMaxTokens = 16384;
        const second = synchronizeLogicalModelsWithChannels(first, [upstream]);
        expect(second[0].bindings[0].capabilityProfile).toMatchObject({ maxInputTokens: 1983616, maxOutputTokens: 16384, maxInputTokensSource: "upstream", maxOutputTokensSource: "upstream" });
    });

    it("preserves manually set text token limits per field and ignores missing or invalid upstream values", () => {
        const upstream = channel("dflop", ["writer"]);
        const runtime: Record<string, unknown> = { contextWindow: 128000, defaultMaxTokens: 8192 };
        upstream.advancedConfig = {
            protocol: "dflop",
            modelDiscovery: {
                writer: { kind: "text", matched: true, routable: true, upstreamMetadata: { category: "text", runtime } },
            },
        } as never;
        const first = synchronizeLogicalModelsWithChannels([], [upstream]);
        first[0].bindings[0].capabilityProfile = { maxInputTokens: 64000, maxInputTokensSource: "manual", maxOutputTokens: 8192, maxOutputTokensSource: "upstream" };
        runtime.contextWindow = 256000;
        runtime.defaultMaxTokens = 16384;
        const second = synchronizeLogicalModelsWithChannels(first, [upstream]);
        expect(second[0].bindings[0].capabilityProfile).toMatchObject({ maxInputTokens: 64000, maxInputTokensSource: "manual", maxOutputTokens: 16384, maxOutputTokensSource: "upstream" });

        runtime.contextWindow = -1;
        runtime.defaultMaxTokens = null;
        const third = synchronizeLogicalModelsWithChannels(second, [upstream]);
        expect(third[0].bindings[0].capabilityProfile).toMatchObject({ maxInputTokens: 64000, maxOutputTokens: 16384 });

        third[0].bindings[0].capabilityProfile!.maxInputTokensSource = "upstream";
        runtime.contextWindow = 8000;
        const fourth = synchronizeLogicalModelsWithChannels(third, [upstream]);
        expect(fourth[0].bindings[0].capabilityProfile?.maxInputTokens).toBeUndefined();
    });

    it("does not infer token limits for non-DFLOP text channels", () => {
        const upstream = channel("other", ["writer"]);
        const models = synchronizeLogicalModelsWithChannels([], [upstream]);
        expect(models[0].bindings[0].capabilityProfile?.maxInputTokens).toBeUndefined();
        expect(models[0].bindings[0].capabilityProfile?.maxOutputTokens).toBeUndefined();
    });

    it("does not invent an input ceiling without a known output reservation", () => {
        const upstream = channel("dflop", ["writer"]);
        upstream.advancedConfig = { protocol: "dflop", modelDiscovery: { writer: { kind: "text", matched: true, routable: true, upstreamMetadata: { category: "text", runtime: { contextWindow: 128000 } } } } } as never;
        const binding = synchronizeLogicalModelsWithChannels([], [upstream])[0].bindings[0];
        expect(binding.capabilityProfile?.maxInputTokens).toBeUndefined();
        expect(binding.capabilityProfile?.maxOutputTokens).toBeUndefined();
    });

    it("derives authoritative DFLOP image quality profiles without writing generic qualities", () => {
        const upstream = channel("dflop", ["tvod-midjourney-v7"]);
        upstream.advancedConfig = {
            protocol: "dflop",
            modelDiscovery: {
                "tvod-midjourney-v7": {
                    kind: "image",
                    matched: true,
                    routable: true,
                    upstreamMetadata: { category: "image", generationParameters: { qualities: ["high", "low"] } },
                },
            },
        } as never;

        const binding = synchronizeLogicalModelsWithChannels([], [upstream])[0].bindings[0];
        expect(binding.imageQualityProfile).toMatchObject({ source: "provider_preset", controlType: "prompt_flag", defaultValue: "standard" });
        expect(binding.generationParameters?.qualities).toEqual([]);
    });

    it("preserves a manual DFLOP quality profile while updating its upstream candidate", () => {
        const upstream = channel("dflop", ["tvod-midjourney-v7"]);
        upstream.advancedConfig = { protocol: "dflop", modelDiscovery: { "tvod-midjourney-v7": { kind: "image", matched: true, routable: true, upstreamMetadata: { category: "image" } } } } as never;
        const manual = normalizeImageQualityProfile({
            version: 1,
            controlType: "request_parameter",
            selectionMode: "explicit",
            source: "manual",
            options: [{ value: "raw", label: "Raw", effect: { type: "request_parameter", requestParameter: { name: "quality", value: "raw" } } }],
            defaultValue: "raw",
            validation: { status: "VALID", reasons: [], validatedAt: "2026-09-24T00:00:00.000Z" },
        })!;
        const existing: LogicalModel[] = [
            { id: "tvod-midjourney-v7", name: "MJ", capability: "image", enabled: true, bindings: [{ id: "binding", channelId: "dflop", upstreamModel: "tvod-midjourney-v7", enabled: true, priority: 1, imageQualityProfile: manual }] },
        ];

        const binding = synchronizeLogicalModelsWithChannels(existing, [upstream])[0].bindings[0];
        expect(binding.imageQualityProfile).toMatchObject({ source: "manual", validation: { status: "DRIFT" }, upstreamCandidate: { source: "provider_preset", controlType: "prompt_flag" } });
    });

    it("creates a DFLOP logical model from upstream name and structured generation metadata", () => {
        const upstream = {
            ...channel("dflop", ["doubao-seedance-2.5"]),
            advancedConfig: {
                protocol: "dflop",
                modelDiscovery: {
                    "doubao-seedance-2.5": {
                        kind: "video",
                        matched: true,
                        routable: true,
                        upstreamMetadata: {
                            displayName: "Seedance 2.5",
                            category: "video",
                            generationParameters: {
                                referenceInputs: ["image", "video", "audio"],
                                maxReferenceImages: 30,
                                aspectRatios: ["16:9", "9:16"],
                                pixelSizes: [],
                                supportsCustomSize: false,
                                qualities: [],
                                resolutions: ["480p", "720p", "1080p"],
                                durationMode: "range",
                                durationSeconds: [],
                                durationRange: { min: 4, max: 30 },
                                supportsCustomDuration: true,
                                customDurationRange: { min: 4, max: 30 },
                                videoReferenceModes: ["reference", "first_frame", "first_last"],
                                voices: [],
                                formats: [],
                            },
                            generationParameterSources: { resolutions: "upstream", durationMode: "upstream", durationRange: "upstream", supportsCustomDuration: "upstream", customDurationRange: "upstream", maxReferenceImages: "preset" },
                        },
                    },
                },
            } as unknown as SystemModelChannel["advancedConfig"],
        };

        const [model] = synchronizeLogicalModelsWithChannels([], [upstream]);
        expect(model).toMatchObject({ name: "Seedance 2.5", nameSource: "upstream", capability: "video" });
        expect(model.bindings[0]).toMatchObject({
            generationParameters: { resolutions: ["480", "720", "1080"], durationRange: { min: 4, max: 30 }, maxReferenceImages: 30 },
            generationParameterSources: { resolutions: "upstream", maxReferenceImages: "preset" },
        });
    });

    it("updates upstream-managed fields, preserves manual fields, and reports DFLOP drift", () => {
        const upstream = {
            ...channel("dflop", ["video-model"]),
            advancedConfig: {
                protocol: "dflop",
                modelDiscovery: {
                    "video-model": {
                        kind: "video",
                        matched: true,
                        routable: true,
                        upstreamMetadata: {
                            displayName: "Upstream Name 2",
                            generationParameters: {
                                referenceInputs: [],
                                aspectRatios: ["16:9", "9:16"],
                                pixelSizes: [],
                                supportsCustomSize: false,
                                qualities: [],
                                resolutions: ["1080p"],
                                durationSeconds: [],
                                videoReferenceModes: [],
                                voices: [],
                                formats: [],
                            },
                            generationParameterSources: { aspectRatios: "upstream", resolutions: "upstream" },
                        },
                    },
                },
            } as unknown as SystemModelChannel["advancedConfig"],
        };
        const existing: LogicalModel[] = [
            {
                id: "video-model",
                name: "Admin Name",
                nameSource: "manual",
                capability: "video",
                enabled: true,
                bindings: [
                    {
                        id: "binding",
                        channelId: "dflop",
                        upstreamModel: "video-model",
                        enabled: true,
                        priority: 1,
                        generationParameters: { referenceInputs: [], aspectRatios: ["16:9"], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: ["4k"], durationSeconds: [], videoReferenceModes: [], voices: [], formats: [] },
                        generationParameterSources: { aspectRatios: "upstream", resolutions: "manual" },
                    },
                ],
            },
        ];

        const [model] = synchronizeLogicalModelsWithChannels(existing, [upstream]);
        expect(model.name).toBe("Admin Name");
        expect(model.bindings[0].generationParameters).toMatchObject({ aspectRatios: ["16:9", "9:16"], resolutions: ["4k"] });
        expect(model.bindings[0].capabilityDrifts).toEqual([{ field: "resolutions", local: ["4k"], upstream: ["1080"], source: "manual" }]);
    });

    it("reconciles DFLOP pricing per dimension and rebuilds the binding cost projection", () => {
        const oldProfile = parseDflopPricing({ video_price_tiers: { "720p": "90.72" } }, { modelId: "video-priced", category: "video", syncedAt: "2026-09-23T00:00:00.000Z" });
        oldProfile.dimensions[0] = { ...oldProfile.dimensions[0], source: "manual", effectiveValue: "95" };
        const newProfile = parseDflopPricing({ video_price_tiers: { "720p": "100", "1080p": "224.532" } }, { modelId: "video-priced", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });
        const upstream = channel("dflop", ["video-priced"]);
        upstream.advancedConfig = { protocol: "dflop", modelDiscovery: { "video-priced": { kind: "video", matched: true, routable: true, upstreamMetadata: { providerPricingProfile: newProfile } } } } as never;
        const existing: LogicalModel[] = [
            { id: "video-priced", name: "Video", capability: "video", enabled: true, bindings: [{ id: "binding", channelId: "dflop", upstreamModel: "video-priced", enabled: true, priority: 1, providerPricingProfile: oldProfile }] },
        ];

        const binding = synchronizeLogicalModelsWithChannels(existing, [upstream], DEFAULT_SYSTEM_PRICING_POLICY)[0].bindings[0];
        expect(binding.providerPricingProfile?.dimensions.find((item) => item.conditions?.resolution === "720p")).toMatchObject({ source: "manual", upstreamValue: "100", effectiveValue: "95", providerCostHotxCredits: "0.2375" });
        expect(binding.costRateCard?.components).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ dimension: "durationSeconds", unitPrice: "0.2375", when: { resolution: "720p" } }),
                expect.objectContaining({ dimension: "durationSeconds", unitPrice: "0.56133", when: { resolution: "1080p" } }),
            ]),
        );
        expect(binding.providerCostUnit).toEqual({ kind: "provider-native", provider: "hotx", unit: "credit", usdConversion: { version: DEFAULT_SYSTEM_PRICING_POLICY.version, usdPerUnit: "1" } });
    });

    it("preserves a matching manual capability probe across ordinary sync and invalidates it on contract drift", () => {
        const oldProfile = parseDflopPricing({ input_per_1m: "10", output_per_1m: "20", price_per_image: "30", supports_image_gen: true }, { modelId: "gpt-6", category: "text", syncedAt: "2026-09-23T00:00:00.000Z" });
        const probed = applyProviderPricingConversion(
            applyCapabilityProbeToPricingProfile(oldProfile, {
                version: 1,
                provider: "dflop",
                modelId: "gpt-6",
                channelId: "dflop",
                bindingId: "binding",
                operationScope: "builtin_image_generation",
                endpoint: "/v1/responses",
                outcome: "unsupported",
                supported: false,
                statusCode: 400,
                upstreamErrorCode: "tool_not_supported",
                usageSeen: false,
                imageOutputSeen: false,
                billingEvidence: { basis: "unresolved", authoritative: false, source: "none" },
                probedAt: "2026-09-23T01:00:00.000Z",
                registryFingerprint: capabilityProbeFingerprint(oldProfile),
            }),
            DEFAULT_SYSTEM_PRICING_POLICY,
            "2026-09-23T01:00:00.000Z",
        );
        const existing: LogicalModel[] = [{ id: "gpt-6", name: "GPT-6", capability: "text", enabled: true, bindings: [{ id: "binding", channelId: "dflop", upstreamModel: "gpt-6", enabled: true, priority: 1, providerPricingProfile: probed }] }];
        const synced = (supportsImageGeneration: boolean) => {
            const profile = parseDflopPricing({ input_per_1m: "10", output_per_1m: "20", price_per_image: "30", supports_image_gen: supportsImageGeneration }, { modelId: "gpt-6", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });
            const upstream = channel("dflop", ["gpt-6"]);
            upstream.advancedConfig = { protocol: "dflop", modelDiscovery: { "gpt-6": { kind: "text", matched: true, routable: true, upstreamMetadata: { providerPricingProfile: profile } } } } as never;
            return synchronizeLogicalModelsWithChannels(existing, [upstream], DEFAULT_SYSTEM_PRICING_POLICY)[0].bindings[0].providerPricingProfile!;
        };

        expect(synced(true)).toMatchObject({ status: "READY", operationPricingStatus: { builtin_image_generation: { status: "UNSUPPORTED" } } });
        expect(synced(false)).toMatchObject({ status: "PARTIAL", operationPricingStatus: { standalone_image_generation: { status: "PARTIAL" } } });
        expect(synced(false).metadata?.capabilityProbes).toBeUndefined();
    });

    it("does not report a model update when only pricing sync timestamps change", () => {
        const oldProfile = parseDflopPricing({ price_per_image: "80" }, { modelId: "image-priced", category: "image", syncedAt: "2026-09-23T00:00:00.000Z" });
        const newProfile = parseDflopPricing({ price_per_image: "80" }, { modelId: "image-priced", category: "image", syncedAt: "2026-09-24T00:00:00.000Z" });
        const updatedChannel = channel("dflop", ["image-priced"]);
        updatedChannel.advancedConfig = { protocol: "dflop", modelDiscovery: { "image-priced": { kind: "image", matched: true, routable: true, upstreamMetadata: { providerPricingProfile: newProfile } } } } as never;
        const existing: LogicalModel[] = [
            {
                id: "image-priced",
                name: "Image",
                nameSource: "upstream",
                capability: "image",
                enabled: true,
                bindings: [{ id: "binding", channelId: "dflop", upstreamModel: "image-priced", enabled: true, priority: 1, upstreamMetadata: { providerPricingProfile: oldProfile }, providerPricingProfile: oldProfile }],
            },
        ];

        expect(dflopModelSyncStats(existing, [], updatedChannel)).toMatchObject({
            updated: 0,
            changedModels: [],
            imageQualityProfiles: { total: 1, valid: 1, drift: 0, needsReview: 0, invalid: 0, manual: 0, none: 1, unprofiled: 0 },
        });
    });

    it("keeps discovered DFLOP catalog entries out of logical routing when metadata marks them unavailable or unsupported", () => {
        const upstream = {
            ...channel("dflop", ["writer", "music-only", "placeholder"]),
            advancedConfig: {
                protocol: "dflop",
                modelCapabilities: { writer: "text" },
                modelDiscovery: {
                    writer: { kind: "text", callable: true, matched: true, routable: true },
                    "music-only": { kind: "other", callable: true, matched: true, routable: false },
                    placeholder: { kind: "text", callable: false, matched: true, routable: false },
                },
            } as unknown as SystemModelChannel["advancedConfig"],
        };

        expect(synchronizeLogicalModelsWithChannels([], [upstream]).map((model) => model.id)).toEqual(["writer"]);
        expect(Array.from(channelDetectedCapabilities(upstream))).toEqual(["text"]);
    });

    it("initializes DFLOP voice cloning only for a new binding and preserves later edits", () => {
        const upstream = {
            ...channel("dflop", ["voice-clone-pro"]),
            advancedConfig: {
                protocol: "dflop" as const,
                textModel: "",
                imageModel: "",
                videoModel: "",
                createPath: "",
                editPath: "",
                imageToVideoPath: "",
                queryPath: "",
                requestTemplate: "",
                resultField: "",
                statusField: "",
                durationRange: "",
                referenceRule: "",
                supportsReferenceImage: false,
                supportsReferenceVideo: false,
                supportsReferenceAudio: false,
            },
        };
        const created = synchronizeLogicalModelsWithChannels([], [upstream]);
        expect(created[0].bindings[0]).toMatchObject({ generationParameters: { audioOperation: "voice-clone" }, capabilityProfile: { supportsIdempotency: true } });
        const edited = [{ ...created[0], bindings: [{ ...created[0].bindings[0], capabilityProfile: { supportsIdempotency: false }, generationParameters: { ...created[0].bindings[0].generationParameters!, audioOperation: "speech" as const } }] }];
        expect(synchronizeLogicalModelsWithChannels(edited, [upstream])[0].bindings[0]).toMatchObject({ capabilityProfile: { supportsIdempotency: false }, generationParameters: { audioOperation: "speech" } });
    });
    it("persists the normalized text streaming stage deadlines on a binding", () => {
        const models = normalizeLogicalModelsConfig(
            [
                {
                    id: "writer",
                    name: "Writer",
                    capability: "text",
                    enabled: true,
                    bindings: [
                        {
                            id: "writer:one",
                            channelId: "one",
                            upstreamModel: "writer",
                            enabled: true,
                            priority: 1,
                            capabilityProfile: { timeoutMs: 120_000, streamingTimeouts: { connectMs: 10_000.9, firstByteMs: 20_000, firstTextMs: 30_000, idleMs: 40_000 } },
                        },
                    ],
                },
            ],
            [channel("one", ["writer"])],
        );

        expect(models[0]?.bindings[0]?.capabilityProfile).toEqual({ timeoutMs: 120_000, streamingTimeouts: { connectMs: 10_000, firstByteMs: 20_000, firstTextMs: 30_000, idleMs: 40_000 } });
    });

    it("rejects a configured streaming stage deadline beyond the resolved overall timeout", () => {
        const channels = [channel("one", ["writer"])];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [{ id: "writer:one", channelId: "one", upstreamModel: "writer", enabled: true, priority: 1, capabilityProfile: { streamingTimeouts: { firstTextMs: 180_001 } } }],
            },
        ];

        expect(modelRoutingValidationErrors(models, channels, { textModel: "writer", imageModel: "", videoModel: "", audioModel: "", voiceCloneModel: "" })).toContain("逻辑模型 writer 的首段文本超时不能超过总请求超时");
    });

    it("removes missing, unsupported, and duplicate bindings", () => {
        const channels = [channel("one", ["models/GPT-TEST"]), channel("two", ["gpt-test-2"], false)];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "one", channelId: "one", upstreamModel: "gpt-test", enabled: true, priority: 2 },
                    { id: "duplicate", channelId: "one", upstreamModel: "models/GPT-TEST", enabled: true, priority: 1 },
                    { id: "missing", channelId: "missing", upstreamModel: "gpt-test", enabled: true, priority: 3 },
                    { id: "unsupported", channelId: "two", upstreamModel: "other", enabled: true, priority: 4 },
                ],
            },
        ];
        expect(normalizeLogicalModelsConfig(models, channels)[0].bindings).toEqual([{ id: "one", channelId: "one", upstreamModel: "models/GPT-TEST", enabled: true, priority: 2 }]);
    });

    it("rebuilds an explicitly empty logical model catalog from channel models", () => {
        const channels = [channel("one", ["writer"])];

        expect(normalizeLogicalModelsConfig([], channels)).toHaveLength(1);
        expect(normalizeLogicalModelsConfig(undefined, channels)).toHaveLength(1);
    });

    it("distinguishes SD2.0 video aliases from full Stable Diffusion image names", () => {
        const models = normalizeLogicalModelsConfig(undefined, [channel("one", ["sd2.0", "sd_2.0_fast_discount_720p", "seedance-2.0", "stable-diffusion-2.0", "sdxl"])]);

        expect(models.find((model) => model.id === "sd2.0")?.capability).toBe("video");
        expect(models.find((model) => model.id === "sd_2.0_fast_discount_720p")?.capability).toBe("video");
        expect(models.find((model) => model.id === "seedance-2.0")?.capability).toBe("video");
        expect(models.find((model) => model.id === "stable-diffusion-2.0")?.capability).toBe("image");
        expect(models.find((model) => model.id === "sdxl")?.capability).toBe("image");
    });

    it("keeps an explicitly selected logical model capability", () => {
        const channels = [channel("one", ["stable-diffusion-2.0"])];
        const models = normalizeLogicalModelsConfig(
            [{ id: "stable-diffusion-2.0", name: "自定义视频能力", capability: "video", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "stable-diffusion-2.0", enabled: true, priority: 1 }] }],
            channels,
        );

        expect(models[0]?.capability).toBe("video");
        expect(normalizeDefaultModelsConfig({ textModel: "", imageModel: "", videoModel: "stable-diffusion-2.0", audioModel: "" }, models, channels).videoModel).toBe("stable-diffusion-2.0");
    });

    it("uses channel capability metadata before model-name inference", () => {
        const source = channel("one", ["opaque-a", "stable-video-diffusion"]);
        source.advancedConfig = { modelCapabilities: { "opaque-a": "image", "stable-video-diffusion": "video" } } as never;

        const models = deriveLogicalModelsConfig([source]);

        expect(models.find((model) => model.id === "opaque-a")?.capability).toBe("image");
        expect(models.find((model) => model.id === "stable-video-diffusion")?.capability).toBe("video");
    });

    it("repairs stale health detection for Nano Banana image models", () => {
        const source = channel("sub2api", ["gemini-3.1-flash-image-preview", "nano-banana-2"]);
        source.advancedConfig = {
            modelCapabilities: { "gemini-3.1-flash-image-preview": "text", "nano-banana-2": "text" },
            modelConfigs: {
                "gemini-3.1-flash-image-preview": { capability: "text", source: "health" },
                "nano-banana-2": { capability: "text", source: "health" },
            },
        } as never;

        expect(channelModelCapability(source, "gemini-3.1-flash-image-preview")).toBe("image");
        expect(channelModelCapability(source, "nano-banana-2")).toBe("image");
        expect(Array.from(channelDetectedCapabilities(source))).toEqual(["image"]);
    });

    it("uses refreshed protocol catalog metadata to repair an existing logical capability", () => {
        const source = channel("newapi", ["opaque-media"]);
        source.advancedConfig = {
            protocol: "newapi",
            modelCapabilities: { "opaque-media": "image" },
            modelConfigs: { "opaque-media": { capability: "image", source: "provider" } },
        } as never;
        const existing: LogicalModel[] = [{ id: "opaque-media", name: "opaque-media", capability: "text", enabled: true, bindings: [{ id: "old", channelId: "newapi", upstreamModel: "opaque-media", enabled: true, priority: 1 }] }];

        expect(synchronizeLogicalModelsWithChannels(existing, [source])[0]?.capability).toBe("image");
    });

    it("uses single-capability protocol catalogs for opaque model names", () => {
        const video = channel("seedance", ["opaque-video-model"]);
        video.advancedConfig = { protocol: "seedance" } as never;
        const image = channel("stable-diffusion", ["opaque-image-model"]);
        image.advancedConfig = { protocol: "stable-diffusion" } as never;

        expect(channelModelCapability(video, "opaque-video-model")).toBe("video");
        expect(channelModelCapability(image, "opaque-image-model")).toBe("image");
    });

    it("does not expose non-creative channel models to generation surfaces", () => {
        const source = channel("newapi", ["gpt-4.1", "text-embedding-3-small", "bge-reranker-v2-m3", "dots.ocr", "gcp-speech-to-text", "whisper-1", "llama-3.1-nemoguard-8b-topic-control", "tts-1"]);
        source.advancedConfig = {
            protocol: "newapi",
            modelConfigs: {
                "gcp-speech-to-text": { capability: "audio", source: "provider" },
                "whisper-1": { capability: "audio", source: "provider" },
                "tts-1": { capability: "audio", source: "provider" },
            },
        } as never;

        const models = deriveLogicalModelsConfig([source]);

        expect(models.map((model) => model.id)).toEqual(["gpt-4.1", "tts-1"]);
        expect(Array.from(channelDetectedCapabilities(source))).toEqual(["text", "audio"]);
        expect(normalizeDefaultModelsConfig({ textModel: "gpt-4.1", imageModel: "", videoModel: "", audioModel: "gcp-speech-to-text" }, models, [source]).audioModel).toBe("tts-1");
    });

    it("merges the same upstream model from multiple channels into one logical model", () => {
        const channels = [channel("one", ["models/GPT-IMAGE-2"]), channel("two", ["gpt-image-2"])];
        const existing: LogicalModel[] = [{ id: "gpt-image-2", name: "GPT Image 2", capability: "image", enabled: true, bindings: [{ id: "one:gpt-image-2", channelId: "one", upstreamModel: "gpt-image-2", enabled: true, priority: 1 }] }];

        const models = mergeChannelModelsIntoLogicalModels(existing, channels);

        expect(models).toHaveLength(1);
        expect(models[0].bindings).toEqual([{ ...existing[0].bindings[0], upstreamModel: "models/GPT-IMAGE-2" }, expect.objectContaining({ channelId: "two", upstreamModel: "gpt-image-2" })]);
    });

    it("preserves an administrator cross-model fallback membership through catalog synchronization", () => {
        const channels = [channel("dflop", ["gpt-5.6-sol", "gpt-6-astra"])];
        const existing: LogicalModel[] = [
            {
                id: "gpt-5.6-sol",
                name: "GPT-5.6 Sol",
                capability: "text",
                enabled: true,
                saleRateCard: { version: 1, components: [{ id: "input", dimension: "inputTokens", unitPrice: "2" }] },
                bindings: [
                    { id: "primary", channelId: "dflop", upstreamModel: "gpt-5.6-sol", enabled: true, priority: 1 },
                    {
                        id: "backup",
                        channelId: "dflop",
                        upstreamModel: "gpt-6-astra",
                        enabled: true,
                        priority: 2,
                        weight: 80,
                        costRateCard: { version: 1, components: [{ id: "output", dimension: "outputTokens", unitPrice: "0.5" }] },
                        providerCostUnit: { kind: "provider-native", provider: "dflop", unit: "token", usdConversion: { version: "dflop-v1", usdPerUnit: "0.00001" } },
                    },
                ],
            },
        ];

        const models = synchronizeLogicalModelsWithChannels(existing, channels);

        expect(models).toHaveLength(1);
        expect(models[0]).toMatchObject({ id: "gpt-5.6-sol", name: "GPT-5.6 Sol", capability: "text", saleRateCard: { components: [{ unitPrice: "2" }] } });
        expect(models[0].bindings).toEqual([
            expect.objectContaining({ id: "primary", upstreamModel: "gpt-5.6-sol", priority: 1 }),
            expect.objectContaining({
                id: "backup",
                upstreamModel: "gpt-6-astra",
                priority: 2,
                weight: 80,
                costRateCard: expect.objectContaining({ components: [expect.objectContaining({ unitPrice: "0.5" })] }),
                providerCostUnit: { kind: "provider-native", provider: "dflop", unit: "token", usdConversion: { version: "dflop-v1", usdPerUnit: "0.00001" } },
            }),
        ]);
    });

    it("does not merge catalog bindings with the same name but different authoritative capabilities", () => {
        const textChannel = channel("text", ["shared-model"]);
        textChannel.advancedConfig = { modelConfigs: { "shared-model": { capability: "text", source: "provider" } } } as never;
        const imageChannel = channel("image", ["shared-model"]);
        imageChannel.advancedConfig = { modelConfigs: { "shared-model": { capability: "image", source: "provider" } } } as never;

        const models = synchronizeLogicalModelsWithChannels([], [textChannel, imageChannel]);

        expect(models).toHaveLength(2);
        expect(models.map((model) => ({ capability: model.capability, channelIds: model.bindings.map((binding) => binding.channelId) }))).toEqual([
            { capability: "text", channelIds: ["text"] },
            { capability: "image", channelIds: ["image"] },
        ]);
    });

    it("removes stale bindings and creates separate logical models for different upstream names", () => {
        const channels = [channel("one", ["writer", "writer-mini"]), channel("two", ["models/WRITER"])];
        const existing: LogicalModel[] = [
            {
                id: "custom-writer",
                name: "旧名称",
                capability: "text",
                enabled: false,
                bindings: [
                    { id: "keep", channelId: "one", upstreamModel: "writer", enabled: false, priority: 9, weight: 25 },
                    { id: "stale", channelId: "gone", upstreamModel: "writer", enabled: true, priority: 1 },
                ],
            },
        ];

        const models = synchronizeLogicalModelsWithChannels(existing, channels);

        expect(models).toHaveLength(2);
        expect(models[0]).toMatchObject({ id: "custom-writer", name: "旧名称", enabled: false });
        expect(models[0].bindings).toEqual([
            expect.objectContaining({ channelId: "two", upstreamModel: "models/WRITER", priority: 2 }),
            expect.objectContaining({ id: "keep", channelId: "one", upstreamModel: "writer", enabled: false, priority: 9, weight: 25 }),
        ]);
        expect(models[1]).toMatchObject({ id: "writer-mini", name: "writer-mini", bindings: [{ channelId: "one", upstreamModel: "writer-mini" }] });
        expect(models.flatMap((model) => model.bindings).some((binding) => binding.channelId === "gone")).toBe(false);
    });

    it("preserves an administrator model nickname when the channel catalog is synchronized", () => {
        const existing: LogicalModel[] = [
            {
                id: "image-pro",
                name: "商业图片 Pro",
                capability: "image",
                enabled: true,
                bindings: [{ id: "binding", channelId: "one", upstreamModel: "vendor/image-v2", enabled: true, priority: 1 }],
            },
        ];

        expect(synchronizeLogicalModelsWithChannels(existing, [channel("one", ["vendor/image-v2"])])[0]?.name).toBe("商业图片 Pro");
    });

    it("keeps the upstream auto model classified as text", () => {
        const source = channel("one", ["auto"]);
        source.advancedConfig = { modelCapabilities: { auto: "audio" }, modelConfigs: { auto: { capability: "audio", source: "health" } } } as never;

        expect(channelModelCapability(source, "auto")).toBe("text");
    });

    it("only exposes capabilities represented by real channel models", () => {
        const source = channel("one", ["auto", "gpt-5-3", "gpt-image-2"]);

        expect(Array.from(channelDetectedCapabilities(source))).toEqual(["text", "image"]);
    });

    it("requires an enabled matching binding for defaults", () => {
        const channels = [channel("one", ["vendor/writer"]), channel("off", ["voice"], false)];
        const models: LogicalModel[] = [
            { id: "writer", name: "Writer", capability: "text", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "vendor/writer", enabled: true, priority: 1 }] },
            { id: "voice", name: "Voice", capability: "audio", enabled: true, bindings: [{ id: "two", channelId: "off", upstreamModel: "voice", enabled: true, priority: 1 }] },
        ];
        expect(isLogicalModelResolvable(models, channels, "text", "writer")).toBe(true);
        expect(normalizeDefaultModelsConfig({ textModel: "writer", imageModel: "writer", videoModel: "", audioModel: "voice" }, models, channels)).toEqual({ textModel: "writer", imageModel: "", videoModel: "", audioModel: "", voiceCloneModel: "" });
    });

    it("switches a stale default to another resolvable model of the same capability", () => {
        const channels = [channel("off", ["gpt-image-2"], false), channel("backup", ["flux-pro"])];
        const models: LogicalModel[] = [
            { id: "gpt-image-2", name: "GPT Image 2", capability: "image", enabled: true, bindings: [{ id: "off", channelId: "off", upstreamModel: "gpt-image-2", enabled: true, priority: 1 }] },
            { id: "flux-pro", name: "Flux Pro", capability: "image", enabled: true, bindings: [{ id: "backup", channelId: "backup", upstreamModel: "flux-pro", enabled: true, priority: 1 }] },
        ];

        expect(normalizeDefaultModelsConfig({ textModel: "", imageModel: "gpt-image-2", videoModel: "", audioModel: "" }, models, channels).imageModel).toBe("flux-pro");
    });

    it("normalizes speech and voice cloning defaults independently", () => {
        const channels = [channel("dflop", ["voice-tts-pro", "voice-clone-pro"])];
        const models: LogicalModel[] = [
            {
                id: "voice-tts",
                name: "Voice TTS",
                capability: "audio",
                enabled: true,
                bindings: [{ id: "tts", channelId: "dflop", upstreamModel: "voice-tts-pro", enabled: true, priority: 1, generationParameters: { audioOperation: "speech" } as never }],
            },
            {
                id: "voice-clone",
                name: "Voice Clone",
                capability: "audio",
                enabled: true,
                bindings: [{ id: "clone", channelId: "dflop", upstreamModel: "voice-clone-pro", enabled: true, priority: 1, generationParameters: { audioOperation: "voice-clone" } as never }],
            },
        ];

        expect(normalizeDefaultModelsConfig({ textModel: "", imageModel: "", videoModel: "", audioModel: "voice-clone", voiceCloneModel: "voice-tts" } as never, models, channels)).toEqual({
            textModel: "",
            imageModel: "",
            videoModel: "",
            audioModel: "voice-tts",
            voiceCloneModel: "voice-clone",
        });
    });

    it("uses binding priority and falls back from a disabled channel", () => {
        const channels = [channel("primary", ["writer-v1"], false), channel("backup", ["writer-v2"])];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "one", channelId: "primary", upstreamModel: "writer-v1", enabled: true, priority: 1 },
                    { id: "two", channelId: "backup", upstreamModel: "writer-v2", enabled: true, priority: 2 },
                ],
            },
        ];
        expect(resolveLogicalModelConfig(models, channels, "text", "writer")).toMatchObject({ channel: { id: "backup" }, binding: { upstreamModel: "writer-v2" } });
    });

    it("normalizes binding weight and retains only operational capability profile fields", () => {
        const channels = [channel("one", ["video-model"])];
        const models = normalizeLogicalModelsConfig(
            [
                {
                    id: "video",
                    name: "Video",
                    capability: "video",
                    enabled: true,
                    bindings: [
                        {
                            id: "one",
                            channelId: "one",
                            upstreamModel: "video-model",
                            enabled: true,
                            priority: 1,
                            weight: 250,
                            capabilityProfile: {
                                timeoutMs: 600000,
                                concurrencyLimit: 3,
                                unitCost: 0.25,
                                unitCostCurrency: "USD",
                            },
                        },
                    ],
                },
            ],
            channels,
        );

        expect(models[0].bindings[0]).toMatchObject({
            weight: 250,
            capabilityProfile: { timeoutMs: 600000, concurrencyLimit: 3, unitCost: 0.25, unitCostCurrency: "USD" },
        });
    });

    it("round-trips binding generation parameters without deriving them from the channel", () => {
        const channels = [channel("one", ["image-model"])];
        channels[0].advancedConfig = { supportsReferenceImage: true } as never;
        const generationParameters = {
            referenceInputs: ["image"] as Array<"image">,
            aspectRatios: ["16:9"],
            pixelSizes: ["1024X768"],
            supportsCustomSize: true,
            qualities: [],
            resolutions: [],
            durationMode: "discrete" as const,
            durationSeconds: [5, 10],
            videoReferenceModes: [],
            voices: [],
            formats: [],
        };

        const models = normalizeLogicalModelsConfig(
            [{ id: "image", name: "Image", capability: "image", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "image-model", enabled: true, priority: 1, generationParameters }] }],
            channels,
        );

        expect(models[0].bindings[0]?.generationParameters).toMatchObject({ referenceInputs: ["image"], aspectRatios: ["16:9"], pixelSizes: ["1024x768"], supportsCustomSize: true, durationMode: "discrete", durationSeconds: [5, 10] });
        expect(
            normalizeLogicalModelsConfig([{ id: "image", name: "Image", capability: "image", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "image-model", enabled: true, priority: 1 }] }], channels)[0].bindings[0]
                ?.generationParameters,
        ).toBeUndefined();
    });

    it("retains operational capability defaults without recreating media-generation fields", () => {
        expect(resolveLogicalModelCapabilityProfile({}, "image", { advancedConfig: {} as never })).toEqual({ supportsAsync: true });
    });

    it("reports duplicate bindings and invalid defaults", () => {
        const channels = [channel("one", ["writer"])];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "one", channelId: "one", upstreamModel: "writer", enabled: true, priority: 1 },
                    { id: "two", channelId: "one", upstreamModel: "models/WRITER", enabled: true, priority: 2 },
                ],
            },
        ];
        expect(modelRoutingValidationErrors(models, channels, { textModel: "missing", imageModel: "", videoModel: "", audioModel: "", voiceCloneModel: "" })).toEqual(
            expect.arrayContaining(["逻辑模型 writer 存在重复绑定", "默认文本模型不可解析：missing"]),
        );
    });

    it("reports a physical binding assigned to multiple logical models and a capability mismatch", () => {
        const source = channel("one", ["writer", "image-model"]);
        source.advancedConfig = { modelCapabilities: { writer: "text", "image-model": "image" } } as never;
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "writer", channelId: "one", upstreamModel: "writer", enabled: true, priority: 1 },
                    { id: "wrong-capability", channelId: "one", upstreamModel: "image-model", enabled: true, priority: 2 },
                ],
            },
            {
                id: "duplicate-owner",
                name: "Duplicate",
                capability: "text",
                enabled: true,
                bindings: [{ id: "duplicate", channelId: "one", upstreamModel: "writer", enabled: true, priority: 1 }],
            },
        ];

        expect(modelRoutingValidationErrors(models, [source], { textModel: "writer", imageModel: "", videoModel: "", audioModel: "", voiceCloneModel: "" })).toEqual(
            expect.arrayContaining(["渠道 one 的上游模型 writer 只能绑定一个逻辑模型", "逻辑模型 writer 不能绑定图片模型 image-model"]),
        );
    });

    it("does not reject an administrator capability override based only on its name", () => {
        const channels = [channel("one", ["stable-diffusion-2.0"])];
        const models: LogicalModel[] = [{ id: "stable-diffusion-2.0", name: "自定义视频能力", capability: "video", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "stable-diffusion-2.0", enabled: true, priority: 1 }] }];

        expect(modelRoutingValidationErrors(models, channels, { textModel: "", imageModel: "", videoModel: "stable-diffusion-2.0", audioModel: "", voiceCloneModel: "" })).not.toContain("逻辑模型 stable-diffusion-2.0 更像图片模型，请调整能力类型");
    });
});
