import type { LogicalModel, LogicalModelBinding, LogicalModelCapability, LogicalModelCapabilityProfile, SystemDefaultModels, SystemModelChannel } from "@/lib/auth/store";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";
import { inferModelCapability, isCreativeGenerationModel, normalizeModelId } from "@/lib/model-capability";
import { channelConnectionReady, protocolCatalogCapability } from "@/lib/channel-protocol-registry";
import { validatePricingRateCard } from "@/lib/billing/pricing";
import { validateProviderCostUnit } from "@/lib/billing/money";

const DEFAULT_MODEL_SPECS: ReadonlyArray<{ capability: LogicalModelCapability; key: keyof SystemDefaultModels; audioOperation?: "speech" | "voice-clone" }> = [
    { capability: "text", key: "textModel" },
    { capability: "image", key: "imageModel" },
    { capability: "video", key: "videoModel" },
    { capability: "audio", key: "audioModel", audioOperation: "speech" },
    { capability: "audio", key: "voiceCloneModel", audioOperation: "voice-clone" },
];

export function normalizeLogicalModelsConfig(models: LogicalModel[] | undefined, channels: SystemModelChannel[]) {
    return synchronizeLogicalModelsWithChannels(Array.isArray(models) ? models : [], channels);
}

export function deriveLogicalModelsConfig(channels: SystemModelChannel[]): LogicalModel[] {
    return synchronizeLogicalModelsWithChannels([], channels);
}

export function synchronizeLogicalModelsWithChannels(existingModels: LogicalModel[], channels: SystemModelChannel[]): LogicalModel[] {
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
            if (!id || !isCreativeGenerationModel(id)) return;
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
                return normalizedCatalogBinding(catalog, stored);
            });
        const modelKeys = new Set(bindings.map((binding) => normalizeModelName(binding.upstreamModel)));
        for (const catalog of catalogBindings) {
            if (claimedBindings.has(catalog.key) || savedOwner.has(catalog.key) || !modelKeys.has(catalog.modelKey) || (catalog.authoritative && catalog.capability !== capability)) continue;
            claimedBindings.add(catalog.key);
            bindings.push(normalizedCatalogBinding(catalog));
        }
        if (!bindings.length) return [];
        bindings.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        const saleRateCard = existing.saleRateCard === undefined ? undefined : validatePricingRateCard(existing.saleRateCard);
        return [
            {
                id: uniqueLogicalModelId(existing.id, usedModelIds),
                name: text(existing.name, 120) || bindings[0].upstreamModel,
                capability,
                enabled: existing.enabled !== false,
                ...(saleRateCard ? { saleRateCard } : {}),
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
        const bindings = catalog.map((binding) => normalizedCatalogBinding(binding)).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        return {
            id: uniqueLogicalModelId(catalog[0].upstreamModel, usedModelIds),
            name: rawModelName(catalog[0].upstreamModel),
            capability,
            enabled: true,
            bindings,
        };
    });
    return [...preserved, ...created];
}

export function mergeChannelModelsIntoLogicalModels(logicalModels: LogicalModel[], channels: SystemModelChannel[]) {
    return synchronizeLogicalModelsWithChannels(logicalModels, channels);
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
    return new Set(channel.models.filter(isCreativeGenerationModel).map((model) => channelModelCapability(channel, model)));
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

function normalizedCatalogBinding(catalog: { channel: SystemModelChannel; channelIndex: number; upstreamModel: string }, stored?: LogicalModelBinding): LogicalModelBinding {
    const capabilityProfile = normalizeStoredCapabilityProfile(stored?.capabilityProfile);
    const generationParameters = normalizeGenerationParameters(stored?.generationParameters);
    const weight = clampWeight(stored?.weight);
    const costRateCard = stored?.costRateCard === undefined ? undefined : validatePricingRateCard(stored.costRateCard);
    const providerCostUnit = stored?.providerCostUnit === undefined ? undefined : validateProviderCostUnit(stored.providerCostUnit);
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
        ...(costRateCard ? { costRateCard } : {}),
        ...(providerCostUnit ? { providerCostUnit } : {}),
    };
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
        concurrencyLimit: positiveInteger(input.concurrencyLimit),
        maxInputTokens: positiveInteger(input.maxInputTokens),
        maxOutputTokens: positiveInteger(input.maxOutputTokens),
        supportsIdempotency: optionalBoolean(input.supportsIdempotency),
        unitCost: positiveNumber(input.unitCost),
        unitCostCurrency: text(input.unitCostCurrency, 12) || undefined,
    };
    return Object.values(profile).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0)) ? profile : undefined;
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
