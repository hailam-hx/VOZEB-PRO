import type { LogicalModel, LogicalModelBinding, LogicalModelCapability, LogicalModelCapabilityProfile, LogicalModelGenerationParameterSources, SystemDefaultModels, SystemModelChannel } from "@/lib/auth/store";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";
import { inferModelCapability, isCreativeGenerationModel, normalizeModelId } from "@/lib/model-capability";
import { channelConnectionReady, protocolCatalogCapability } from "@/lib/channel-protocol-registry";
import { validatePricingRateCard } from "@/lib/billing/pricing";
import { validateProviderCostUnit } from "@/lib/billing/money";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { mergeDflopGenerationParameters, normalizeDflopUpstreamModelMetadata, reconcileDflopUpstreamModelMetadata } from "@/lib/dflop-model-metadata";
import { applyProviderPricingConversion, normalizeProviderPricingProfile, providerPricingCostUnit, providerPricingProfileToCostRateCard, reconcileProviderPricingProfile } from "@/lib/billing/provider-pricing";
import { reapplyStoredCapabilityProbe } from "@/lib/billing/provider-capability-probe";
import { DEFAULT_SYSTEM_PRICING_POLICY, normalizeSalePriceApproval, normalizeSuggestedSaleRateCard, normalizeSystemPricingPolicy, type SystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { applySuggestedPricingToLogicalModels } from "@/lib/billing/suggested-model-pricing";
import { deriveDflopImageQualityProfile } from "@/lib/dflop-image-quality-profile";
import { normalizeImageQualityProfile } from "@/lib/image-quality-profile";

const DEFAULT_MODEL_SPECS: ReadonlyArray<{ capability: LogicalModelCapability; key: keyof SystemDefaultModels; audioOperation?: "speech" | "voice-clone" }> = [
    { capability: "text", key: "textModel" },
    { capability: "image", key: "imageModel" },
    { capability: "video", key: "videoModel" },
    { capability: "audio", key: "audioModel", audioOperation: "speech" },
    { capability: "audio", key: "voiceCloneModel", audioOperation: "voice-clone" },
];

export function normalizeLogicalModelsConfig(models: LogicalModel[] | undefined, channels: SystemModelChannel[], pricingPolicy: SystemPricingPolicy = DEFAULT_SYSTEM_PRICING_POLICY) {
    return synchronizeLogicalModelsWithChannels(Array.isArray(models) ? models : [], channels, pricingPolicy);
}

export function deriveLogicalModelsConfig(channels: SystemModelChannel[], pricingPolicy: SystemPricingPolicy = DEFAULT_SYSTEM_PRICING_POLICY): LogicalModel[] {
    return synchronizeLogicalModelsWithChannels([], channels, pricingPolicy);
}

export function synchronizeLogicalModelsWithChannels(existingModels: LogicalModel[], channels: SystemModelChannel[], pricingPolicy: SystemPricingPolicy = DEFAULT_SYSTEM_PRICING_POLICY): LogicalModel[] {
    const normalizedPricingPolicy = normalizeSystemPricingPolicy(pricingPolicy);
    const catalogBindings: Array<{
        key: string;
        modelKey: string;
        channel: SystemModelChannel;
        channelIndex: number;
        upstreamModel: string;
        capability: LogicalModelCapability;
        authoritative: boolean;
    }> = [];
    channels.forEach((channel, channelIndex) => {
        channel.models.forEach((upstreamModel) => {
            const id = rawModelName(upstreamModel);
            if (!id || !isCreativeGenerationModel(id) || !channelModelIsRoutable(channel, upstreamModel)) return;
            const detected = resolveChannelModelCapability(channel, upstreamModel);
            const modelKey = normalizeModelName(id);
            catalogBindings.push({ key: bindingKey(channel.id, upstreamModel), modelKey, channel, channelIndex, upstreamModel, ...detected });
        });
    });

    const catalogByBinding = new Map(catalogBindings.map((binding) => [binding.key, binding]));
    const savedOwner = new Map<string, number>();
    existingModels.forEach((model, modelIndex) =>
        model.bindings.forEach((binding) => {
            const key = bindingKey(binding.channelId, binding.upstreamModel);
            if (catalogByBinding.has(key) && !savedOwner.has(key)) savedOwner.set(key, modelIndex);
        }),
    );
    const claimedBindings = new Set<string>();
    const usedModelIds = new Set<string>();
    const preserved = existingModels.flatMap((existing, modelIndex) => {
        const available = existing.bindings.flatMap((binding) => {
            const catalog = catalogByBinding.get(bindingKey(binding.channelId, binding.upstreamModel));
            return catalog && savedOwner.get(catalog.key) === modelIndex ? [{ catalog, stored: binding }] : [];
        });
        const anchor = available.find(({ catalog }) => catalog.modelKey === normalizeModelName(existing.id)) || available[0];
        const capability = anchor?.catalog.authoritative ? anchor.catalog.capability : normalizeCapability(existing.capability);
        const seenBindings = new Set<string>();
        const bindings = available
            .filter(({ catalog }) => {
                if (seenBindings.has(catalog.key) || (catalog.authoritative && catalog.capability !== capability)) return false;
                seenBindings.add(catalog.key);
                return true;
            })
            .map(({ catalog, stored }) => {
                claimedBindings.add(catalog.key);
                return normalizedCatalogBinding(catalog, stored, normalizedPricingPolicy);
            });
        const modelKeys = new Set(bindings.map((binding) => normalizeModelName(binding.upstreamModel)));
        for (const catalog of catalogBindings) {
            if (claimedBindings.has(catalog.key) || savedOwner.has(catalog.key) || !modelKeys.has(catalog.modelKey) || (catalog.authoritative && catalog.capability !== capability)) continue;
            claimedBindings.add(catalog.key);
            bindings.push(normalizedCatalogBinding(catalog, undefined, normalizedPricingPolicy));
        }
        if (!bindings.length) return [];
        bindings.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        const saleRateCard = existing.saleRateCard === undefined ? undefined : validatePricingRateCard(existing.saleRateCard);
        const salePriceSource = saleRateCard ? existing.salePriceSource || "manual" : undefined;
        const salePriceApproval = salePriceSource === "approved" ? normalizeSalePriceApproval(existing.salePriceApproval) : undefined;
        const suggestedSaleRateCard = normalizeSuggestedSaleRateCard(existing.suggestedSaleRateCard);
        const nameSource = logicalNameSource(existing, bindings);
        return [
            {
                id: uniqueLogicalModelId(existing.id, usedModelIds),
                name: synchronizedLogicalModelName(existing, bindings, nameSource),
                nameSource,
                capability,
                enabled: existing.enabled !== false,
                ...(saleRateCard ? { saleRateCard } : {}),
                ...(salePriceSource ? { salePriceSource } : {}),
                ...(salePriceApproval ? { salePriceApproval } : {}),
                ...(suggestedSaleRateCard ? { suggestedSaleRateCard } : {}),
                bindings,
            },
        ];
    });

    const unassigned = new Map<string, typeof catalogBindings>();
    for (const catalog of catalogBindings) {
        if (claimedBindings.has(catalog.key)) continue;
        const groupKey = `${catalog.modelKey}\0${catalog.capability}`;
        unassigned.set(groupKey, [...(unassigned.get(groupKey) || []), catalog]);
    }
    const created = Array.from(unassigned.values()).map((catalog) => {
        const authoritative = catalog.find((binding) => binding.authoritative);
        const capability = authoritative?.capability || catalog[0].capability;
        const bindings = catalog.map((binding) => normalizedCatalogBinding(binding, undefined, normalizedPricingPolicy)).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        return {
            id: uniqueLogicalModelId(catalog[0].upstreamModel, usedModelIds),
            name: catalogDisplayName(catalog[0]) || rawModelName(catalog[0].upstreamModel),
            nameSource: catalogDisplayName(catalog[0]) ? ("upstream" as const) : ("manual" as const),
            capability,
            enabled: true,
            bindings,
        };
    });
    const synchronized = [...preserved, ...created];
    return applySuggestedPricingToLogicalModels(synchronized, channels, normalizedPricingPolicy, pricingCalculationTime(synchronized));
}

export function mergeChannelModelsIntoLogicalModels(logicalModels: LogicalModel[], channels: SystemModelChannel[]) {
    return synchronizeLogicalModelsWithChannels(logicalModels, channels);
}

export function dflopModelSyncStats(existingModels: LogicalModel[], channels: SystemModelChannel[], updatedChannel: SystemModelChannel, pricingPolicy: SystemPricingPolicy = DEFAULT_SYSTEM_PRICING_POLICY) {
    const previousIds = new Set(existingModels.map((model) => model.id.toLowerCase()));
    const previousBindings = new Map(existingModels.flatMap((model) => model.bindings.map((binding) => [bindingKey(binding.channelId, binding.upstreamModel), { model, binding }] as const)));
    const nextChannels = channels.some((channel) => channel.id === updatedChannel.id) ? channels.map((channel) => (channel.id === updatedChannel.id ? updatedChannel : channel)) : [...channels, updatedChannel];
    const nextModels = synchronizeLogicalModelsWithChannels(existingModels, nextChannels, pricingPolicy);
    let updated = 0;
    let manualOverridesPreserved = 0;
    let capabilityDrifts = 0;
    const changedModels: Array<{ modelId: string; displayName?: string; category?: string; endpointType?: string | null; capabilitySource: string; changedFields: string[] }> = [];
    const imageQualityProfiles = { total: 0, valid: 0, drift: 0, needsReview: 0, invalid: 0, manual: 0, none: 0, unprofiled: 0 };
    for (const model of nextModels) {
        for (const binding of model.bindings.filter((item) => item.channelId === updatedChannel.id)) {
            if (model.capability === "image") {
                imageQualityProfiles.total += 1;
                const profile = normalizeImageQualityProfile(binding.imageQualityProfile);
                if (!profile) imageQualityProfiles.unprofiled += 1;
                else {
                    if (profile.validation.status === "VALID") imageQualityProfiles.valid += 1;
                    if (profile.validation.status === "DRIFT") imageQualityProfiles.drift += 1;
                    if (profile.validation.status === "NEEDS_REVIEW") imageQualityProfiles.needsReview += 1;
                    if (profile.validation.status === "INVALID") imageQualityProfiles.invalid += 1;
                    if (profile.source === "manual") imageQualityProfiles.manual += 1;
                    if (profile.controlType === "none") imageQualityProfiles.none += 1;
                }
            }
            const previous = previousBindings.get(bindingKey(binding.channelId, binding.upstreamModel));
            const changedFields = metadataChangedFields(previous?.binding.upstreamMetadata, binding.upstreamMetadata);
            if (previous && (changedFields.length || previous.model.name !== model.name)) updated += 1;
            manualOverridesPreserved += binding.capabilityDrifts?.length || 0;
            capabilityDrifts += binding.capabilityDrifts?.length || 0;
            if (changedFields.length || !previous) {
                changedModels.push({
                    modelId: binding.upstreamModel,
                    ...(binding.upstreamMetadata?.displayName ? { displayName: binding.upstreamMetadata.displayName } : {}),
                    ...(binding.upstreamMetadata?.category ? { category: binding.upstreamMetadata.category } : {}),
                    ...(binding.upstreamMetadata?.endpointType !== undefined ? { endpointType: binding.upstreamMetadata.endpointType } : {}),
                    capabilitySource: binding.upstreamMetadata ? "upstream" : "fallback",
                    changedFields,
                });
            }
        }
    }
    return { created: nextModels.filter((model) => !previousIds.has(model.id.toLowerCase())).length, updated, manualOverridesPreserved, capabilityDrifts, imageQualityProfiles, changedModels };
}

function metadataChangedFields(previous: LogicalModelBinding["upstreamMetadata"], next: LogicalModelBinding["upstreamMetadata"]) {
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    return Array.from(keys).filter((key) => JSON.stringify(comparableMetadataField(key, previous?.[key as keyof typeof previous])) !== JSON.stringify(comparableMetadataField(key, next?.[key as keyof typeof next])));
}

function comparableMetadataField(key: string, value: unknown) {
    if (key !== "providerPricingProfile") return value;
    const profile = normalizeProviderPricingProfile(value);
    if (!profile) return value;
    return {
        provider: profile.provider,
        modelId: profile.modelId,
        status: profile.status,
        raw: profile.raw,
        discount: profile.discount,
        dimensions: profile.dimensions.map(({ syncedAt: _syncedAt, providerCostHotxCredits: _converted, ...dimension }) => dimension),
        unknownFields: profile.unknownFields,
        missingFields: profile.missingFields,
        warnings: profile.warnings,
        metadata: profile.metadata,
    };
}

export function normalizeDefaultModelsConfig(defaults: Partial<SystemDefaultModels> | undefined, logicalModels: LogicalModel[], channels: SystemModelChannel[]): SystemDefaultModels {
    return Object.fromEntries(
        DEFAULT_MODEL_SPECS.map(({ capability, key, audioOperation }) => {
            const modelId = text(defaults?.[key], 120);
            if (!modelId || isLogicalModelResolvable(logicalModels, channels, capability, modelId, audioOperation)) return [key, modelId];
            const fallback = logicalModels.find((model) => model.capability === capability && isLogicalModelResolvable(logicalModels, channels, capability, model.id, audioOperation));
            return [key, fallback?.id || ""];
        }),
    ) as SystemDefaultModels;
}

export function isLogicalModelResolvable(logicalModels: LogicalModel[], channels: SystemModelChannel[], capability: LogicalModelCapability, modelId: string, audioOperation?: "speech" | "voice-clone") {
    return Boolean(resolveLogicalModelConfig(logicalModels, channels, capability, modelId, audioOperation));
}

export function resolveLogicalModelConfig(logicalModels: LogicalModel[], channels: SystemModelChannel[], capability: LogicalModelCapability, modelId: string, audioOperation?: "speech" | "voice-clone") {
    const logical = logicalModels.find((model) => model.enabled && model.capability === capability && model.id.toLowerCase() === rawModelName(modelId).toLowerCase());
    if (!logical) return null;
    const bindings = [...logical.bindings]
        .filter((binding) => binding.enabled && (capability !== "audio" || !audioOperation || (binding.generationParameters?.audioOperation || "speech") === audioOperation))
        .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    for (const binding of bindings) {
        const channel = channels.find((item) => item.id === binding.channelId && item.enabled && channelConnectionReady(item) && channelSupportsModel(item, binding.upstreamModel));
        if (channel) return { logicalModel: logical, binding, channel };
    }
    return null;
}

export function modelRoutingValidationErrors(logicalModels: LogicalModel[], channels: SystemModelChannel[], defaults: SystemDefaultModels) {
    const errors = modelBindingAssignmentValidationErrors(logicalModels, channels);
    const modelIds = new Set<string>();
    for (const model of logicalModels) {
        const key = rawModelName(model.id).toLowerCase();
        if (!key) errors.push("逻辑模型 ID 不能为空");
        else if (modelIds.has(key)) errors.push(`逻辑模型 ID 重复：${model.id}`);
        modelIds.add(key);
        if (!model.bindings.length) errors.push(`逻辑模型 ${model.name || model.id} 至少需要一个渠道绑定`);
        const bindingKeys = new Set<string>();
        for (const binding of model.bindings) {
            const channel = channels.find((item) => item.id === binding.channelId);
            const key = bindingKey(binding.channelId, binding.upstreamModel);
            if (!channel) errors.push(`逻辑模型 ${model.id} 引用了不存在的渠道`);
            else if (!channelSupportsModel(channel, binding.upstreamModel)) errors.push(`渠道 ${channel.name} 未启用上游模型 ${binding.upstreamModel}`);
            if (bindingKeys.has(key)) errors.push(`逻辑模型 ${model.id} 存在重复绑定`);
            bindingKeys.add(key);
            const streamingTimeoutError = streamingTimeoutValidationError(model, binding);
            if (streamingTimeoutError) errors.push(streamingTimeoutError);
        }
    }
    for (const { capability, key, audioOperation } of DEFAULT_MODEL_SPECS) {
        const modelId = defaults[key];
        if (modelId && !isLogicalModelResolvable(logicalModels, channels, capability, modelId, audioOperation)) errors.push(`默认${key === "voiceCloneModel" ? "声音克隆" : capabilityLabel(capability)}模型不可解析：${modelId}`);
    }
    return Array.from(new Set(errors));
}

export function modelBindingAssignmentValidationErrors(logicalModels: LogicalModel[], channels: SystemModelChannel[]) {
    const errors: string[] = [];
    const owners = new Map<string, string>();
    for (const model of logicalModels) {
        for (const binding of model.bindings || []) {
            const channel = channels.find((item) => item.id === binding.channelId);
            if (!channel || !channelSupportsModel(channel, binding.upstreamModel)) continue;
            const key = bindingKey(binding.channelId, binding.upstreamModel);
            const owner = owners.get(key);
            if (owner && owner !== model.id) errors.push(`渠道 ${channel.name} 的上游模型 ${binding.upstreamModel} 只能绑定一个逻辑模型`);
            else owners.set(key, model.id);
            const detected = resolveChannelModelCapability(channel, binding.upstreamModel);
            if (detected.authoritative && detected.capability !== model.capability) errors.push(`逻辑模型 ${model.id} 不能绑定${capabilityLabel(detected.capability)}模型 ${binding.upstreamModel}`);
        }
    }
    return Array.from(new Set(errors));
}

export function capabilityLabel(capability: LogicalModelCapability) {
    return capability === "text" ? "文本" : capability === "image" ? "图片" : capability === "video" ? "视频" : "音频";
}

export function channelModelCapability(channel: Pick<SystemModelChannel, "advancedConfig">, model: string): LogicalModelCapability {
    return resolveChannelModelCapability(channel, model).capability;
}

export function channelModelDiscovery(channel: Pick<SystemModelChannel, "advancedConfig">, model: string) {
    return channel.advancedConfig?.modelDiscovery?.[normalizeModelId(model)];
}

export function channelModelIsRoutable(channel: Pick<SystemModelChannel, "advancedConfig">, model: string) {
    return channelModelDiscovery(channel, model)?.routable !== false;
}

function resolveChannelModelCapability(channel: Pick<SystemModelChannel, "advancedConfig">, model: string) {
    const key = normalizeModelId(model);
    if (key === "auto") return { capability: "text" as const, authoritative: true };
    const protocolCapability = protocolCatalogCapability(channel.advancedConfig?.protocol || "auto");
    if (protocolCapability) return { capability: protocolCapability, authoritative: true };
    const config = channel.advancedConfig?.modelConfigs?.[key];
    const inferred = inferModelCapability(model);
    if (config?.source === "health" && inferred !== "text") return { capability: inferred, authoritative: true };
    const configured = config?.capability || channel.advancedConfig?.modelCapabilities?.[key];
    if (!config && configured === "text" && inferred !== "text") return { capability: inferred, authoritative: true };
    return configured ? { capability: configured, authoritative: true } : { capability: inferred, authoritative: false };
}

export function channelDetectedCapabilities(channel: Pick<SystemModelChannel, "advancedConfig" | "models">) {
    return new Set(channel.models.filter((model) => isCreativeGenerationModel(model) && channelModelIsRoutable(channel, model)).map((model) => channelModelCapability(channel, model)));
}

export function resolveLogicalModelCapabilityProfile(binding: Pick<LogicalModelBinding, "capabilityProfile">, capability: LogicalModelCapability, channel?: Pick<SystemModelChannel, "advancedConfig">, upstreamModel = "") {
    void upstreamModel;
    const profile = normalizeStoredCapabilityProfile(binding.capabilityProfile);
    if (!profile && !channel?.advancedConfig) return undefined;
    return { ...profile, supportsAsync: profile?.supportsAsync ?? (capability === "image" || capability === "video") };
}

function channelSupportsModel(channel: Pick<SystemModelChannel, "models">, model: string) {
    const target = normalizeModelName(model);
    return Boolean(target && channel.models.some((item) => normalizeModelName(item) === target));
}

function bindingKey(channelId: string, upstreamModel: string) {
    return `${channelId}:${normalizeModelName(upstreamModel)}`;
}

function normalizedCatalogBinding(
    catalog: { channel: SystemModelChannel; channelIndex: number; upstreamModel: string; capability: LogicalModelCapability },
    stored: LogicalModelBinding | undefined,
    pricingPolicy: SystemPricingPolicy,
): LogicalModelBinding {
    const dflopVoiceClone = catalog.channel.advancedConfig?.protocol === "dflop" && normalizeModelId(catalog.upstreamModel) === "voice-clone-pro";
    const discoveredMetadata = normalizeDflopUpstreamModelMetadata(channelModelDiscovery(catalog.channel, catalog.upstreamModel)?.upstreamMetadata);
    const capabilityProfile = syncDflopTextTokenProfile(
        normalizeStoredCapabilityProfile(stored?.capabilityProfile ?? (!stored && dflopVoiceClone ? { supportsIdempotency: true } : undefined)),
        catalog.channel.advancedConfig?.protocol === "dflop" && catalog.capability === "text" ? discoveredMetadata?.runtime : undefined,
    );
    const upstreamMetadata = reconcileDflopUpstreamModelMetadata(stored?.upstreamMetadata, discoveredMetadata);
    const upstreamMerge = discoveredMetadata
        ? mergeDflopGenerationParameters(
              stored?.generationParameters,
              stored?.generationParameterSources,
              discoveredMetadata.generationParameters,
              discoveredMetadata.generationParameterSources,
              false,
              stored?.upstreamMetadata?.generationParameterEvidence,
              discoveredMetadata.generationParameterEvidence,
          )
        : undefined;
    const discoveredGenerationParameters =
        upstreamMerge && (stored?.generationParameters || upstreamMetadata?.generationParameters)
            ? upstreamMerge.parameters
            : normalizeGenerationParameters(stored?.generationParameters ?? (!stored && dflopVoiceClone ? { audioOperation: "voice-clone" } : undefined));
    const isDflopImage = catalog.channel.advancedConfig?.protocol === "dflop" && catalog.capability === "image";
    const generationParameters = isDflopImage && discoveredGenerationParameters ? { ...discoveredGenerationParameters, qualities: [] } : discoveredGenerationParameters;
    const generationParameterSources = upstreamMerge?.sources || normalizeGenerationParameterSources(stored?.generationParameterSources, stored?.generationParameters);
    const weight = clampWeight(stored?.weight);
    const discoveredPricingProfile = normalizeProviderPricingProfile(upstreamMetadata?.providerPricingProfile);
    const storedPricingProfile = normalizeProviderPricingProfile(stored?.providerPricingProfile);
    const reconciledPricingProfile = discoveredPricingProfile ? reapplyStoredCapabilityProbe(reconcileProviderPricingProfile(storedPricingProfile, discoveredPricingProfile)) : storedPricingProfile;
    const providerPricingProfile = reconciledPricingProfile ? applyProviderPricingConversion(reconciledPricingProfile, pricingPolicy, discoveredPricingProfile?.syncedAt || reconciledPricingProfile.syncedAt) : undefined;
    const projectedCostRateCard = providerPricingProfile?.conversion ? providerPricingProfileToCostRateCard(providerPricingProfile) : undefined;
    const costRateCard = projectedCostRateCard || (stored?.costRateCard === undefined ? undefined : validatePricingRateCard(stored.costRateCard));
    const providerCostUnit = projectedCostRateCard ? providerPricingCostUnit(pricingPolicy) : stored?.providerCostUnit === undefined ? undefined : validateProviderCostUnit(stored.providerCostUnit);
    const imageQualityProfile = isDflopImage
        ? deriveDflopImageQualityProfile({ modelId: catalog.upstreamModel, currentProfile: stored?.imageQualityProfile, structuredProfile: upstreamMetadata?.imageQualityProfile, providerPricingProfile, syncedAt: providerPricingProfile?.syncedAt })
        : stored?.imageQualityProfile;
    if (costRateCard && !providerCostUnit) throw new Error("供应商成本价格卡必须指定有效的供应商成本单位");
    return {
        id: text(stored?.id, 120) || `${catalog.channel.id}:${rawModelName(catalog.upstreamModel)}`,
        channelId: catalog.channel.id,
        upstreamModel: catalog.upstreamModel,
        enabled: stored?.enabled !== false,
        priority: clampPriority(stored?.priority, catalog.channelIndex + 1),
        ...(weight !== undefined ? { weight } : {}),
        ...(capabilityProfile ? { capabilityProfile } : {}),
        ...(generationParameters ? { generationParameters } : {}),
        ...(Object.keys(generationParameterSources).length ? { generationParameterSources } : {}),
        ...(upstreamMerge?.drifts.length ? { capabilityDrifts: upstreamMerge.drifts } : {}),
        ...(upstreamMerge?.descriptionEvidenceMissing.length ? { descriptionEvidenceMissing: upstreamMerge.descriptionEvidenceMissing } : {}),
        ...(upstreamMetadata ? { upstreamMetadata } : {}),
        ...(costRateCard ? { costRateCard } : {}),
        ...(providerCostUnit ? { providerCostUnit } : {}),
        ...(providerPricingProfile ? { providerPricingProfile } : {}),
        ...(imageQualityProfile ? { imageQualityProfile } : {}),
    };
}

export function resynchronizeDflopBindingFromUpstream(binding: LogicalModelBinding, channel: SystemModelChannel, pricingPolicy: SystemPricingPolicy = DEFAULT_SYSTEM_PRICING_POLICY) {
    const discoveredMetadata = normalizeDflopUpstreamModelMetadata(channelModelDiscovery(channel, binding.upstreamModel)?.upstreamMetadata);
    if (!discoveredMetadata) return binding;
    const upstreamMetadata = reconcileDflopUpstreamModelMetadata(binding.upstreamMetadata, discoveredMetadata);
    const merged = discoveredMetadata.generationParameters
        ? mergeDflopGenerationParameters(
              binding.generationParameters,
              binding.generationParameterSources,
              discoveredMetadata.generationParameters,
              discoveredMetadata.generationParameterSources,
              true,
              binding.upstreamMetadata?.generationParameterEvidence,
              discoveredMetadata.generationParameterEvidence,
          )
        : undefined;
    const discoveredPricingProfile = normalizeProviderPricingProfile(discoveredMetadata.providerPricingProfile);
    const providerPricingProfile = discoveredPricingProfile
        ? applyProviderPricingConversion(reapplyStoredCapabilityProbe(reconcileProviderPricingProfile(binding.providerPricingProfile, discoveredPricingProfile)), pricingPolicy, discoveredPricingProfile.syncedAt)
        : binding.providerPricingProfile;
    const costRateCard = providerPricingProfile?.conversion ? providerPricingProfileToCostRateCard(providerPricingProfile) : binding.costRateCard;
    const isImage = channelModelCapability(channel, binding.upstreamModel) === "image";
    const imageQualityProfile = isImage
        ? deriveDflopImageQualityProfile({ modelId: binding.upstreamModel, currentProfile: binding.imageQualityProfile, structuredProfile: upstreamMetadata?.imageQualityProfile, providerPricingProfile, syncedAt: providerPricingProfile?.syncedAt })
        : binding.imageQualityProfile;
    return {
        ...binding,
        ...(channelModelCapability(channel, binding.upstreamModel) === "text" ? { capabilityProfile: syncDflopTextTokenProfile(normalizeStoredCapabilityProfile(binding.capabilityProfile), discoveredMetadata.runtime) } : {}),
        ...(merged ? { generationParameters: isImage ? { ...merged.parameters, qualities: [] } : merged.parameters, generationParameterSources: merged.sources, capabilityDrifts: undefined } : {}),
        ...(merged ? (merged.descriptionEvidenceMissing.length ? { descriptionEvidenceMissing: merged.descriptionEvidenceMissing } : { descriptionEvidenceMissing: undefined }) : {}),
        upstreamMetadata,
        ...(providerPricingProfile ? { providerPricingProfile } : {}),
        ...(costRateCard ? { costRateCard, providerCostUnit: providerPricingCostUnit(pricingPolicy) } : {}),
        ...(imageQualityProfile ? { imageQualityProfile } : {}),
    };
}

function synchronizedLogicalModelName(existing: LogicalModel, bindings: LogicalModelBinding[], nameSource: "upstream" | "manual") {
    if (nameSource !== "upstream") return text(existing.name, 120) || bindings[0].upstreamModel;
    return bindings.map((binding) => binding.upstreamMetadata?.displayName).find(Boolean) || text(existing.name, 120) || bindings[0].upstreamModel;
}

function logicalNameSource(existing: LogicalModel, bindings: LogicalModelBinding[]): "upstream" | "manual" {
    if (existing.nameSource) return existing.nameSource;
    const name = normalizeModelName(existing.name);
    return name === normalizeModelName(existing.id) || bindings.some((binding) => name === normalizeModelName(binding.upstreamModel)) ? "upstream" : "manual";
}

function catalogDisplayName(catalog: { channel: SystemModelChannel; upstreamModel: string }) {
    return channelModelDiscovery(catalog.channel, catalog.upstreamModel)?.upstreamMetadata?.displayName;
}

function normalizeGenerationParameterSources(value: LogicalModelGenerationParameterSources | undefined, parameters: LogicalModelBinding["generationParameters"]) {
    if (value) return { ...value };
    if (!parameters) return {};
    return Object.fromEntries(Object.keys(parameters).map((field) => [field, "manual"])) as LogicalModelGenerationParameterSources;
}

function pricingCalculationTime(models: LogicalModel[]) {
    return (
        models
            .flatMap((model) => [model.suggestedSaleRateCard?.calculatedAt, ...model.bindings.flatMap((binding) => [binding.providerPricingProfile?.conversion?.calculatedAt, binding.providerPricingProfile?.syncedAt])])
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) || new Date(0).toISOString()
    );
}

