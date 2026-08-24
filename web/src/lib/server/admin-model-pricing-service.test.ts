import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getFreshAuthSettings: vi.fn(), setAuthSettings: vi.fn() }));

vi.mock("@/lib/auth/store", () => ({ getFreshAuthSettings: mocks.getFreshAuthSettings, setAuthSettings: mocks.setAuthSettings }));

import { getAdminModelPricing, saveAdminModelPricing } from "./admin-model-pricing-service";

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

describe("admin model pricing service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getFreshAuthSettings.mockResolvedValue({ logicalModels, systemChannels: [] });
        mocks.setAuthSettings.mockImplementation(async (patch) => ({ logicalModels: patch.logicalModels, systemChannels: [] }));
    });

    it("round-trips exact sale, cost, and versioned provider-unit conversion decimal strings", async () => {
        const saved = await saveAdminModelPricing({
            modelId: "image-pro",
            saleRateCard: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2.50000000", per: "1.00" }] },
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
        expect(mocks.setAuthSettings).toHaveBeenCalledWith({ logicalModels: [expect.objectContaining({ id: "image-pro", capability: "image", enabled: true })] });
        await expect(getAdminModelPricing()).resolves.toEqual({ models: logicalModels });
    });

    it("rejects a binding cost card without an authoritative provider cost unit", async () => {
        await expect(
            saveAdminModelPricing({
                modelId: "image-pro",
                saleRateCard: logicalModels[0].saleRateCard,
                bindings: [{ bindingId: "binding-one", costRateCard: logicalModels[0].bindings[0].costRateCard, providerCostUnit: null }],
            }),
        ).rejects.toMatchObject({ status: 400, message: "绑定成本价格卡与供应商成本单位必须同时配置" });
        expect(mocks.setAuthSettings).not.toHaveBeenCalled();
    });
});
