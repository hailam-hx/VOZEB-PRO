import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store-types";
import { channelConnectionReady } from "@/lib/channel-protocol-registry";
import { normalizeModelId } from "@/lib/model-capability";
import { decimal } from "./decimal";
import { convertProviderCostToUsd } from "./money";
import { validatePricingRateCard, type PricingComponent } from "./pricing";
import type { SuggestedSaleRateCard, SystemPricingPolicy } from "./pricing-policy";

export type ModelPricingWarning = {
    code: "NO_ELIGIBLE_BINDING" | "MISSING_COST" | "INCOMPARABLE_UNIT" | "INCOMPLETE_DIMENSION" | "BELOW_COST" | "MINIMUM_MARGIN";
    message: string;
    bindingId?: string;
    componentId?: string;
    scope?: "formal" | "suggestion";
};

export type SuggestedSalePricingResult = {
    suggestion?: SuggestedSaleRateCard;
    complete: boolean;
    warnings: ModelPricingWarning[];
};

export function calculateSuggestedSaleRateCard(input: { model: LogicalModel; channels: SystemModelChannel[]; policy: SystemPricingPolicy; calculatedAt: string }): SuggestedSalePricingResult {
    const channelById = new Map(input.channels.map((channel) => [channel.id, channel]));
    const eligible = input.model.bindings
        .filter((binding) => {
            const channel = channelById.get(binding.channelId);
            if (!input.model.enabled || !binding.enabled || !channel?.enabled || !channelConnectionReady(channel)) return false;
            const key = normalizeModelId(binding.upstreamModel);
            if (!channel.models.some((model) => normalizeModelId(model) === key)) return false;
            return channel.advancedConfig?.modelDiscovery?.[key]?.routable !== false;
        })
        .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    if (!eligible.length) return { complete: false, warnings: [{ code: "NO_ELIGIBLE_BINDING", message: "当前逻辑模型没有可用于建议定价的启用 binding" }] };

    const warnings: ModelPricingWarning[] = [];
    const priced = eligible.flatMap((binding) => {
        if (!binding.costRateCard || !binding.providerCostUnit) {
            warnings.push({ code: "MISSING_COST", bindingId: binding.id, message: `Binding ${binding.id} 缺少可比较的成本价格卡` });
            return [];
        }
        try {
            const rateCard = validatePricingRateCard(binding.costRateCard);
            const components = rateCard.components.map((component) => ({ ...component, unitPrice: decimal(convertProviderCostToUsd(component.unitPrice, binding.providerCostUnit!)).dividedBy(decimal(input.policy.hotxUsdPerCredit)).toString() }));
            return [{ binding, rateCard, components }];
        } catch {
            warnings.push({ code: "INCOMPARABLE_UNIT", bindingId: binding.id, message: `Binding ${binding.id} 的成本单位无法换算为 HOTX credits` });
            return [];
        }
    });
    if (!priced.length) return { complete: false, warnings };

    const selected = input.policy.costBasis === "primary_binding_cost" ? primaryComponents(priced[0].components) : maximumComponents(priced, eligible.length, warnings);
    if (!selected.length) return { complete: false, warnings };
    const components = selected.map((component, index) => ({ ...component, id: `suggested-${index + 1}`, unitPrice: decimal(component.unitPrice).times(decimal(input.policy.markupMultiplier)).toString() }));
    const rateCard = validatePricingRateCard({ version: 1, components });
    const suggestion: SuggestedSaleRateCard = {
        rateCard,
        pricingPolicyVersion: input.policy.version,
        calculatedAt: input.calculatedAt,
        costBasis: input.policy.costBasis,
        markupMultiplier: input.policy.markupMultiplier,
        bindingInputs: priced.map(({ binding, rateCard }) => ({
            bindingId: binding.id,
            channelId: binding.channelId,
            provider: channelById.get(binding.channelId)?.advancedConfig?.protocol || channelById.get(binding.channelId)?.name || binding.channelId,
            costRateRevision: rateCard.revision,
            pricingStatus: binding.providerPricingProfile?.status || "READY",
        })),
        conversionInputs: priced.flatMap(({ binding }) => (binding.providerPricingProfile?.conversion ? [binding.providerPricingProfile.conversion] : [])),
    };

    compareFormalSalePrice(input.model, selected, warnings);
    validateSuggestedMargin(selected, components, input.policy, warnings);
    const complete = warnings.every((warning) => warning.code !== "MISSING_COST" && warning.code !== "INCOMPARABLE_UNIT" && warning.code !== "INCOMPLETE_DIMENSION");
    return { suggestion, complete, warnings };
}