function uniqueLogicalModelId(value: string, usedIds: Set<string>) {
    const base = text(rawModelName(value), 120) || "model";
    let candidate = base;
    let suffix = 2;
    while (usedIds.has(candidate.toLowerCase())) {
        const ending = `-${suffix++}`;
        candidate = `${base.slice(0, 120 - ending.length)}${ending}`;
    }
    usedIds.add(candidate.toLowerCase());
    return candidate;
}

function normalizeStoredCapabilityProfile(value: unknown): LogicalModelCapabilityProfile | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const profile: LogicalModelCapabilityProfile = {
        supportsAsync: optionalBoolean(input.supportsAsync),
        supportsCancel: optionalBoolean(input.supportsCancel),
        supportsWebhook: optionalBoolean(input.supportsWebhook),
        timeoutMs: timeoutMilliseconds(input.timeoutMs),
        streamingTimeouts: normalizeStreamingTimeouts(input.streamingTimeouts),
        concurrencyLimit: positiveInteger(input.concurrencyLimit),
        maxInputTokens: positiveTokenLimit(input.maxInputTokens),
        maxOutputTokens: positiveTokenLimit(input.maxOutputTokens),
        maxInputTokensSource: input.maxInputTokensSource === "upstream" || input.maxInputTokensSource === "manual" ? input.maxInputTokensSource : undefined,
        maxOutputTokensSource: input.maxOutputTokensSource === "upstream" || input.maxOutputTokensSource === "manual" ? input.maxOutputTokensSource : undefined,
        supportsIdempotency: optionalBoolean(input.supportsIdempotency),
        unitCost: positiveNumber(input.unitCost),
        unitCostCurrency: text(input.unitCostCurrency, 12) || undefined,
    };
    return Object.values(profile).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0)) ? profile : undefined;
}

