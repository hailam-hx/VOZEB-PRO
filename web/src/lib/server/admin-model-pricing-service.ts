import { getFreshAuthSettings, setAuthSettings, type LogicalModel, type LogicalModelBinding } from "@/lib/auth/store";
import { validateProviderCostUnit, type ProviderCostUnit } from "@/lib/billing/money";
import { validatePricingRateCard, type PricingRateCardV1 } from "@/lib/billing/pricing";
import { BillingInputError } from "@/lib/server/billing-errors";

type BindingPricingInput = { bindingId: string; costRateCard?: PricingRateCardV1 | null; providerCostUnit?: ProviderCostUnit | null };
export type AdminModelPricingInput = { modelId: string; saleRateCard?: PricingRateCardV1 | null; bindings?: BindingPricingInput[] };

export async function getAdminModelPricing() {
    const settings = await getFreshAuthSettings();
    return { models: settings.logicalModels.map(presentModel) };
}

export async function saveAdminModelPricing(input: AdminModelPricingInput) {
    const settings = await getFreshAuthSettings();
    const model = settings.logicalModels.find((item) => item.id === input.modelId);
    if (!model) throw new BillingInputError("逻辑模型不存在", 404);
    try {
        const saleRateCard = input.saleRateCard === undefined ? model.saleRateCard : input.saleRateCard === null ? undefined : validatePricingRateCard(input.saleRateCard);
        const updates = new Map((input.bindings || []).map((binding) => [binding.bindingId, binding]));
        if (updates.size !== (input.bindings || []).length) throw new BillingInputError("绑定计价配置重复");
        for (const bindingId of updates.keys()) if (!model.bindings.some((binding) => binding.id === bindingId)) throw new BillingInputError("模型绑定不存在", 404);
        const bindings = model.bindings.map((binding) => applyBindingPricing(binding, updates.get(binding.id)));
        const logicalModels = settings.logicalModels.map((item) => (item.id === model.id ? { ...item, ...(saleRateCard ? { saleRateCard } : { saleRateCard: undefined }), bindings } : item));
        const saved = await setAuthSettings({ logicalModels });
        const savedModel = saved.logicalModels.find((item) => item.id === model.id);
        if (!savedModel) throw new BillingInputError("逻辑模型保存失败", 409);
        return { model: presentModel(savedModel) };
    } catch (error) {
        if (error instanceof BillingInputError) throw error;
        throw new BillingInputError(error instanceof Error ? error.message : "模型计价配置无效");
    }
}

function applyBindingPricing(binding: LogicalModelBinding, input?: BindingPricingInput): LogicalModelBinding {
    if (!input) return binding;
    const costRateCard = input.costRateCard === undefined ? binding.costRateCard : input.costRateCard === null ? undefined : validatePricingRateCard(input.costRateCard);
    const providerCostUnit = input.providerCostUnit === undefined ? binding.providerCostUnit : input.providerCostUnit === null ? undefined : validateProviderCostUnit(input.providerCostUnit);
    if (Boolean(costRateCard) !== Boolean(providerCostUnit)) throw new BillingInputError("绑定成本价格卡与供应商成本单位必须同时配置");
    return { ...binding, ...(costRateCard ? { costRateCard } : { costRateCard: undefined }), ...(providerCostUnit ? { providerCostUnit } : { providerCostUnit: undefined }) };
}

function presentModel(model: LogicalModel): LogicalModel {
    return {
        id: model.id,
        name: model.name,
        capability: model.capability,
        enabled: model.enabled,
        ...(model.saleRateCard ? { saleRateCard: model.saleRateCard } : {}),
        bindings: model.bindings.map((binding) => ({
            id: binding.id,
            channelId: binding.channelId,
            upstreamModel: binding.upstreamModel,
            enabled: binding.enabled,
            priority: binding.priority,
            ...(binding.costRateCard ? { costRateCard: binding.costRateCard } : {}),
            ...(binding.providerCostUnit ? { providerCostUnit: binding.providerCostUnit } : {}),
        })),
    };
}
