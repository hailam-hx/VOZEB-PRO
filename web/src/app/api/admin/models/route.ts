import { hasAdminPermission } from "@/lib/admin-permissions";
import { NextResponse } from "next/server";

import { AGNES_RECOMMENDED_CONFIG, isAgnesApiBaseUrl } from "@/lib/agnes-model-catalog";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { buildGlobalAiOpcSelection, getGlobalAiOpcPresetForModel, isGlobalAiOpcBaseUrl, resolveGlobalAiOpcCatalogPresets } from "@/lib/globalaiopc-catalog";
import { inferModelCapability, normalizeModelId } from "@/lib/model-capability";
import { isProviderTimeoutError, resolveAdminChannelCredentials, sanitizeProviderMessage } from "@/lib/server/admin-channel-config";
import {
    buildModelCatalogUrls,
    configuredModelCatalog,
    mergeDflopModelDiscovery,
    isModelCatalogUnsupported,
    mergeModelCatalogEntries,
    mergeModelConfigs,
    modelConfigsFromOperations,
    modelCapabilitiesRecord,
    nextModelsPageUrl,
    normalizeModelConfigs,
    officialModelCatalog,
    officialModelConfigs,
    parseModelCatalog,
    parseModelConfigs,
} from "@/lib/server/admin-model-catalog";
import { isProviderBusinessError, readProviderError } from "@/lib/server/provider-task-config";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { isSafeOutboundUrl } from "@/lib/server/security";
import { channelProtocolDefinition, protocolAuthHeaders, protocolModelConfig, resolveChannelAuthMode } from "@/lib/channel-protocol-registry";
import type { SystemChannelAdvancedConfig, SystemChannelProtocol } from "@/lib/auth/store";
import { dflopModelSyncStats, synchronizeLogicalModelsWithChannels } from "@/lib/model-routing-config";
import { buildDflopPricingSync, type DflopPricingSyncResult } from "@/lib/server/dflop-pricing-sync-service";
import { normalizeSystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { calculateSuggestedSaleRateCard } from "@/lib/billing/suggested-model-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type ModelsPayload = {
    channelId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    apiFormat?: unknown;
    protocol?: unknown;
    authMode?: unknown;
    authHeader?: unknown;
    authPrefix?: unknown;
    globalAiOpcPreset?: unknown;
    globalAiOpcPresets?: unknown;
    createPath?: unknown;
    modelCatalogPaths?: unknown;
    configuredModels?: unknown;
    modelCapabilities?: unknown;
    modelConfigs?: unknown;
    operationConfigs?: unknown;
};

type ModelsResponse = Record<string, unknown> & {
    error?: { message?: string };
    msg?: string;
};

