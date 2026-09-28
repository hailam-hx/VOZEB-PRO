import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getFreshAuthSettings: vi.fn(), mutateAuthLogicalModels: vi.fn(), mutateAuthLogicalModelsWithAudit: vi.fn(), runDflopGptImageCapabilityProbe: vi.fn(), runDflopQwenSizeProbe: vi.fn() }));

vi.mock("@/lib/auth/store", () => ({ getFreshAuthSettings: mocks.getFreshAuthSettings, mutateAuthLogicalModels: mocks.mutateAuthLogicalModels, mutateAuthLogicalModelsWithAudit: mocks.mutateAuthLogicalModelsWithAudit }));
vi.mock("./dflop-capability-probe-service", () => ({ runDflopGptImageCapabilityProbe: mocks.runDflopGptImageCapabilityProbe, runDflopQwenSizeProbe: mocks.runDflopQwenSizeProbe }));

import { applySuggestedSalePrices, getAdminModelPricing, probeAdminDflopModelCapability, saveAdminModelPricing } from "./admin-model-pricing-service";
import { DEFAULT_SYSTEM_PRICING_POLICY } from "@/lib/billing/pricing-policy";
import { parseDflopPricing } from "@/lib/dflop-pricing";

const logicalModels = [
    {
        id: "image-pro",
        name: "Image Pro",
        capability: "image" as const,
        enabled: true,
        saleRateCard: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "2" }] },
        bindings: [
            {
                id: "binding-one",
                channelId: "channel-one",
                upstreamModel: "image-pro-v1",
                enabled: true,
                priority: 1,
                costRateCard: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "0.5" }] },
                providerCostUnit: { kind: "fiat" as const, currency: "USD" as const },
            },
        ],
    },
];

const textModel = {
    id: "text-pro",
    name: "Text Pro",
    capability: "text" as const,
    enabled: true,
    bindings: [{ id: "text-binding", channelId: "channel-one", upstreamModel: "text-pro-v1", enabled: true, priority: 1 }],
};

