import { describe, expect, it } from "vitest";

import type { LogicalModel } from "@/lib/auth/store-types";
import type { ProviderPricingStatus } from "./provider-pricing";
import { tryRequestCreditCost } from "@/constant/credits";
import { hasApprovedSalePriceDrift, planSuggestedSalePriceApproval } from "./suggested-sale-approval";

const policyVersion = "pricing-policy-v1:test";
const approvedAt = "2026-09-24T10:00:00.000Z";

function pricedModel(id: string, statuses: ProviderPricingStatus[] = ["READY"]): LogicalModel {
    const rateCard = {
        version: 1 as const,
        revision: `rate-card-v1:${id}`,
        components: [{ id: "suggested-1", dimension: "durationSeconds" as const, unitPrice: "0.25", when: { resolution: "720p" } }],
    };
    return {
        id,
        name: id,
        capability: "video",
        enabled: true,
        saleRateCard: { version: 1, revision: `old-${id}`, components: [{ id: "old", dimension: "durationSeconds", unitPrice: "0.2" }] },
        salePriceSource: "manual",
        suggestedSaleRateCard: {
            rateCard,
            pricingPolicyVersion: policyVersion,
            calculatedAt: "2026-09-24T09:00:00.000Z",
            costBasis: "max_active_binding_cost",
            markupMultiplier: "1",
            bindingInputs: statuses.map((pricingStatus, index) => ({ bindingId: `${id}-b${index}`, channelId: "dflop", provider: "dflop", costRateRevision: `cost-${index}`, pricingStatus })),
            conversionInputs: [],
        },
        bindings: statuses.map((status, index) => ({
            id: `${id}-b${index}`,
            channelId: "dflop",
            upstreamModel: id,
            enabled: true,
            priority: index + 1,
            providerPricingProfile: {
                provider: "dflop",
                modelId: id,
                status,
                syncedAt: "2026-09-24T09:00:00.000Z",
                raw: {},
                dimensions: [],
                unknownFields: [],
                missingFields: [],
                warnings: [],
            },
        })),
    };
}

