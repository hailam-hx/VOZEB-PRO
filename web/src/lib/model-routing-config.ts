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
    const catalog = new Map<
        string,
        {
            upstreamModel: string;
            capability: LogicalModelCapability;
            authoritative: boolean;
            bindings: Array<{ channel: SystemModelChannel; channelIndex: number; upstreamModel: string }>;
        }
    >();
    channels.forEach((channel, channelIndex) => {
        channel.models.forEach((upstreamModel) => {
            const id = rawModelName(upstreamModel);
            if (!id || !isCreativeGenerationModel(id)) return;
            const key = normalizeModelName(id);
            const detected = resolveChannelModelCapability(channel, upstreamModel);
            const model = catalog.get(key) || { upstreamModel: id, capability: detected.capability, authoritative: detected.authoritative, bindings: [] };
            if ((!model.authoritative && detected.authoritative) || (model.capability === "text" && detected.capability !== "text")) {
                model.capability = detected.capability;
                model.authoritative = detected.authoritative;
            }
            if (!model.bindings.some((binding) => binding.channel.id === channel.id)) model.bindings.push({ channel, channelIndex, upstreamModel });
            catalog.set(key, model);
        });
    });

    const usedExistingIds = new Set<string>();
    const usedModelIds = new Set<string>();
    return Array.from(catalog.entries()).map(([modelKey, catalogModel]) => {
        const matchingModels = existingModels.filter((model) => model.bindings?.some((binding) => normalizeModelName(binding.upstreamModel) === modelKey));
        const existing = matchingModels.find((model) => normalizeModelName(model.id) === modelKey && !usedExistingIds.has(model.id.toLowerCase())) || matchingModels.find((model) => !usedExistingIds.has(model.id.toLowerCase()));
        if (existing) usedExistingIds.add(existing.id.toLowerCase());
        const id = uniqueLogicalModelId(existing?.id || catalogModel.upstreamModel, usedModelIds);
        const bindings = catalogModel.bindings
            .map(({ channel, channelIndex, upstreamModel }) => {
                const stored = findStoredBinding(existingModels, channel.id, upstreamModel);
                const capabilityProfile = normalizeStoredCapabilityProfile(stored?.capabilityProfile);
                const generationParameters = normalizeGenerationParameters(stored?.generationParameters);
                const weight = clampWeight(stored?.weight);
                const costRateCard = stored?.costRateCard === undefined ? undefined : validatePricingRateCard(stored.costRateCard);
                const providerCostUnit = stored?.providerCostUnit === undefined ? undefined : validateProviderCostUnit(stored.providerCostUnit);
                if (costRateCard && !providerCostUnit) throw new Error("供应商成本价格卡必须指定有效的供应商成本单位");
                return {
                    id: text(stored?.id, 120) || `${channel.id}:${rawModelName(upstreamModel)}`,
                    channelId: channel.id,
                    upstreamModel,
                    enabled: stored?.enabled !== false,
                    priority: clampPriority(stored?.priority, channelIndex + 1),
                    ...(weight !== undefined ? { weight } : {}),
                    ...(capabilityProfile ? { capabilityProfile } : {}),
                    ...(generationParameters ? { generationParameters } : {}),
                    ...(costRateCard ? { costRateCard } : {}),
                    ...(providerCostUnit ? { providerCostUnit } : {}),
                };
            })
            .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
        const saleRateCard = existing?.saleRateCard === undefined ? undefined : validatePricingRateCard(existing.saleRateCard);
        return {
            id,
            name: text(existing?.name, 120) || catalogModel.upstreamModel,
            capability: catalogModel.authoritative || !existing ? catalogModel.capability : normalizeCapability(existing.capability),
            enabled: existing?.enabled !== false,
            ...(saleRateCard ? { saleRateCard } : {}),
            bindings,
        };
    });
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
    const errors: string[] = [];
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
            const bindingKey = `${binding.channelId}:${normalizeModelName(binding.upstreamModel)}`;
            if (!channel) errors.push(`逻辑模型 ${model.id} 引用了不存在的渠道`);
            else if (!channelSupportsModel(channel, binding.upstreamModel)) errors.push(`渠道 ${channel.name} 未启用上游模型 ${binding.upstreamModel}`);
            if (bindingKeys.has(bindingKey)) errors.push(`逻辑模型 ${model.id} 存在重复绑定`);
            bindingKeys.add(bindingKey);
        }
    }
    for (const { capability, key, audioOperation } of DEFAULT_MODEL_SPECS) {
        const modelId = defaults[key];
        if (modelId && !isLogicalModelResolvable(logicalModels, channels, capability, modelId, audioOperation)) errors.push(`默认${key === "voiceCloneModel" ? "声音克隆" : capabilityLabel(capability)}模型不可解析：${modelId}`);
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

function findStoredBinding(models: LogicalModel[], channelId: string, upstreamModel: string) {
    const modelKey = normalizeModelName(upstreamModel);
    return models.flatMap((model) => model.bindings || []).find((binding) => binding.channelId === channelId && normalizeModelName(binding.upstreamModel) === modelKey);
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