const MODEL_FETCH_COOLDOWN_MS = 30_000;
const MODEL_FETCH_TIMEOUT_MS = 60_000;
const MODEL_FETCH_MAX_PAGES = 20;
const DFLOP_PUBLIC_REGISTRY_WARNING = "DFLOP 公共模型元数据不可用，已保留 /v1/models 全部模型并使用后备分类。";
const globalCooldownStore = globalThis as typeof globalThis & { __vozebProModelFetchCooldowns?: Map<string, number> };
const modelFetchCooldowns = (globalCooldownStore.__vozebProModelFetchCooldowns ??= new Map<string, number>());

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "upstream.manage")) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const [body, settings] = await Promise.all([readJsonBody<ModelsPayload>(request), getAuthSettings()]);
    const { baseUrl, apiKey, apiFormat, savedChannel } = resolveAdminChannelCredentials(settings, body);
    if (!baseUrl) return NextResponse.json({ error: "请先填写 Base URL 和 API Key" }, { status: 400 });

    const advancedConfig = {
        ...(savedChannel?.advancedConfig || {}),
        ...(body.protocol !== undefined ? { protocol: body.protocol } : {}),
        ...(body.authMode !== undefined ? { authMode: body.authMode } : {}),
        ...(body.authHeader !== undefined ? { authHeader: body.authHeader } : {}),
        ...(body.authPrefix !== undefined ? { authPrefix: body.authPrefix } : {}),
        ...(body.globalAiOpcPreset !== undefined ? { globalAiOpcPreset: body.globalAiOpcPreset } : {}),
        ...(body.globalAiOpcPresets !== undefined ? { globalAiOpcPresets: body.globalAiOpcPresets } : {}),
        ...(body.createPath !== undefined ? { createPath: body.createPath } : {}),
    } as SystemChannelAdvancedConfig;
    const configuredModels = body.configuredModels !== undefined ? body.configuredModels : savedChannel?.models;
    const configuredCapabilities = body.modelCapabilities !== undefined ? body.modelCapabilities : savedChannel?.advancedConfig?.modelCapabilities;
    const configuredConfigs = normalizeModelConfigs(body.modelConfigs !== undefined ? body.modelConfigs : savedChannel?.advancedConfig?.modelConfigs);
    const configuredCatalog = configuredModelCatalog(configuredModels, configuredCapabilities, configuredConfigs);
    const operationConfigs = body.operationConfigs !== undefined ? body.operationConfigs : savedChannel?.advancedConfig?.operationConfigs;
    const protocol = (typeof body.protocol === "string" ? body.protocol : advancedConfig.protocol || "auto") as SystemChannelProtocol;
    const protocolDefinition = channelProtocolDefinition(protocol);
    const configuredForMerge = protocol === "dflop" ? [] : configuredCatalog;
    advancedConfig.protocol = protocolDefinition.id;
    advancedConfig.authMode = resolveChannelAuthMode(advancedConfig);
    if (!apiKey && advancedConfig.authMode !== "none") return NextResponse.json({ error: "请先填写 Base URL 和 API Key" }, { status: 400 });
    const modelCatalogPaths = protocol === "dflop" ? protocolDefinition.modelCatalogPaths : (body.modelCatalogPaths ?? savedChannel?.advancedConfig?.modelCatalogPaths ?? protocolDefinition.modelCatalogPaths);
    const hasConfiguredCatalog = Array.isArray(modelCatalogPaths) && modelCatalogPaths.some((path) => typeof path === "string" && path.trim());

    if (protocolDefinition.builtInModels?.length && !hasConfiguredCatalog) {
        const builtInCatalog = protocolDefinition.builtInModels.map(({ id, capability }) => ({ id, capability, source: "official" as const }));
        const merged = mergeModelCatalogEntries(configuredCatalog, builtInCatalog);
        const builtInConfigs = Object.fromEntries(
            protocolDefinition.builtInModels.flatMap(({ id, capability }) => {
                const config = protocolModelConfig(protocol, capability, id);
                return config ? [[normalizeModelId(id), config] as const] : [];
            }),
        );
        const modelConfigs = mergeModelConfigs(merged, configuredConfigs, modelConfigsFromOperations(merged, operationConfigs), builtInConfigs);
        return NextResponse.json({
            models: merged.map((entry) => entry.id),
            modelCapabilities: modelCapabilitiesRecord(merged, modelConfigs),
            modelConfigs,
            discoveredCount: builtInCatalog.length,
            totalCount: merged.length,
            catalogSupported: false,
            provider: protocol,
        });
    }

    if (protocol === "yumeng" && !hasConfiguredCatalog) {
        return NextResponse.json({ error: "昱梦新版只确认了 V2 任务接口，官方文档未提供 V2 模型目录；系统不会降级请求 /v1/models。请先手动填写模型 ID，或在上游确认 V2 模型目录路径后再同步。" }, { status: 422 });
    }

    const globalAiOpcPresets = resolveGlobalAiOpcCatalogPresets(baseUrl, advancedConfig);
    if (globalAiOpcPresets.length) {
        const selection = buildGlobalAiOpcSelection(globalAiOpcPresets.map((preset) => preset.id));
        const discovered = selection.models.map((id) => ({ id, capability: getGlobalAiOpcPresetForModel(id)?.capability || inferModelCapability(id), source: "official" as const }));
        const merged = mergeModelCatalogEntries(configuredCatalog, discovered);
        const modelConfigs = mergeModelConfigs(merged, configuredConfigs, modelConfigsFromOperations(merged, operationConfigs));
        return NextResponse.json({
            models: merged.map((entry) => entry.id),
            modelCapabilities: modelCapabilitiesRecord(merged, modelConfigs),
            modelConfigs,
            discoveredCount: discovered.length,
            totalCount: merged.length,
            globalAiOpcPresets: selection.presetIds,
        });
    }
    if (advancedConfig.protocol === "globalaiopc" || isGlobalAiOpcBaseUrl(baseUrl)) return NextResponse.json({ error: "未识别到 GlobalAiOpc 接口范围，请检查 Base URL 或重新选择接口范围" }, { status: 400 });

    if (!(await isSafeOutboundUrl(baseUrl))) return NextResponse.json({ error: "Base URL 不允许访问内网或保留地址" }, { status: 400 });
    const modelCatalogUrls = buildModelCatalogUrls(baseUrl, apiFormat, modelCatalogPaths);
    if (!modelCatalogUrls.length) return NextResponse.json({ error: "模型目录路径必须与 Base URL 同源" }, { status: 400 });

    const cooldownKey = `${currentUser.id}:${baseUrl.toLowerCase()}`;
    const waitMs = (modelFetchCooldowns.get(cooldownKey) || 0) - Date.now();
    if (waitMs > 0) return NextResponse.json({ error: `拉取模型过于频繁，请 ${Math.ceil(waitMs / 1000)} 秒后再试` }, { status: 429 });
    modelFetchCooldowns.set(cooldownKey, Date.now() + MODEL_FETCH_COOLDOWN_MS);

    try {
        const providerCatalog = [] as ReturnType<typeof parseModelCatalog>;
        let providerConfigs = {} as ReturnType<typeof parseModelConfigs>;
        let catalogSucceeded = false;
        const visited = new Set<string>();

        for (const catalogUrl of modelCatalogUrls) {
            let nextUrl = catalogUrl;
            for (let page = 0; nextUrl && page < MODEL_FETCH_MAX_PAGES && !visited.has(nextUrl); page += 1) {
                visited.add(nextUrl);
                const response = await fetchSafeOutbound(nextUrl, {
                    headers: protocolAuthHeaders(apiKey, advancedConfig, apiFormat),
                    cache: "no-store",
                    signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
                });
                const payload = (await response.json().catch(() => ({}))) as ModelsResponse;
                if (!response.ok || isProviderBusinessError(payload)) {
                    if (isModelCatalogUnsupported(response.status, payload) || [404, 405, 501].includes(response.status)) break;
                    modelFetchCooldowns.delete(cooldownKey);
                    return NextResponse.json({ error: sanitizeProviderMessage(readProviderError(payload) || payload.msg || payload.error?.message || `拉取模型失败：${response.status}`, [apiKey]) }, { status: 502 });
                }
                catalogSucceeded = true;
                const pageCatalog = parseModelCatalog(payload, "provider", protocol);
                providerCatalog.splice(0, providerCatalog.length, ...mergeModelCatalogEntries(providerCatalog, pageCatalog));
                providerConfigs = { ...providerConfigs, ...parseModelConfigs(payload, protocol) };
                nextUrl = nextModelsPageUrl(nextUrl, payload, apiFormat, pageCatalog.at(-1)?.id || providerCatalog.at(-1)?.id || "");
            }
        }

        let dflopDiscovery: ReturnType<typeof mergeDflopModelDiscovery> | undefined;
        let dflopPricingSync: DflopPricingSyncResult | undefined;
        let dflopWarning = "";
        if (protocol === "dflop") {
            if (!catalogSucceeded) {
                modelFetchCooldowns.delete(cooldownKey);
                return NextResponse.json({ error: "DFLOP 的 /v1/models 未返回可用目录；请手动填写模型 ID 并指定能力。" }, { status: 422 });
            }
            const metadataUrl = new URL("/api/v1/models/public", baseUrl).toString();
            let publicPayload: unknown;
            try {
                const metadataResponse = await fetchSafeOutbound(metadataUrl, {
                    headers: { accept: "application/json", "user-agent": "HOTX-AI-DFLOP-Discovery" },
                    cache: "no-store",
                    signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
                });
                if (metadataResponse.ok) {
                    const parsed = await metadataResponse.json().catch(() => undefined);
                    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).models)) publicPayload = parsed;
                    else dflopWarning = DFLOP_PUBLIC_REGISTRY_WARNING;
                } else {
                    dflopWarning = DFLOP_PUBLIC_REGISTRY_WARNING;
                    console.debug("DFLOP public model registry unavailable", { status: metadataResponse.status });
                }
            } catch (error) {
                dflopWarning = DFLOP_PUBLIC_REGISTRY_WARNING;
                console.debug("DFLOP public model registry fetch failed", sanitizeProviderMessage(error, [apiKey]));
            }
            let currencyPayload: unknown;
            const currencyUrl = new URL("/api/v1/config/currency", baseUrl).toString();
            try {
                const currencyResponse = await fetchSafeOutbound(currencyUrl, {
                    headers: { accept: "application/json", "user-agent": "HOTX-AI-DFLOP-Discovery" },
                    cache: "no-store",
                    signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
                });
                if (currencyResponse.ok) currencyPayload = await currencyResponse.json().catch(() => undefined);
                else console.debug("DFLOP currency config unavailable", { status: currencyResponse.status });
            } catch (error) {
                console.debug("DFLOP currency config fetch failed", sanitizeProviderMessage(error, [apiKey]));
            }
            dflopDiscovery = mergeDflopModelDiscovery(providerCatalog, publicPayload);
            const currentProfiles = Object.fromEntries(
                (settings.logicalModels || []).flatMap((model) =>
                    model.bindings.flatMap((binding) => {
                        if (savedChannel?.id && binding.channelId !== savedChannel.id) return [];
                        const profile = binding.providerPricingProfile;
                        return profile?.provider === "dflop" ? [[normalizeModelId(binding.upstreamModel), profile] as const] : [];
                    }),
                ),
            );
            dflopPricingSync = buildDflopPricingSync({
                visibleModelIds: dflopDiscovery.models,
                publicPayload,
                currencyPayload,
                currentPolicy: normalizeSystemPricingPolicy(settings.pricingPolicy),
                currentProfiles,
                syncedAt: new Date().toISOString(),
            });
            providerCatalog.splice(0, providerCatalog.length, ...dflopDiscovery.catalog);
            providerConfigs = {};
            if (dflopDiscovery.unmatchedIds.length) console.debug("DFLOP model discovery unmatched ids", dflopDiscovery.unmatchedIds);
        }

        const officialCatalog = protocol === "dflop" ? [] : officialModelCatalog(baseUrl);
        const discovered = mergeModelCatalogEntries(providerCatalog, officialCatalog);
        const merged = mergeModelCatalogEntries(configuredForMerge, providerCatalog, officialCatalog);
        if (!merged.length) {
            modelFetchCooldowns.delete(cooldownKey);
            if (!catalogSucceeded) return NextResponse.json({ error: "该上游未提供模型列表接口，请在高级设置的“模型列表”手动填写模型名称；手工模型会在后续拉取时保留。" }, { status: 422 });
            return NextResponse.json({ error: "接口请求成功，但返回内容中没有识别到模型列表" }, { status: 502 });
        }

        const agnes = isAgnesApiBaseUrl(baseUrl);
        const strictConfigs = Object.fromEntries(
            merged.flatMap((entry) => {
                if (!protocolDefinition.strict) return [];
                const configuredProtocol = configuredConfigs[normalizeModelId(entry.id)]?.protocol;
                if (configuredProtocol && configuredProtocol !== protocol) return [];
                const config = protocolModelConfig(protocol, entry.capability, entry.id);
                return config ? [[normalizeModelId(entry.id), config] as const] : [];
            }),
        );
        const modelConfigs = mergeModelConfigs(merged, configuredConfigs, modelConfigsFromOperations(merged, operationConfigs), providerConfigs, officialModelConfigs(baseUrl), strictConfigs);
        const previewPricingPolicy = dflopPricingSync?.pricingPolicyPatch || normalizeSystemPricingPolicy(settings.pricingPolicy);
        const previewChannel = dflopDiscovery
            ? {
                  ...(savedChannel || { id: typeof body.channelId === "string" ? body.channelId : "dflop-preview", name: "DFLOP", enabled: true }),
                  baseUrl,
                  apiKey,
                  apiFormat,
                  models: dflopDiscovery.models,
                  advancedConfig: { ...advancedConfig, modelCapabilities: modelCapabilitiesRecord(merged, modelConfigs), modelConfigs, modelDiscovery: dflopDiscovery.modelDiscovery },
              }
            : undefined;
        const dflopSyncStats = dflopDiscovery ? dflopModelSyncStats(settings.logicalModels || [], settings.systemChannels || [], previewChannel!, previewPricingPolicy) : undefined;
        if (dflopPricingSync && previewChannel) {
            const previewChannels = (settings.systemChannels || []).some((channel) => channel.id === previewChannel.id)
                ? (settings.systemChannels || []).map((channel) => (channel.id === previewChannel.id ? previewChannel : channel))
                : [...(settings.systemChannels || []), previewChannel];
            const previewModels = synchronizeLogicalModelsWithChannels(settings.logicalModels || [], previewChannels, previewPricingPolicy);
            dflopPricingSync.stats.belowCostWarnings = previewModels.reduce(
                (count, model) =>
                    count +
                    calculateSuggestedSaleRateCard({
                        model,
                        channels: previewChannels,
                        policy: previewPricingPolicy,
                        calculatedAt: dflopPricingSync.profiles[normalizeModelId(model.bindings[0]?.upstreamModel || "")]?.syncedAt || new Date().toISOString(),
                    }).warnings.filter((warning) => warning.code === "BELOW_COST").length,
                0,
            );
        }
        if (dflopDiscovery && dflopSyncStats) {
            const syncLog = {
                visibleModels: dflopDiscovery.stats.upstreamModels,
                registryModels: dflopDiscovery.stats.publicRegistry,
                matched: dflopDiscovery.stats.matched,
                unmatched: dflopDiscovery.stats.unmatched,
                created: dflopSyncStats.created,
                updated: dflopSyncStats.updated,
                manualOverridesPreserved: dflopSyncStats.manualOverridesPreserved,
                capabilityDrifts: dflopSyncStats.capabilityDrifts,
                imageQualityProfiles: JSON.stringify(dflopSyncStats.imageQualityProfiles),
                metadataFallbacks: dflopDiscovery.stats.unmatched,
            };
            console.info(
                `DFLOP model sync: ${Object.entries(syncLog)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(" ")}`,
            );
            for (const changed of dflopSyncStats.changedModels) console.debug("DFLOP model sync detail", changed);
            if (dflopPricingSync) {
                console.info(
                    `DFLOP pricing sync: ${Object.entries(dflopPricingSync.stats)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(" ")}`,
                );
            }
        }
        return NextResponse.json({
            models: dflopDiscovery?.models || merged.map((entry) => entry.id),
            modelCapabilities: modelCapabilitiesRecord(merged, modelConfigs),
            modelConfigs,
            ...(dflopDiscovery ? { modelDiscovery: dflopDiscovery.modelDiscovery, discoveryStats: dflopDiscovery.stats } : {}),
            ...(dflopPricingSync
                ? { pricingSync: { profiles: dflopPricingSync.profiles, stats: dflopPricingSync.stats, warnings: dflopPricingSync.warnings }, ...(dflopPricingSync.pricingPolicyPatch ? { pricingPolicyPatch: dflopPricingSync.pricingPolicyPatch } : {}) }
                : {}),
            ...(dflopSyncStats
                ? {
                      syncStats: {
                          created: dflopSyncStats.created,
                          updated: dflopSyncStats.updated,
                          manualOverridesPreserved: dflopSyncStats.manualOverridesPreserved,
                          capabilityDrifts: dflopSyncStats.capabilityDrifts,
                          imageQualityProfiles: dflopSyncStats.imageQualityProfiles,
                          metadataFallbacks: dflopDiscovery?.stats.unmatched || 0,
                      },
                  }
                : {}),
            discoveredCount: dflopDiscovery?.models.length ?? discovered.length,
            totalCount: dflopDiscovery?.models.length ?? merged.length,
            catalogSupported: catalogSucceeded,
            ...(dflopWarning ? { warning: dflopWarning } : !catalogSucceeded ? { warning: "上游未公开模型目录，已保留现有手工模型。" } : {}),
            ...(agnes ? { provider: "agnes", recommendedConfig: AGNES_RECOMMENDED_CONFIG } : {}),
        });
    } catch (error) {
        modelFetchCooldowns.delete(cooldownKey);
        console.error("Admin model fetch failed", sanitizeProviderMessage(error, [apiKey]));
        return NextResponse.json({ error: isProviderTimeoutError(error) ? "拉取模型超时，请稍后重试" : "拉取模型失败，请检查接口地址和网络" }, { status: 502 });
    }
}
