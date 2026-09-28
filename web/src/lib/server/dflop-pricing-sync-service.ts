import { decimal } from "@/lib/billing/decimal";
import type { ProviderPricingProfile } from "@/lib/billing/provider-pricing";
import { normalizeSystemPricingPolicy, parseDflopCurrencyConfig, type SystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { parseDflopPricing } from "@/lib/dflop-pricing";
import { normalizeModelId } from "@/lib/model-capability";
import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store-types";
import { calculateSuggestedSaleRateCard } from "@/lib/billing/suggested-model-pricing";

export type DflopPricingSyncWarning = {
    code: "PUBLIC_REGISTRY_UNAVAILABLE" | "CURRENCY_UNAVAILABLE" | "MODEL_METADATA_MISSING" | "BELOW_COST";
    message: string;
    modelId?: string;
};

export type DflopPricingSyncStats = {
    models: number;
    pricingProfiles: number;
    created: number;
    updated: number;
    unchanged: number;
    priceIncreases: number;
    priceDecreases: number;
    unchangedDimensions: number;
    missingPricing: number;
    unknownPricingFields: number;
    manualOverridesPreserved: number;
    belowCostWarnings: number;
};

export type DflopPricingSyncResult = {
    profiles: Record<string, ProviderPricingProfile>;
    pricingPolicyPatch?: SystemPricingPolicy;
    stats: DflopPricingSyncStats;
    warnings: DflopPricingSyncWarning[];
};

export type DflopPricingAuditSummary = {
    models: number;
    pricingProfiles: number;
    priceIncreases: number;
    priceDecreases: number;
    unchangedDimensions: number;
    missingPricing: number;
    unknownPricingFields: number;
    manualOverridesPreserved: number;
    belowCostWarnings: number;
    pricingPolicyVersion: string;
    changes: Array<{ modelId: string; bindingId: string; dimensionId: string; oldValue?: string; newValue?: string; oldSource?: "upstream" | "manual"; newSource?: "upstream" | "manual" }>;
};

const AUDIT_CHANGE_LIMIT = 30;

export function buildDflopPricingAuditSummary(before: LogicalModel[], after: LogicalModel[], channels: SystemModelChannel[], policy: SystemPricingPolicy): DflopPricingAuditSummary {
    const previous = pricingDimensions(before);
    const current = pricingDimensions(after);
    let priceIncreases = 0;
    let priceDecreases = 0;
    let unchangedDimensions = 0;
    const changes: DflopPricingAuditSummary["changes"] = [];
    for (const [key, next] of current.dimensions) {
        const old = previous.dimensions.get(key);
        if (old) {
            const nextValue = decimal(next.upstreamValue ?? next.effectiveValue);
            const oldValue = decimal(old.upstreamValue ?? old.effectiveValue);
            if (nextValue.greaterThan(oldValue)) priceIncreases += 1;
            else if (oldValue.greaterThan(nextValue)) priceDecreases += 1;
            else unchangedDimensions += 1;
        }
        if (!old || old.upstreamValue !== next.upstreamValue || old.effectiveValue !== next.effectiveValue || old.source !== next.source) {
            if (changes.length < AUDIT_CHANGE_LIMIT) {
                changes.push({
                    modelId: next.modelId,
                    bindingId: next.bindingId,
                    dimensionId: next.dimensionId,
                    ...(old ? { oldValue: old.effectiveValue, oldSource: old.source } : {}),
                    newValue: next.effectiveValue,
                    newSource: next.source,
                });
            }
        }
    }
    for (const [key, old] of previous.dimensions) {
        if (current.dimensions.has(key) || changes.length >= AUDIT_CHANGE_LIMIT) continue;
        changes.push({ modelId: old.modelId, bindingId: old.bindingId, dimensionId: old.dimensionId, oldValue: old.effectiveValue, oldSource: old.source });
    }
    const belowCostWarnings = after.reduce(
        (total, model) => total + calculateSuggestedSaleRateCard({ model, channels, policy, calculatedAt: model.suggestedSaleRateCard?.calculatedAt || "1970-01-01T00:00:00.000Z" }).warnings.filter((warning) => warning.code === "BELOW_COST").length,
        0,
    );
    return {
        models: current.models.size,
        pricingProfiles: current.profiles.length,
        priceIncreases,
        priceDecreases,
        unchangedDimensions,
        missingPricing: current.profiles.filter((profile) => !profile.dimensions.length || profile.missingFields.length > 0).length,
        unknownPricingFields: current.profiles.reduce((total, profile) => total + profile.unknownFields.length, 0),
        manualOverridesPreserved: current.profiles.reduce((total, profile) => total + profile.dimensions.filter((dimension) => dimension.source === "manual").length, 0),
        belowCostWarnings,
        pricingPolicyVersion: policy.version,
        changes,
    };
}

function pricingDimensions(models: LogicalModel[]) {
    const dimensions = new Map<string, { modelId: string; bindingId: string; dimensionId: string; upstreamValue?: string; effectiveValue: string; source: "upstream" | "manual" }>();
    const profiles: ProviderPricingProfile[] = [];
    const modelIds = new Set<string>();
    for (const model of models) {
        for (const binding of model.bindings) {
            const profile = binding.providerPricingProfile;
            if (profile?.provider !== "dflop") continue;
            modelIds.add(model.id);
            profiles.push(profile);
            for (const dimension of profile.dimensions) {
                dimensions.set(`${model.id}\0${binding.id}\0${dimension.id}`, {
                    modelId: model.id,
                    bindingId: binding.id,
                    dimensionId: dimension.id,
                    ...(dimension.upstreamValue !== undefined ? { upstreamValue: dimension.upstreamValue } : {}),
                    effectiveValue: dimension.effectiveValue,
                    source: dimension.source,
                });
            }
        }
    }
    return { dimensions, profiles, models: modelIds };
}

export function buildDflopPricingSync(input: {
    visibleModelIds: string[];
    publicPayload: unknown;
    currencyPayload?: unknown;
    currentPolicy: SystemPricingPolicy;
    currentProfiles: Record<string, ProviderPricingProfile | undefined>;
    syncedAt: string;
    belowCostWarnings?: number;
}): DflopPricingSyncResult {
    const visible = new Map<string, string>();
    for (const id of input.visibleModelIds) {
        const key = normalizeModelId(id);
        if (key && !visible.has(key)) visible.set(key, id.trim().replace(/^models\//i, ""));
    }
    const registry = publicRegistry(input.publicPayload);
    const warnings: DflopPricingSyncWarning[] = [];
    if (!registry) warnings.push({ code: "PUBLIC_REGISTRY_UNAVAILABLE", message: "DFLOP 公共价格目录不可用，已保留 API Key 可见模型。" });

    const currency = parseDflopCurrencyConfig(input.currencyPayload);
    let pricingPolicyPatch: SystemPricingPolicy | undefined;
    if (!currency) {
        warnings.push({ code: "CURRENCY_UNAVAILABLE", message: "DFLOP currency 配置不可用，保留当前 credits/CNY 配置。" });
    } else if (input.currentPolicy.dflopCreditsPerCnySource !== "manual") {
        pricingPolicyPatch = normalizeSystemPricingPolicy({ ...input.currentPolicy, dflopCreditsPerCny: currency.creditsPerCny, dflopCreditsPerCnySource: "upstream", dflopCurrencyConfigVersion: currency.version });
    }

    const profiles: Record<string, ProviderPricingProfile> = {};
    let missingPricing = 0;
    let unknownPricingFields = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let priceIncreases = 0;
    let priceDecreases = 0;
    let unchangedDimensions = 0;
    let manualOverridesPreserved = 0;
    for (const [key, modelId] of visible) {
        const metadata = registry?.get(key);
        if (!metadata) {
            missingPricing += 1;
            if (registry) warnings.push({ code: "MODEL_METADATA_MISSING", modelId, message: `DFLOP 公共目录中找不到 API Key 可见模型 ${modelId}` });
            continue;
        }
        const category = typeof metadata.category === "string" ? metadata.category : undefined;
        const endpointType = metadata.endpoint_type === null ? null : typeof metadata.endpoint_type === "string" ? metadata.endpoint_type : undefined;
        const profile = parseDflopPricing(metadata, { modelId, category, endpointType, syncedAt: input.syncedAt });
        profiles[key] = profile;
        unknownPricingFields += profile.unknownFields.length;
        if (!profile.dimensions.length) missingPricing += 1;
        const previous = input.currentProfiles[key];
        manualOverridesPreserved += previous?.dimensions.filter((dimension) => dimension.source === "manual").length || 0;
        if (!previous) created += 1;
        else if (profileFingerprint(previous) === profileFingerprint(profile)) unchanged += 1;
        else updated += 1;
        if (previous) {
            const previousById = new Map(previous.dimensions.map((dimension) => [dimension.id, dimension.upstreamValue ?? dimension.effectiveValue]));
            for (const dimension of profile.dimensions) {
                const oldValue = previousById.get(dimension.id);
                if (oldValue === undefined) continue;
                try {
                    const oldAmount = decimal(oldValue);
                    const newAmount = decimal(dimension.upstreamValue ?? dimension.effectiveValue);
                    if (newAmount.greaterThan(oldAmount)) priceIncreases += 1;
                    else if (oldAmount.greaterThan(newAmount)) priceDecreases += 1;
                    else unchangedDimensions += 1;
                } catch {
                    // The parser already reports invalid values; comparison never blocks discovery.
                }
            }
        }
    }

    return {
        profiles,
        ...(pricingPolicyPatch ? { pricingPolicyPatch } : {}),
        stats: {
            models: visible.size,
            pricingProfiles: Object.keys(profiles).length,
            created,
            updated,
            unchanged,
            priceIncreases,
            priceDecreases,
            unchangedDimensions,
            missingPricing,
            unknownPricingFields,
            manualOverridesPreserved,
            belowCostWarnings: input.belowCostWarnings || 0,
        },
        warnings,
    };
}

function publicRegistry(payload: unknown) {
    if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).models)) return undefined;
    const registry = new Map<string, Record<string, unknown>>();
    for (const value of (payload as { models: unknown[] }).models) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const metadata = value as Record<string, unknown>;
        const id = typeof metadata.id === "string" ? metadata.id : typeof metadata.model === "string" ? metadata.model : "";
        const key = normalizeModelId(id);
        if (key && !registry.has(key)) registry.set(key, metadata);
    }
    return registry;
}

function profileFingerprint(profile: ProviderPricingProfile) {
    return JSON.stringify({
        raw: profile.raw,
        dimensions: profile.dimensions.map(({ id, kind, key, unit, upstreamValue, effectiveValue, conditions }) => ({ id, kind, key, unit, upstreamValue, effectiveValue, conditions })),
        unknownFields: profile.unknownFields,
    });
}