function syncDflopTextTokenProfile(current: LogicalModelCapabilityProfile | undefined, runtime: Record<string, unknown> | undefined): LogicalModelCapabilityProfile | undefined {
    if (!runtime) return current;
    const next = { ...(current || {}) };
    const outputLimit = positiveTokenLimit(runtime.defaultMaxTokens);
    if (outputLimit !== undefined && (next.maxOutputTokens === undefined || next.maxOutputTokensSource === "upstream")) {
        next.maxOutputTokens = outputLimit;
        next.maxOutputTokensSource = "upstream";
    }
    const contextWindow = positiveTokenLimit(runtime.contextWindow);
    if (contextWindow !== undefined && next.maxOutputTokens !== undefined && (next.maxInputTokens === undefined || next.maxInputTokensSource === "upstream")) {
        const inputLimit = contextWindow - next.maxOutputTokens;
        if (inputLimit > 0) {
            next.maxInputTokens = inputLimit;
            next.maxInputTokensSource = "upstream";
        } else {
            next.maxInputTokens = undefined;
            next.maxInputTokensSource = undefined;
        }
    }
    return Object.values(next).some((value) => value !== undefined) ? next : undefined;
}

function positiveTokenLimit(value: unknown) {
    if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function normalizeStreamingTimeouts(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const timeouts = {
        connectMs: positiveMilliseconds(input.connectMs),
        firstByteMs: positiveMilliseconds(input.firstByteMs),
        firstTextMs: positiveMilliseconds(input.firstTextMs),
        idleMs: positiveMilliseconds(input.idleMs),
    };
    return Object.values(timeouts).some((item) => item !== undefined) ? timeouts : undefined;
}

function streamingTimeoutValidationError(model: LogicalModel, binding: LogicalModelBinding) {
    const profile = normalizeStoredCapabilityProfile(binding.capabilityProfile);
    const timeouts = profile?.streamingTimeouts;
    if (!timeouts) return undefined;
    const overallTimeoutMs = resolveModelRequestTimeoutMs({ capabilityProfile: profile }, model.capability);
    const stageLabels = { connectMs: "连接", firstByteMs: "首字节", firstTextMs: "首段文本", idleMs: "空闲" } as const;
    for (const [key, label] of Object.entries(stageLabels) as Array<[keyof typeof stageLabels, string]>) {
        if ((timeouts[key] || 0) > overallTimeoutMs) return `逻辑模型 ${model.id} 的${label}超时不能超过总请求超时`;
    }
    return undefined;
}

function optionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
}

function positiveInteger(value: unknown) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, 1000000) : undefined;
}

function timeoutMilliseconds(value: unknown) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, 30 * 60_000) : undefined;
}

function positiveMilliseconds(value: unknown) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(number, 100000000) : undefined;
}

function normalizeModelName(value: string) {
    return rawModelName(value).toLowerCase();
}

function rawModelName(value: string) {
    return String(value || "")
        .trim()
        .replace(/^models\//i, "");
}

function normalizeCapability(value: unknown): LogicalModelCapability {
    return value === "image" || value === "video" || value === "audio" ? value : "text";
}

function clampPriority(value: unknown, fallback: number) {
    return Math.max(1, Math.min(10000, Math.floor(Number(value) || fallback)));
}

function clampWeight(value: unknown) {
    const weight = Math.floor(Number(value));
    return Number.isFinite(weight) && weight > 0 ? Math.min(weight, 10000) : undefined;
}

function text(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