describe("suggested sale price approval", () => {
    it("copies one current READY suggestion and captures the approval and audit snapshots", () => {
        const current = pricedModel("ready");
        const result = planSuggestedSalePriceApproval({
            models: [current],
            modelIds: [current.id],
            suggestedRevisions: { [current.id]: current.suggestedSaleRateCard!.rateCard.revision },
            pricingPolicyVersion: policyVersion,
            approvedBy: "admin-1",
            approvedAt,
            batchOperationId: "batch-1",
        });

        expect(result.applied).toEqual([{ modelId: "ready", oldSaleRateCardRevision: "old-ready", newSaleRateCardRevision: "rate-card-v1:ready" }]);
        expect(result.skipped).toEqual([]);
        expect(result.models[0]).toMatchObject({
            saleRateCard: current.suggestedSaleRateCard!.rateCard,
            salePriceSource: "approved",
            salePriceApproval: {
                suggestedRevision: "rate-card-v1:ready",
                pricingPolicyVersion: policyVersion,
                calculatedAt: "2026-09-24T09:00:00.000Z",
                costBasis: "max_active_binding_cost",
                markupMultiplier: "1",
                approvedAt,
                approvedBy: "admin-1",
                batchOperationId: "batch-1",
            },
        });
        expect(result.auditLogs).toEqual([
            expect.objectContaining({
                action: "admin.billing.model_pricing.apply_suggested_sale_price",
                targetId: "ready",
                metadata: expect.objectContaining({ operation: "APPLY_SUGGESTED_SALE_PRICE", logicalModelId: "ready", oldSaleRateCardRevision: "old-ready", newSaleRateCardRevision: "rate-card-v1:ready", approvedBy: "admin-1" }),
            }),
        ]);
        expect(
            tryRequestCreditCost({
                apiSource: "system",
                logicalModels: result.models,
                model: "ready",
                kind: "video",
                quality: "720",
                videoQuality: "720",
                videoSeconds: 5,
            }),
        ).toBe("1.25");
    });

    it("applies READY models and reports every non-ready business status without blocking the batch", () => {
        const models = [
            pricedModel("ready"),
            pricedModel("stale", ["STALE"]),
            pricedModel("partial", ["READY", "PARTIAL"]),
            pricedModel("review", ["NEEDS_REVIEW"]),
            { ...pricedModel("none"), suggestedSaleRateCard: undefined },
            { ...pricedModel("empty"), suggestedSaleRateCard: { ...pricedModel("empty").suggestedSaleRateCard!, bindingInputs: [] } },
        ];
        const result = planSuggestedSalePriceApproval({
            models,
            modelIds: models.map((model) => model.id),
            suggestedRevisions: Object.fromEntries(models.flatMap((model) => (model.suggestedSaleRateCard ? [[model.id, model.suggestedSaleRateCard.rateCard.revision]] : []))),
            pricingPolicyVersion: policyVersion,
            approvedBy: "admin-1",
            approvedAt,
            batchOperationId: "batch-2",
        });

        expect(result.applied.map((item) => item.modelId)).toEqual(["ready"]);
        expect(result.skipped).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ modelId: "stale", code: "SKIPPED_STALE" }),
                expect.objectContaining({ modelId: "partial", code: "SKIPPED_PARTIAL" }),
                expect.objectContaining({ modelId: "review", code: "SKIPPED_NEEDS_REVIEW" }),
                expect.objectContaining({ modelId: "none", code: "SKIPPED_NO_SUGGESTION" }),
                expect.objectContaining({ modelId: "empty", code: "SKIPPED_NO_BINDING_INPUTS" }),
            ]),
        );
    });

    it("skips stale previews when the policy or suggested revision changed", () => {
        const policyChanged = pricedModel("policy-changed");
        const revisionChanged = pricedModel("revision-changed");
        const result = planSuggestedSalePriceApproval({
            models: [policyChanged, revisionChanged],
            modelIds: [policyChanged.id, revisionChanged.id],
            suggestedRevisions: { [policyChanged.id]: policyChanged.suggestedSaleRateCard!.rateCard.revision, [revisionChanged.id]: "older-revision" },
            pricingPolicyVersion: "older-policy",
            approvedBy: "admin-1",
            approvedAt,
            batchOperationId: "batch-3",
        });

        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([
            { modelId: "policy-changed", code: "SKIPPED_POLICY_CHANGED", reason: "STALE_PREVIEW" },
            { modelId: "revision-changed", code: "SKIPPED_POLICY_CHANGED", reason: "STALE_PREVIEW" },
        ]);

        const revisionOnly = planSuggestedSalePriceApproval({
            models: [revisionChanged],
            modelIds: [revisionChanged.id],
            suggestedRevisions: { [revisionChanged.id]: "older-revision" },
            pricingPolicyVersion: policyVersion,
            approvedBy: "admin-1",
            approvedAt,
            batchOperationId: "batch-4",
        });
        expect(revisionOnly.skipped).toEqual([{ modelId: "revision-changed", code: "SKIPPED_REVISION_CHANGED", reason: "REVISION_CHANGED" }]);
    });

    it("skips the preview when the current system pricing policy changed before suggestions were recalculated", () => {
        const current = pricedModel("policy-race");
        const result = planSuggestedSalePriceApproval({
            models: [current],
            modelIds: [current.id],
            suggestedRevisions: { [current.id]: current.suggestedSaleRateCard!.rateCard.revision },
            pricingPolicyVersion: policyVersion,
            currentPricingPolicyVersion: "pricing-policy-v1:new-current-policy",
            approvedBy: "admin-1",
            approvedAt,
            batchOperationId: "batch-policy-race",
        } as Parameters<typeof planSuggestedSalePriceApproval>[0] & { currentPricingPolicyVersion: string });

        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([{ modelId: "policy-race", code: "SKIPPED_POLICY_CHANGED", reason: "STALE_PREVIEW" }]);
    });

    it("uses the current binding pricing status instead of the older suggestion snapshot", () => {
        const current = pricedModel("binding-race");
        current.bindings[0].providerPricingProfile = { ...current.bindings[0].providerPricingProfile!, status: "STALE" };
        const result = planSuggestedSalePriceApproval({
            models: [current],
            modelIds: [current.id],
            suggestedRevisions: { [current.id]: current.suggestedSaleRateCard!.rateCard.revision },
            pricingPolicyVersion: policyVersion,
            currentPricingPolicyVersion: policyVersion,
            approvedBy: "admin-1",
            approvedAt,
            batchOperationId: "batch-binding-race",
        });

        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([{ modelId: "binding-race", code: "SKIPPED_STALE", reason: "STALE" }]);
    });

    it("detects drift against the immutable approval snapshot", () => {
        const approved = pricedModel("approved");
        approved.salePriceSource = "approved";
        approved.salePriceApproval = {
            suggestedRevision: approved.suggestedSaleRateCard!.rateCard.revision!,
            pricingPolicyVersion: policyVersion,
            calculatedAt: approved.suggestedSaleRateCard!.calculatedAt,
            costBasis: "max_active_binding_cost",
            markupMultiplier: "1",
            approvedAt,
            approvedBy: "admin-1",
        };
        expect(hasApprovedSalePriceDrift(approved)).toBe(false);
        approved.suggestedSaleRateCard = { ...approved.suggestedSaleRateCard!, rateCard: { ...approved.suggestedSaleRateCard!.rateCard, revision: "new-suggestion" } };
        expect(hasApprovedSalePriceDrift(approved)).toBe(true);
    });
});
