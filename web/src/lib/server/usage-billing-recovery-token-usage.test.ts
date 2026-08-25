import { beforeEach, describe, expect, it, vi } from "vitest";

import { calculatePricingReserve, normalizeBillableUsage, validatePricingRateCard } from "@/lib/billing/pricing";
import type { UsageBillingHoldSnapshot, WalletHold } from "@/lib/auth/store-types";

vi.mock("./text-task-store", () => ({
    getTextTask: vi.fn(async () => ({ id: "text-task-one", status: "success", result: { content: "provider response without token usage" } })),
}));

const mocks = vi.hoisted(() => ({ listProviderUsageAttemptsForHold: vi.fn() }));

vi.mock("./points-wallet-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./points-wallet-service")>()),
    listProviderUsageAttemptsForHold: mocks.listProviderUsageAttemptsForHold,
}));

import { finalChargeFromSnapshot, inspectPersistedUsageHold } from "./usage-billing-runtime";

describe("text usage recovery", () => {
    beforeEach(() => mocks.listProviderUsageAttemptsForHold.mockReset().mockResolvedValue([]));

    it("falls back to the estimated reserve when persisted success has no trusted token usage", async () => {
        const saleRateSnapshot = validatePricingRateCard({
            version: 1,
            components: [
                { id: "input", dimension: "inputTokens", unitPrice: "0.001" },
                { id: "output", dimension: "outputTokens", unitPrice: "0.002" },
            ],
        });
        const requestUsage = normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "10", maxOutputTokens: "20" });
        const reserve = calculatePricingReserve({ rateCard: saleRateSnapshot, usage: requestUsage });
        const snapshot: UsageBillingHoldSnapshot = {
            version: 1,
            businessId: "text-task-one",
            originalRequestFingerprint: "a".repeat(64),
            logicalModelId: "text-model",
            capability: "text",
            saleRateSnapshot,
            requestUsage,
            reserve,
            reservedCredits: reserve.credits,
            recovery: { taskType: "text", taskId: "text-task-one" },
        };
        const hold = { id: "hold-one", description: "text task", runtimeSnapshot: snapshot } as WalletHold;

        const evidence = await inspectPersistedUsageHold(hold);

        expect(evidence).toMatchObject({ state: "succeeded", derivedUsage: undefined });
        if (evidence.state !== "succeeded") throw new Error("expected successful recovery evidence");
        expect(finalChargeFromSnapshot(snapshot, evidence.actualUsage, evidence.derivedUsage)).toMatchObject({ credits: reserve.credits, estimated: true, usage: { source: "reserve" } });
    });

    it("uses trusted actual token usage persisted on the provider attempt", async () => {
        const saleRateSnapshot = validatePricingRateCard({
            version: 1,
            components: [
                { id: "input", dimension: "inputTokens", unitPrice: "0.001" },
                { id: "output", dimension: "outputTokens", unitPrice: "0.002" },
            ],
        });
        const requestUsage = normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "10", maxOutputTokens: "20" });
        const reserve = calculatePricingReserve({ rateCard: saleRateSnapshot, usage: requestUsage });
        const snapshot: UsageBillingHoldSnapshot = {
            version: 1,
            businessId: "text-task-one",
            originalRequestFingerprint: "a".repeat(64),
            logicalModelId: "text-model",
            capability: "text",
            saleRateSnapshot,
            requestUsage,
            reserve,
            reservedCredits: reserve.credits,
            recovery: { taskType: "text", taskId: "text-task-one" },
        };
        mocks.listProviderUsageAttemptsForHold.mockResolvedValue([
            {
                status: "pending",
                observedUsage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "7", outputTokens: "3" }),
            },
        ]);
        const hold = { id: "hold-one", description: "text task", runtimeSnapshot: snapshot } as WalletHold;

        const evidence = await inspectPersistedUsageHold(hold);

        expect(evidence).toMatchObject({ state: "succeeded", actualUsage: { source: "actual", inputTokens: "7", outputTokens: "3" } });
        if (evidence.state !== "succeeded") throw new Error("expected successful recovery evidence");
        expect(finalChargeFromSnapshot(snapshot, evidence.actualUsage, evidence.derivedUsage)).toMatchObject({ credits: "0.013", estimated: false, usage: { source: "actual" } });
    });
});
