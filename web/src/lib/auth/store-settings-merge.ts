import type { LogicalModel } from "./store-types";

export function preserveLogicalModelPricing(current: LogicalModel[], incoming: LogicalModel[]) {
    const currentModels = new Map(current.map((model) => [model.id, model]));
    return incoming.map((model) => {
        const currentModel = currentModels.get(model.id);
        if (!currentModel) return { ...model, saleRateCard: undefined, bindings: model.bindings.map(withoutBindingPricing) };
        const currentBindings = new Map(currentModel.bindings.map((binding) => [binding.id, binding]));
        return {
            ...model,
            saleRateCard: currentModel.saleRateCard,
            bindings: model.bindings.map((binding) => {
                const currentBinding = currentBindings.get(binding.id);
                return currentBinding ? { ...binding, costRateCard: currentBinding.costRateCard, providerCostUnit: currentBinding.providerCostUnit } : binding;
            }),
        };
    });
}

function withoutBindingPricing<T extends LogicalModel["bindings"][number]>(binding: T) {
    return { ...binding, costRateCard: undefined, providerCostUnit: undefined };
}
