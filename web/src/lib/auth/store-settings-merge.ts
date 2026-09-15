import type { LogicalModel } from "./store-types";
import { normalizeModelId } from "@/lib/model-capability";

export function preserveLogicalModelPricing(current: LogicalModel[], incoming: LogicalModel[]) {
    const currentModels = new Map(current.map((model) => [model.id, model]));
    const currentBindings = new Map(current.flatMap((model) => model.bindings.map((binding) => [bindingKey(binding), binding] as const)));
    return incoming.map((model) => {
        const currentModel = currentModels.get(model.id);
        return {
            ...model,
            saleRateCard: currentModel?.saleRateCard,
            bindings: model.bindings.map((binding) => {
                const currentBinding = currentBindings.get(bindingKey(binding));
                return currentBinding ? { ...binding, costRateCard: currentBinding.costRateCard, providerCostUnit: currentBinding.providerCostUnit } : withoutBindingPricing(binding);
            }),
        };
    });
}

function bindingKey(binding: LogicalModel["bindings"][number]) {
    return JSON.stringify([binding.channelId, normalizeModelId(binding.upstreamModel)]);
}

function withoutBindingPricing<T extends LogicalModel["bindings"][number]>(binding: T) {
    return { ...binding, costRateCard: undefined, providerCostUnit: undefined };
}