export function applySuggestedPricingToLogicalModels(models: LogicalModel[], channels: SystemModelChannel[], policy: SystemPricingPolicy, calculatedAt: string) {
    const commercialPolicyConfigured = decimal(policy.markupMultiplier).greaterThan(decimal(1)) || policy.minimumMarginRate !== null;
    return models.map((model) => {
        const result = calculateSuggestedSaleRateCard({ model, channels, policy, calculatedAt });
        const blocksAutoApply = result.warnings.some((warning) => (warning.code === "BELOW_COST" && warning.scope === "suggestion") || warning.code === "MINIMUM_MARGIN");
        return {
            ...model,
            ...(result.suggestion ? { suggestedSaleRateCard: result.suggestion } : { suggestedSaleRateCard: undefined }),
            ...(policy.autoApplySalePrice && commercialPolicyConfigured && result.complete && result.suggestion && !blocksAutoApply && (!model.salePriceSource || model.salePriceSource === "automatic")
                ? { saleRateCard: result.suggestion.rateCard, salePriceSource: "automatic" as const }
                : {}),
        };
    });
}

function maximumComponents(priced: Array<{ components: PricingComponent[] }>, eligibleCount: number, warnings: ModelPricingWarning[]) {
    const grouped = new Map<string, Array<{ component: PricingComponent; bindingIndex: number }>>();
    priced.forEach(({ components }, bindingIndex) => {
        const bestPerBinding = new Map<string, PricingComponent>();
        for (const component of components) {
            const identity = componentIdentity(component);
            const current = bestPerBinding.get(identity);
            if (!current || decimal(component.unitPrice).greaterThan(decimal(current.unitPrice))) bestPerBinding.set(identity, component);
        }
        for (const [identity, component] of bestPerBinding) grouped.set(identity, [...(grouped.get(identity) || []), { component, bindingIndex }]);
    });
    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([identity, values]) => {
            if (new Set(values.map((value) => value.bindingIndex)).size !== eligibleCount) warnings.push({ code: "INCOMPLETE_DIMENSION", componentId: identity, message: `并非所有 eligible binding 都提供价格维度 ${identity}` });
            return values.reduce((maximum, value) => (decimal(value.component.unitPrice).greaterThan(decimal(maximum.unitPrice)) ? value.component : maximum), values[0].component);
        });
}

function primaryComponents(components: PricingComponent[]) {
    return [...components].sort((left, right) => componentIdentity(left).localeCompare(componentIdentity(right)));
}

function compareFormalSalePrice(model: LogicalModel, costs: PricingComponent[], warnings: ModelPricingWarning[]) {
    if (!model.saleRateCard) return;
    let sale;
    try {
        sale = validatePricingRateCard(model.saleRateCard);
    } catch {
        return;
    }
    const sales = new Map(sale.components.map((component) => [componentIdentity(component), component]));
    for (const cost of costs) {
        const saleComponent = sales.get(componentIdentity(cost));
        if (saleComponent && decimal(cost.unitPrice).greaterThan(decimal(saleComponent.unitPrice))) warnings.push({ code: "BELOW_COST", scope: "formal", componentId: cost.id, message: `${cost.id} 的正式售价低于当前最高 eligible binding 成本` });
    }
}

function validateSuggestedMargin(costs: PricingComponent[], suggestions: PricingComponent[], policy: SystemPricingPolicy, warnings: ModelPricingWarning[]) {
    const suggestionByIdentity = new Map(suggestions.map((component) => [componentIdentity(component), component]));
    for (const cost of costs) {
        const suggestion = suggestionByIdentity.get(componentIdentity(cost));
        if (!suggestion) continue;
        if (decimal(cost.unitPrice).greaterThan(decimal(suggestion.unitPrice))) warnings.push({ code: "BELOW_COST", scope: "suggestion", componentId: cost.id, message: `${cost.id} 的建议售价低于成本` });
        if (policy.minimumMarginRate !== null && decimal(cost.unitPrice).greaterThan(decimal(suggestion.unitPrice).times(decimal(1).minus(decimal(policy.minimumMarginRate))))) {
            warnings.push({ code: "MINIMUM_MARGIN", componentId: cost.id, message: `${cost.id} 的建议售价未达到最低毛利率` });
        }
    }
}

function componentIdentity(component: PricingComponent) {
    const when = Object.entries(component.when || {}).sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify([component.dimension, component.basis || "", component.per || "1", component.match || "", when]);
}