describe("admin model pricing service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getFreshAuthSettings.mockResolvedValue({ logicalModels, systemChannels: [] });
        mocks.mutateAuthLogicalModels.mockImplementation(async (mutator) => ({ logicalModels: mutator(logicalModels), systemChannels: [] }));
        mocks.mutateAuthLogicalModelsWithAudit.mockImplementation(async (mutator) => {
            const planned = mutator(logicalModels);
            return { settings: { logicalModels: planned.models }, result: planned.result };
        });
    });

    it("round-trips exact sale, cost, and versioned provider-unit conversion decimal strings", async () => {
        const saved = await saveAdminModelPricing({
            modelId: "image-pro",
            saleRateCard: { version: 1, revision: "client-forged", components: [{ id: "count", dimension: "count", unitPrice: "2.50000000", per: "1.00" }] },
            bindings: [
                {
                    bindingId: "binding-one",
                    costRateCard: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.125000", per: "1" }] },
                    providerCostUnit: { kind: "provider-native", provider: "vendor-one", unit: "compute-unit", usdConversion: { version: "provider-fx-v7", usdPerUnit: "0.0004000" } },
                },
            ],
        });

        expect(saved.model).toMatchObject({
            id: "image-pro",
            saleRateCard: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2.5", per: "1" }] },
            bindings: [
                {
                    id: "binding-one",
                    costRateCard: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.125", per: "1" }] },
                    providerCostUnit: { kind: "provider-native", provider: "vendor-one", unit: "compute-unit", usdConversion: { version: "provider-fx-v7", usdPerUnit: "0.0004" } },
                },
            ],
        });
        expect(saved.model.saleRateCard?.revision).toBe('rate-card-v1:[{"id":"count","dimension":"count","unitPrice":"2.5","per":"1"}]');
        expect(saved.model.bindings[0]?.costRateCard?.revision).toBe('rate-card-v1:[{"id":"count","dimension":"count","unitPrice":"0.125","per":"1"}]');
        expect(mocks.mutateAuthLogicalModels).toHaveBeenCalledOnce();
        await expect(getAdminModelPricing()).resolves.toMatchObject({
            models: logicalModels,
            pricingPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
            estimatorCoverage: { totalRoutableModels: 1, officialPriceConfigured: 1, exactEstimate: 1, conservativeEstimate: 0, missingOfficialSalePrice: 0 },
        });
    });

    it("rejects a binding cost card without an authoritative provider cost unit", async () => {
        await expect(
            saveAdminModelPricing({
                modelId: "image-pro",
                saleRateCard: logicalModels[0].saleRateCard,
                bindings: [{ bindingId: "binding-one", costRateCard: logicalModels[0].bindings[0].costRateCard, providerCostUnit: null }],
            }),
        ).rejects.toMatchObject({ status: 400, message: "绑定成本价格卡与供应商成本单位必须同时配置" });
        expect(mocks.mutateAuthLogicalModels).toHaveBeenCalledOnce();
    });

    it("rejects a count-based cost card for a text model", async () => {
        mocks.getFreshAuthSettings.mockResolvedValue({ logicalModels: [textModel], systemChannels: [] });
        mocks.mutateAuthLogicalModels.mockImplementation(async (mutator) => ({ logicalModels: mutator([textModel]), systemChannels: [] }));

        await expect(
            saveAdminModelPricing({
                modelId: "text-pro",
                bindings: [
                    {
                        bindingId: "text-binding",
                        costRateCard: { version: 1, components: [{ id: "output-tokens", dimension: "count", unitPrice: "9.099", per: "1000000" }] },
                        providerCostUnit: { kind: "fiat", currency: "USD" },
                    },
                ],
            }),
        ).rejects.toMatchObject({ status: 400, message: "文本能力价格卡不支持维度：count" });
    });

    it("applies one dimension-level manual override without trusting derived client pricing", async () => {
        const profile = parseDflopPricing({ price_per_image: "80", price_per_input_image: "20" }, { modelId: "image-pro-v1", category: "image", syncedAt: "2026-09-24T00:00:00.000Z" });
        const pricedModels = [{ ...logicalModels[0], bindings: [{ ...logicalModels[0].bindings[0], providerPricingProfile: profile }] }];
        mocks.getFreshAuthSettings.mockResolvedValue({
            logicalModels: pricedModels,
            systemChannels: [{ id: "channel-one", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "secret", apiFormat: "openai", models: ["image-pro-v1"], enabled: true }],
            pricingPolicy: DEFAULT_SYSTEM_PRICING_POLICY,
        });
        mocks.mutateAuthLogicalModels.mockImplementation(async (mutator) => ({ logicalModels: mutator(pricedModels) }));

        const saved = await saveAdminModelPricing({ modelId: "image-pro", dimensionCommand: { action: "set_manual", bindingId: "binding-one", dimensionId: "image-output", effectiveValue: "100" } });

        expect(saved.model.bindings[0].providerPricingProfile?.dimensions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "image-output", source: "manual", upstreamValue: "80", effectiveValue: "100", providerCostHotxCredits: "0.25" }),
                expect.objectContaining({ id: "image-input", source: "upstream", upstreamValue: "20" }),
            ]),
        );
        expect(saved.model.bindings[0].costRateCard?.components[0]).toMatchObject({ dimension: "count", unitPrice: "0.25" });
        expect(saved.audit).toEqual({
            action: "admin.billing.provider_price.override",
            metadata: expect.objectContaining({
                modelId: "image-pro",
                bindingId: "binding-one",
                dimensionId: "image-output",
                oldValue: "80",
                newValue: "100",
                oldSource: "upstream",
                newSource: "manual",
                pricingPolicyVersion: DEFAULT_SYSTEM_PRICING_POLICY.version,
            }),
        });

        await expect(saveAdminModelPricing({ modelId: "image-pro", suggestedSaleRateCard: {} } as never)).rejects.toMatchObject({ status: 400 });
    });

    it("rejects server-derived provider pricing fields nested in binding edits", async () => {
        await expect(
            saveAdminModelPricing({
                modelId: "image-pro",
                bindings: [{ bindingId: "binding-one", providerPricingProfile: { raw: { apiKey: "must-not-be-trusted" } } }],
            } as never),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("providerPricingProfile") });
    });

    it("applies a server-owned suggested price and passes its audit through the atomic writer", async () => {
        const suggested = {
            rateCard: { version: 1 as const, revision: "suggested-ready", components: [{ id: "count", dimension: "count" as const, unitPrice: "3" }] },
            pricingPolicyVersion: DEFAULT_SYSTEM_PRICING_POLICY.version,
            calculatedAt: "2026-09-24T09:00:00.000Z",
            costBasis: "max_active_binding_cost" as const,
            markupMultiplier: "1",
            bindingInputs: [{ bindingId: "binding-one", channelId: "channel-one", provider: "dflop", costRateRevision: "cost-ready", pricingStatus: "READY" as const }],
            conversionInputs: [],
        };
        const readyModels = [{ ...logicalModels[0], suggestedSaleRateCard: suggested }];
        mocks.mutateAuthLogicalModelsWithAudit.mockImplementation(async (mutator) => {
            const planned = mutator(readyModels, DEFAULT_SYSTEM_PRICING_POLICY);
            expect(planned.auditLogs).toHaveLength(1);
            return { settings: { logicalModels: planned.models }, result: planned.result };
        });

        const result = await applySuggestedSalePrices(
            { modelIds: ["image-pro"], suggestedRevisions: { "image-pro": "suggested-ready" }, pricingPolicyVersion: DEFAULT_SYSTEM_PRICING_POLICY.version },
            { id: "admin-1", username: "finance", role: "admin" },
            { approvedAt: "2026-09-24T10:00:00.000Z", batchOperationId: "batch-1" },
        );

        expect(result.applied).toEqual([expect.objectContaining({ modelId: "image-pro", newSaleRateCardRevision: "suggested-ready" })]);
        expect(result.models[0]).toMatchObject({ salePriceSource: "approved", saleRateCard: { revision: "suggested-ready" }, salePriceApproval: { approvedBy: "admin-1", batchOperationId: "batch-1" } });
    });

    it("rejects a client-supplied sale rate card in an approval request", async () => {
        await expect(
            applySuggestedSalePrices(
                {
                    modelIds: ["image-pro"],
                    suggestedRevisions: { "image-pro": "suggested-ready" },
                    pricingPolicyVersion: DEFAULT_SYSTEM_PRICING_POLICY.version,
                    saleRateCard: { version: 1, components: [] },
                } as never,
                { id: "admin-1" },
            ),
        ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("saleRateCard") });
    });

    it("persists a server-owned GPT probe without changing the formal sale rate card", async () => {
        const profile = parseDflopPricing({ input_per_1m: "10", output_per_1m: "20", price_per_image: "30", supports_image_gen: true }, { modelId: "gpt-6", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });
        const model = {
            ...textModel,
            id: "gpt-6",
            saleRateCard: { version: 1 as const, components: [{ id: "tokens", dimension: "outputTokens" as const, unitPrice: "1", per: "1000000" }] },
            bindings: [{ ...textModel.bindings[0], id: "binding-gpt", upstreamModel: "gpt-6", providerPricingProfile: profile }],
        };
        const channel = { id: "channel-one", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "secret", apiFormat: "openai" as const, models: ["gpt-6"], enabled: true, advancedConfig: { protocol: "dflop" } };
        const probe = {
            version: 1 as const,
            provider: "dflop" as const,
            modelId: "gpt-6",
            channelId: "channel-one",
            bindingId: "binding-gpt",
            operationScope: "builtin_image_generation" as const,
            endpoint: "/v1/responses",
            outcome: "unsupported" as const,
            supported: false,
            statusCode: 400,
            upstreamErrorCode: "tool_not_supported",
            usageSeen: false,
            imageOutputSeen: false,
            billingEvidence: { basis: "unresolved" as const, authoritative: false, source: "none" as const },
            probedAt: "2026-09-24T01:00:00.000Z",
            registryFingerprint: expect.any(String),
        };
        mocks.getFreshAuthSettings.mockResolvedValue({ logicalModels: [model], systemChannels: [channel], pricingPolicy: DEFAULT_SYSTEM_PRICING_POLICY });
        mocks.runDflopGptImageCapabilityProbe.mockImplementation(async (input) => ({ ...probe, registryFingerprint: input.profile ? (await import("@/lib/billing/provider-capability-probe")).capabilityProbeFingerprint(input.profile) : "" }));
        mocks.mutateAuthLogicalModels.mockImplementation(async (mutator) => ({ logicalModels: mutator([model]), systemChannels: [channel], pricingPolicy: DEFAULT_SYSTEM_PRICING_POLICY }));

        const result = await probeAdminDflopModelCapability({ modelId: "gpt-6", bindingId: "binding-gpt" });

        expect(result.model.saleRateCard).toEqual(model.saleRateCard);
        expect(result.model.bindings[0].providerPricingProfile).toMatchObject({ status: "READY", operationPricingStatus: { builtin_image_generation: { status: "UNSUPPORTED" } } });
        expect(result.model.bindings[0].costRateCard?.components.every((component) => component.operationScope !== "builtin_image_generation")).toBe(true);
    });
});
