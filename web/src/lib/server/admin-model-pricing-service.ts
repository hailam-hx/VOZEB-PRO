import { randomUUID } from "node:crypto";

import { getFreshAuthSettings, mutateAuthLogicalModels, mutateAuthLogicalModelsWithAudit, type LogicalModel, type LogicalModelBinding, type SystemModelChannel } from "@/lib/auth/store";
import { validateProviderCostUnit, type ProviderCostUnit } from "@/lib/billing/money";
import { validatePricingRateCardForCapability, type BillableCapability, type PricingRateCardInputV1 } from "@/lib/billing/pricing";
import { BillingInputError } from "@/lib/server/billing-errors";
import { decimal } from "@/lib/billing/decimal";
import { calculateModelEstimatorCoverage } from "@/lib/billing/creative-sale-estimator";
import { applyProviderPricingConversion, providerPricingCostUnit, providerPricingProfileToCostRateCard, restoreProviderPricingDimension } from "@/lib/billing/provider-pricing";
import { applyCapabilityProbeToPricingProfile, capabilityProbeFingerprint } from "@/lib/billing/provider-capability-probe";
import { normalizeSystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { applySuggestedPricingToLogicalModels } from "@/lib/billing/suggested-model-pricing";
import { planSuggestedSalePriceApproval } from "@/lib/billing/suggested-sale-approval";
import { runDflopGptImageCapabilityProbe, runDflopQwenSizeProbe } from "./dflop-capability-probe-service";

type BindingPricingInput = { bindingId: string; costRateCard?: PricingRateCardInputV1 | null; providerCostUnit?: ProviderCostUnit | null };
export type AdminModelPricingInput = { modelId: string; saleRateCard?: PricingRateCardInputV1 | null; bindings?: BindingPricingInput[] };
export type ProviderDimensionCommand = { action: "set_manual"; bindingId: string; dimensionId: string; effectiveValue: string } | { action: "restore_upstream"; bindingId: string; dimensionId: string };
export type AdminModelPricingCommandInput = AdminModelPricingInput & { dimensionCommand?: ProviderDimensionCommand };
export type ApplySuggestedSalePricesInput = { modelIds: string[]; suggestedRevisions: Record<string, string | undefined>; pricingPolicyVersion: string };
export type SuggestedSaleApprovalActor = { id: string; username?: string; role?: "admin" | "user"; ip?: string; userAgent?: string };
export type AdminDflopCapabilityProbeInput = { modelId: string; bindingId: string };
export type AdminModelPricingAudit = {
    action: "admin.billing.provider_price.override" | "admin.billing.provider_price.restore";
    metadata: {
        modelId: string;
        bindingId: string;
        dimensionId: string;
        oldValue: string;
        newValue: string;
        oldSource: "upstream" | "manual";
        newSource: "upstream" | "manual";
        pricingPolicyVersion: string;
        warningCodes: string[];
    };
};

export async function getAdminModelPricing() {
    const settings = await getFreshAuthSettings();
    return { models: settings.logicalModels.map(presentModel), pricingPolicy: normalizeSystemPricingPolicy(settings.pricingPolicy), estimatorCoverage: calculateModelEstimatorCoverage(settings.logicalModels) };
}

export async function probeAdminDflopModelCapability(input: AdminDflopCapabilityProbeInput) {
    if (!input || typeof input.modelId !== "string" || typeof input.bindingId !== "string" || !input.modelId.trim() || !input.bindingId.trim()) throw new BillingInputError("能力验证目标无效");
    const settings = await getFreshAuthSettings();
    const target = capabilityProbeTarget(settings.logicalModels, settings.systemChannels || [], input);
    const probeInput = { channel: target.channel, bindingId: target.binding.id, modelId: target.binding.upstreamModel, profile: target.profile };
    const probe = target.binding.upstreamModel.toLowerCase() === "qwen-image-3.0-pro" ? await runDflopQwenSizeProbe(probeInput) : await runDflopGptImageCapabilityProbe(probeInput);
    const current = await getFreshAuthSettings();
    const currentTarget = capabilityProbeTarget(current.logicalModels, current.systemChannels || [], input);
    if (currentTarget.channel.baseUrl !== target.channel.baseUrl || capabilityProbeFingerprint(currentTarget.profile) !== probe.registryFingerprint) throw new BillingInputError("验证期间渠道或 registry contract 已变化，请重新验证", 409);
    const policy = normalizeSystemPricingPolicy(current.pricingPolicy);
    const saved = await mutateAuthLogicalModels((models) => {
        const latest = capabilityProbeTarget(models, current.systemChannels || [], input);
        if (capabilityProbeFingerprint(latest.profile) !== probe.registryFingerprint || latest.channel.baseUrl !== target.channel.baseUrl) throw new BillingInputError("验证结果 revision 已变化，请重新验证", 409);
        const converted = applyProviderPricingConversion(applyCapabilityProbeToPricingProfile(latest.profile, probe), policy, probe.probedAt);
        const costRateCard = providerPricingProfileToCostRateCard(converted);
        const updated = models.map((model) =>
            model.id !== latest.model.id
                ? model
                : {
                      ...model,
                      bindings: model.bindings.map((binding) =>
                          binding.id !== latest.binding.id
                              ? binding
                              : {
                                    ...binding,
                                    providerPricingProfile: converted,
                                    ...(costRateCard ? { costRateCard, providerCostUnit: providerPricingCostUnit(policy) } : { costRateCard: undefined, providerCostUnit: undefined }),
                                },
                      ),
                  },
        );
        return applySuggestedPricingToLogicalModels(updated, current.systemChannels || [], policy, probe.probedAt);
    });
    const model = saved.logicalModels.find((item) => item.id === input.modelId);
    if (!model) throw new BillingInputError("能力验证结果保存失败", 409);
    return { model: presentModel(model), probe };
}

function capabilityProbeTarget(models: LogicalModel[], channels: SystemModelChannel[], input: AdminDflopCapabilityProbeInput) {
    const model = models.find((item) => item.id === input.modelId);
    if (!model) throw new BillingInputError("逻辑模型不存在", 404);
    const binding = model.bindings.find((item) => item.id === input.bindingId);
    if (!binding) throw new BillingInputError("模型绑定不存在", 404);
    const channel = channels.find((item) => item.id === binding.channelId);
    if (!channel || channel.advancedConfig?.protocol !== "dflop" || !channel.enabled || !channel.apiKey) throw new BillingInputError("DFLOP 渠道不可用于能力验证", 409);
    const upstream = binding.upstreamModel.trim().toLowerCase();
    if (!["gpt-6", "gpt-6-astra", "qwen-image-3.0-pro"].includes(upstream)) throw new BillingInputError("该模型不在本轮受控能力验证范围内");
    const profile = binding.providerPricingProfile;
    if (!profile) throw new BillingInputError("模型绑定没有上游价格档案", 404);
    return { model, binding, channel, profile };
}

export async function saveAdminModelPricing(input: AdminModelPricingCommandInput) {
    try {
        validateInputShape(input);
        const currentSettings = await getFreshAuthSettings();
        const policy = normalizeSystemPricingPolicy(currentSettings.pricingPolicy);
        const saved = await mutateAuthLogicalModels((logicalModels) => {
            const model = logicalModels.find((item) => item.id === input.modelId);
            if (!model) throw new BillingInputError("逻辑模型不存在", 404);
            const saleRateCardInput = input.saleRateCard === undefined ? model.saleRateCard : input.saleRateCard === null ? undefined : input.saleRateCard;
            const saleRateCard = saleRateCardInput ? validatePricingRateCardForCapability(saleRateCardInput, model.capability) : undefined;
            const updates = new Map((input.bindings || []).map((binding) => [binding.bindingId, binding]));
            if (updates.size !== (input.bindings || []).length) throw new BillingInputError("绑定计价配置重复");
            for (const bindingId of updates.keys()) if (!model.bindings.some((binding) => binding.id === bindingId)) throw new BillingInputError("模型绑定不存在", 404);
            let bindings = model.bindings.map((binding) => applyBindingPricing(binding, updates.get(binding.id), model.capability));
            if (input.dimensionCommand) bindings = applyDimensionCommand(bindings, input.dimensionCommand, policy);
            const nextModel = {
                ...model,
                ...(input.saleRateCard !== undefined ? (saleRateCard ? { saleRateCard, salePriceSource: "manual" as const, salePriceApproval: undefined } : { saleRateCard: undefined, salePriceSource: undefined, salePriceApproval: undefined }) : {}),
                bindings,
            };
            const recalculated = applySuggestedPricingToLogicalModels([nextModel], currentSettings.systemChannels || [], policy, new Date().toISOString())[0];
            return logicalModels.map((item) => (item.id === model.id ? recalculated : item));
        });
        const savedModel = saved.logicalModels.find((item) => item.id === input.modelId);
        if (!savedModel) throw new BillingInputError("逻辑模型保存失败", 409);
        return { model: presentModel(savedModel), ...(input.dimensionCommand ? { audit: dimensionAudit(currentSettings.logicalModels, savedModel, input.dimensionCommand, policy.version) } : {}) };
    } catch (error) {
        if (error instanceof BillingInputError) throw error;
        throw new BillingInputError(error instanceof Error ? error.message : "模型计价配置无效");
    }
}

export async function applySuggestedSalePrices(input: ApplySuggestedSalePricesInput, actor: SuggestedSaleApprovalActor, clock: { approvedAt?: string; batchOperationId?: string } = {}) {
    validateSuggestedSaleApprovalInput(input);
    const approvedAt = clock.approvedAt || new Date().toISOString();
    const batchOperationId = clock.batchOperationId || randomUUID();
    const transaction = await mutateAuthLogicalModelsWithAudit((models, pricingPolicy) => {
        const planned = planSuggestedSalePriceApproval({ ...input, models, currentPricingPolicyVersion: pricingPolicy.version, approvedBy: actor.id, approvedAt, batchOperationId });
        return {
            models: planned.models,
            auditLogs: planned.auditLogs.map((audit) => ({
                id: randomUUID(),
                action: audit.action,
                status: "success" as const,
                actorUserId: actor.id,
                ...(actor.username ? { actorUsername: actor.username } : {}),
                ...(actor.role ? { actorRole: actor.role } : {}),
                ...(actor.ip ? { actorIp: actor.ip } : {}),
                ...(actor.userAgent ? { actorUserAgent: actor.userAgent } : {}),
                targetType: "logical_model",
                targetId: audit.targetId,
                targetLabel: audit.targetLabel,
                metadata: audit.metadata,
                createdAt: approvedAt,
            })),
            result: { applied: planned.applied, skipped: planned.skipped, batchOperationId },
        };
    });
    return { ...transaction.result, models: transaction.settings.logicalModels.filter((model) => input.modelIds.includes(model.id)).map(presentModel) };
}

function validateSuggestedSaleApprovalInput(input: ApplySuggestedSalePricesInput) {
    const forbidden = Object.keys(input as Record<string, unknown>).find((key) => !["modelIds", "suggestedRevisions", "pricingPolicyVersion"].includes(key));
    if (forbidden) throw new BillingInputError(`字段 ${forbidden} 不允许由客户端提交`);
    if (!Array.isArray(input.modelIds) || !input.modelIds.length || input.modelIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(input.modelIds).size !== input.modelIds.length) throw new BillingInputError("待审批逻辑模型无效");
    if (!input.suggestedRevisions || typeof input.suggestedRevisions !== "object" || Array.isArray(input.suggestedRevisions)) throw new BillingInputError("建议售价 revision 无效");
    if (typeof input.pricingPolicyVersion !== "string" || !input.pricingPolicyVersion.trim()) throw new BillingInputError("定价策略版本无效");
    if (Object.entries(input.suggestedRevisions).some(([id, revision]) => !input.modelIds.includes(id) || typeof revision !== "string" || !revision.trim())) throw new BillingInputError("建议售价 revision 无效");
}

function applyBindingPricing(binding: LogicalModelBinding, input: BindingPricingInput | undefined, capability: BillableCapability): LogicalModelBinding {
    if (!input) return binding;
    const costRateCardInput = input.costRateCard === undefined ? binding.costRateCard : input.costRateCard === null ? undefined : input.costRateCard;
    const costRateCard = costRateCardInput ? validatePricingRateCardForCapability(costRateCardInput, capability) : undefined;
    const providerCostUnit = input.providerCostUnit === undefined ? binding.providerCostUnit : input.providerCostUnit === null ? undefined : validateProviderCostUnit(input.providerCostUnit);
    if (Boolean(costRateCard) !== Boolean(providerCostUnit)) throw new BillingInputError("绑定成本价格卡与供应商成本单位必须同时配置");
    return { ...binding, ...(costRateCard ? { costRateCard } : { costRateCard: undefined }), ...(providerCostUnit ? { providerCostUnit } : { providerCostUnit: undefined }) };
}

function applyDimensionCommand(bindings: LogicalModelBinding[], command: ProviderDimensionCommand, policy: ReturnType<typeof normalizeSystemPricingPolicy>) {
    if (!bindings.some((binding) => binding.id === command.bindingId)) throw new BillingInputError("模型绑定不存在", 404);
    return bindings.map((binding) => {
        if (binding.id !== command.bindingId) return binding;
        const profile = binding.providerPricingProfile;
        if (!profile) throw new BillingInputError("模型绑定没有上游价格档案", 404);
        const target = profile.dimensions.find((dimension) => dimension.id === command.dimensionId);
        if (!target) throw new BillingInputError("价格维度不存在", 404);
        let nextProfile = profile;
        if (command.action === "restore_upstream") {
            if (target.upstreamValue === undefined) throw new BillingInputError("该价格维度没有可恢复的上游值");
            nextProfile = restoreProviderPricingDimension(profile, command.dimensionId);
        } else {
            const value = decimal(command.effectiveValue, "人工成本价格");
            if (value.isNegative()) throw new BillingInputError("人工成本价格不能为负数");
            nextProfile = {
                ...profile,
                dimensions: profile.dimensions.map((dimension) => (dimension.id === command.dimensionId ? { ...dimension, source: "manual" as const, effectiveValue: value.toString(), providerCostHotxCredits: undefined } : dimension)),
                conversion: undefined,
            };
        }
        nextProfile = applyProviderPricingConversion(nextProfile, policy, new Date().toISOString());
        const costRateCard = providerPricingProfileToCostRateCard(nextProfile);
        return { ...binding, providerPricingProfile: nextProfile, ...(costRateCard ? { costRateCard, providerCostUnit: providerPricingCostUnit(policy) } : { costRateCard: undefined, providerCostUnit: undefined }) };
    });
}

function validateInputShape(input: AdminModelPricingCommandInput) {
    const forbidden = Object.keys(input as Record<string, unknown>).find((key) => !["modelId", "saleRateCard", "bindings", "dimensionCommand"].includes(key));
    if (forbidden) throw new BillingInputError(`字段 ${forbidden} 不允许由客户端提交`);
    if (input.bindings !== undefined) {
        if (!Array.isArray(input.bindings)) throw new BillingInputError("绑定计价配置无效");
        for (const binding of input.bindings as Array<Record<string, unknown>>) {
            if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new BillingInputError("绑定计价配置无效");
            const invalidBindingField = Object.keys(binding).find((key) => !["bindingId", "costRateCard", "providerCostUnit"].includes(key));
            if (invalidBindingField) throw new BillingInputError(`绑定字段 ${invalidBindingField} 不允许由客户端提交`);
        }
    }
    if (!input.dimensionCommand) return;
    const allowed = input.dimensionCommand.action === "set_manual" ? ["action", "bindingId", "dimensionId", "effectiveValue"] : ["action", "bindingId", "dimensionId"];
    const invalid = Object.keys(input.dimensionCommand).find((key) => !allowed.includes(key));
    if (invalid || (input.dimensionCommand.action !== "set_manual" && input.dimensionCommand.action !== "restore_upstream")) throw new BillingInputError("价格维度命令无效");
}

function dimensionAudit(models: LogicalModel[], savedModel: LogicalModel, command: ProviderDimensionCommand, pricingPolicyVersion: string): AdminModelPricingAudit {
    const oldDimension = models
        .find((model) => model.id === savedModel.id)
        ?.bindings.find((binding) => binding.id === command.bindingId)
        ?.providerPricingProfile?.dimensions.find((dimension) => dimension.id === command.dimensionId);
    const newProfile = savedModel.bindings.find((binding) => binding.id === command.bindingId)?.providerPricingProfile;
    const newDimension = newProfile?.dimensions.find((dimension) => dimension.id === command.dimensionId);
    if (!oldDimension || !newDimension) throw new BillingInputError("价格维度审计数据不完整", 409);
    return {
        action: command.action === "set_manual" ? "admin.billing.provider_price.override" : "admin.billing.provider_price.restore",
        metadata: {
            modelId: savedModel.id,
            bindingId: command.bindingId,
            dimensionId: command.dimensionId,
            oldValue: oldDimension.effectiveValue,
            newValue: newDimension.effectiveValue,
            oldSource: oldDimension.source,
            newSource: newDimension.source,
            pricingPolicyVersion,
            warningCodes: Array.from(new Set((newProfile?.warnings || []).map((warning) => warning.code))),
        },
    };
}

function presentModel(model: LogicalModel): LogicalModel {
    return {
        id: model.id,
        name: model.name,
        capability: model.capability,
        enabled: model.enabled,
        ...(model.saleRateCard ? { saleRateCard: model.saleRateCard } : {}),
        ...(model.salePriceSource ? { salePriceSource: model.salePriceSource } : {}),
        ...(model.salePriceApproval ? { salePriceApproval: model.salePriceApproval } : {}),
        ...(model.suggestedSaleRateCard ? { suggestedSaleRateCard: model.suggestedSaleRateCard } : {}),
        bindings: model.bindings.map((binding) => ({
            id: binding.id,
            channelId: binding.channelId,
            upstreamModel: binding.upstreamModel,
            enabled: binding.enabled,
            priority: binding.priority,
            ...(binding.costRateCard ? { costRateCard: binding.costRateCard } : {}),
            ...(binding.providerCostUnit ? { providerCostUnit: binding.providerCostUnit } : {}),
            ...(binding.providerPricingProfile ? { providerPricingProfile: binding.providerPricingProfile } : {}),
        })),
    };
}
