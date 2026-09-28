import type { LogicalModel, SalePriceApprovalSnapshot } from "@/lib/auth/store-types";

export type SuggestedSaleApprovalSkipCode = "SKIPPED_NO_SUGGESTION" | "SKIPPED_NO_BINDING_INPUTS" | "SKIPPED_STALE" | "SKIPPED_PARTIAL" | "SKIPPED_NEEDS_REVIEW" | "SKIPPED_REVISION_CHANGED" | "SKIPPED_POLICY_CHANGED";

export type SuggestedSaleApprovalAudit = {
    action: "admin.billing.model_pricing.apply_suggested_sale_price";
    targetId: string;
    targetLabel: string;
    metadata: {
        operation: "APPLY_SUGGESTED_SALE_PRICE";
        logicalModelId: string;
        oldSaleRateCardRevision?: string;
        newSaleRateCardRevision: string;
        suggestedRevision: string;
        pricingPolicyVersion: string;
        calculatedAt: string;
        costBasis: SalePriceApprovalSnapshot["costBasis"];
        markupMultiplier: string;
        approvedBy: string;
        approvedAt: string;
        batchOperationId: string;
    };
};

export function planSuggestedSalePriceApproval(input: {
    models: LogicalModel[];
    modelIds: string[];
    suggestedRevisions: Record<string, string | undefined>;
    pricingPolicyVersion: string;
    currentPricingPolicyVersion?: string;
    approvedBy: string;
    approvedAt: string;
    batchOperationId: string;
}) {
    const requested = new Set(input.modelIds);
    const applied: Array<{ modelId: string; oldSaleRateCardRevision?: string; newSaleRateCardRevision: string }> = [];
    const skipped: Array<{ modelId: string; code: SuggestedSaleApprovalSkipCode; reason: string }> = [];
    const auditLogs: SuggestedSaleApprovalAudit[] = [];
    const models = input.models.map((model) => {
        if (!requested.has(model.id)) return model;
        const suggestion = model.suggestedSaleRateCard;
        const skip = approvalSkip(model, input.suggestedRevisions[model.id], input.pricingPolicyVersion, input.currentPricingPolicyVersion);
        if (skip) {
            skipped.push({ modelId: model.id, ...skip });
            return model;
        }
        const suggestedRevision = suggestion!.rateCard.revision!;
        const approval: SalePriceApprovalSnapshot = {
            suggestedRevision,
            pricingPolicyVersion: suggestion!.pricingPolicyVersion,
            calculatedAt: suggestion!.calculatedAt,
            costBasis: suggestion!.costBasis,
            markupMultiplier: suggestion!.markupMultiplier,
            approvedAt: input.approvedAt,
            approvedBy: input.approvedBy,
            batchOperationId: input.batchOperationId,
        };
        const oldSaleRateCardRevision = model.saleRateCard?.revision;
        applied.push({ modelId: model.id, ...(oldSaleRateCardRevision ? { oldSaleRateCardRevision } : {}), newSaleRateCardRevision: suggestedRevision });
        auditLogs.push({
            action: "admin.billing.model_pricing.apply_suggested_sale_price",
            targetId: model.id,
            targetLabel: model.name,
            metadata: {
                operation: "APPLY_SUGGESTED_SALE_PRICE",
                logicalModelId: model.id,
                ...(oldSaleRateCardRevision ? { oldSaleRateCardRevision } : {}),
                newSaleRateCardRevision: suggestedRevision,
                ...approval,
                batchOperationId: input.batchOperationId,
            },
        });
        return { ...model, saleRateCard: suggestion!.rateCard, salePriceSource: "approved" as const, salePriceApproval: approval };
    });
    for (const modelId of requested) {
        if (!input.models.some((model) => model.id === modelId)) skipped.push({ modelId, code: "SKIPPED_NO_SUGGESTION", reason: "NO_SUGGESTION" });
    }
    return { models, applied, skipped, auditLogs };
}

export function hasApprovedSalePriceDrift(model: LogicalModel) {
    return model.salePriceSource === "approved" && Boolean(model.salePriceApproval && model.suggestedSaleRateCard && model.salePriceApproval.suggestedRevision !== model.suggestedSaleRateCard.rateCard.revision);
}

function approvalSkip(model: LogicalModel, expectedRevision: string | undefined, expectedPolicyVersion: string, currentPricingPolicyVersion?: string): { code: SuggestedSaleApprovalSkipCode; reason: string } | undefined {
    const suggestion = model.suggestedSaleRateCard;
    if (!suggestion) return { code: "SKIPPED_NO_SUGGESTION", reason: "NO_SUGGESTION" };
    if (!suggestion.bindingInputs.length) return { code: "SKIPPED_NO_BINDING_INPUTS", reason: "NO_BINDING_INPUTS" };
    const currentBindingInputs = suggestion.bindingInputs.flatMap((input) => {
        const binding = model.bindings.find((candidate) => candidate.id === input.bindingId);
        return binding?.enabled ? [{ ...input, pricingStatus: binding.providerPricingProfile?.status || input.pricingStatus }] : [];
    });
    if (!model.enabled || currentBindingInputs.length !== suggestion.bindingInputs.length) return { code: "SKIPPED_NO_BINDING_INPUTS", reason: "NO_BINDING_INPUTS" };
    if (currentBindingInputs.some((input) => input.pricingStatus === "STALE")) return { code: "SKIPPED_STALE", reason: "STALE" };
    if (currentBindingInputs.some((input) => input.pricingStatus === "PARTIAL")) return { code: "SKIPPED_PARTIAL", reason: "PARTIAL" };
    if (currentBindingInputs.some((input) => input.pricingStatus === "NEEDS_REVIEW")) return { code: "SKIPPED_NEEDS_REVIEW", reason: "NEEDS_REVIEW" };
    if ((currentPricingPolicyVersion && currentPricingPolicyVersion !== expectedPolicyVersion) || suggestion.pricingPolicyVersion !== expectedPolicyVersion) return { code: "SKIPPED_POLICY_CHANGED", reason: "STALE_PREVIEW" };
    if (suggestion.rateCard.revision !== expectedRevision) return { code: "SKIPPED_REVISION_CHANGED", reason: "REVISION_CHANGED" };
    return undefined;
}
