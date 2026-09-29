import { NextResponse } from "next/server";

import { AuthInputError, getFreshAuthSettings, isAuthInputError, setAuthSettings, type AuthSettings, type SiteCustomerServiceSettings, type SiteSocialKey, type SiteSocialSettings } from "@/lib/auth/store";
import { normalizeEmail, normalizeSiteSocial, validateEmail } from "@/lib/auth/store-normalizers";
import { modelBindingAssignmentValidationErrors, modelRoutingValidationErrors, normalizeDefaultModelsConfig, synchronizeLogicalModelsWithChannels } from "@/lib/model-routing-config";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { mergeSystemChannelSecrets, serializeAdminSettingsForUser, systemChannelWebhookSecretValidationError } from "@/lib/server/admin-channel-config";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { invalidatePublicSiteSettings } from "@/lib/server/site-metadata";
import { channelProtocolValidationErrors } from "@/lib/channel-protocol-registry";
import { hasAllAdminPermissions, hasAnyAdminPermission, type AdminPermission } from "@/lib/admin-permissions";
import { generationDefaultsValidationError } from "@/lib/generation-defaults-validation";
import { validateGenerationParametersInput } from "@/lib/generation-parameters-admin-validation";
import { buildAdminPricingPolicy } from "@/lib/server/admin-pricing-policy-service";
import { buildDflopPricingAuditSummary } from "@/lib/server/dflop-pricing-sync-service";
import { normalizeSystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { NonTerminatingDecimalError } from "@/lib/billing/decimal";
import { verifyDflopPricingPolicyDraft } from "@/lib/server/dflop-currency-policy-service";
import { normalizeAdminImageQualityProfiles } from "@/lib/server/admin-image-quality-profiles";

export const runtime = "nodejs";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!hasAnyAdminPermission(currentUser)) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    return NextResponse.json({ settings: serializeAdminSettingsForUser(await getFreshAuthSettings(), currentUser) });
}

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (!hasAnyAdminPermission(currentUser)) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<Partial<AuthSettings>>(request);
        const preliminaryPermissions = settingsPermissionsForPatch(body);
        if (!hasAllAdminPermissions(currentUser, preliminaryPermissions)) return NextResponse.json({ error: "当前管理员没有修改这些设置的职责权限" }, { status: 403 });
        const currentSettings = await getFreshAuthSettings();
        const requiredPermissions = settingsPermissionsForPatch(body, currentSettings);
        if (!hasAllAdminPermissions(currentUser, requiredPermissions)) return NextResponse.json({ error: "当前管理员没有修改这些设置的职责权限" }, { status: 403 });
        const customerServiceEmailError = customerServiceEmailValidationError(body.site?.customerService);
        if (customerServiceEmailError) throw new AuthInputError(customerServiceEmailError);
        const socialValidationError = siteSocialValidationError(body.site?.socials);
        if (socialValidationError) throw new AuthInputError(socialValidationError);
        const patch: Partial<AuthSettings> = {};
        if (body.site) patch.site = body.site;
        if (typeof body.registrationEnabled === "boolean") patch.registrationEnabled = body.registrationEnabled;
        if (typeof body.emailRegistrationEnabled === "boolean") patch.emailRegistrationEnabled = body.emailRegistrationEnabled;
        if (body.mail) patch.mail = body.mail;
        if (body.modelPointCosts && typeof body.modelPointCosts === "object") patch.modelPointCosts = body.modelPointCosts;
        if (body.generationPointMultipliers && typeof body.generationPointMultipliers === "object") patch.generationPointMultipliers = body.generationPointMultipliers;
        if (body.generationCostControl && typeof body.generationCostControl === "object") patch.generationCostControl = body.generationCostControl;
        if (body.dataLifecycle && typeof body.dataLifecycle === "object") patch.dataLifecycle = body.dataLifecycle;
        if (body.generationConcurrency && typeof body.generationConcurrency === "object") patch.generationConcurrency = body.generationConcurrency;
        if (Array.isArray(body.systemChannels)) {
            patch.systemChannels = mergeSystemChannelSecrets(body.systemChannels, currentSettings.systemChannels);
            const webhookSecretError = patch.systemChannels.map(systemChannelWebhookSecretValidationError).find(Boolean);
            if (webhookSecretError) throw new AuthInputError(webhookSecretError);
        }
        if (body.pricingPolicy && typeof body.pricingPolicy === "object") {
            patch.pricingPolicy = await verifyDflopPricingPolicyDraft(currentSettings.pricingPolicy, body.pricingPolicy, patch.systemChannels || currentSettings.systemChannels);
        }
        if (Array.isArray(body.systemChannels) || Array.isArray(body.logicalModels) || body.defaultModels) {
            const channels = patch.systemChannels || currentSettings.systemChannels;
            const protocolErrors = channels.flatMap(channelProtocolValidationErrors);
            if (protocolErrors.length) throw new AuthInputError(protocolErrors[0]);
            const sourceLogicalModels = Array.isArray(body.logicalModels) ? normalizeAdminImageQualityProfiles(body.logicalModels) : currentSettings.logicalModels;
            const generationParametersError = sourceLogicalModels
                .flatMap((model) => model.bindings || [])
                .map((binding) => validateGenerationParametersInput(binding.generationParameters))
                .find(Boolean);
            if (generationParametersError) throw new AuthInputError(generationParametersError);
            const assignmentErrors = modelBindingAssignmentValidationErrors(sourceLogicalModels, channels);
            if (assignmentErrors.length) throw new AuthInputError(assignmentErrors[0]);
            const logicalModels = synchronizeLogicalModelsWithChannels(sourceLogicalModels, channels, patch.pricingPolicy || currentSettings.pricingPolicy);
            const defaultModels = { ...currentSettings.defaultModels, ...body.defaultModels };
            const normalizedDefaults = normalizeDefaultModelsConfig(defaultModels, logicalModels, channels);
            const errors = modelRoutingValidationErrors(logicalModels, channels, normalizedDefaults);
            if (errors.length) throw new AuthInputError(errors[0]);
            patch.logicalModels = logicalModels;
            patch.defaultModels = normalizedDefaults;
        }
        if (body.generationDefaults && typeof body.generationDefaults === "object") {
            const generationDefaults = { ...currentSettings.generationDefaults, ...body.generationDefaults };
            const generationDefaultsError = generationDefaultsValidationError(
                {
                    logicalModels: patch.logicalModels || currentSettings.logicalModels,
                    defaultModels: patch.defaultModels || currentSettings.defaultModels,
                    generationDefaults,
                },
                Object.keys(body.generationDefaults) as Array<keyof AuthSettings["generationDefaults"]>,
            );
            if (generationDefaultsError) throw new AuthInputError(generationDefaultsError);
            patch.generationDefaults = body.generationDefaults;
        }
        if (Array.isArray(body.agentSkills)) patch.agentSkills = body.agentSkills;
        if (!Object.keys(patch).length) return NextResponse.json({ error: "没有可更新的设置" }, { status: 400 });

        const settings = await setAuthSettings(patch);
        if (patch.site) invalidatePublicSiteSettings();
        await safeRecordAuditLog({
            action: "admin.settings.update",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "settings", id: "auth" },
            metadata: { fields: Object.keys(patch) },
        });
        if (patch.pricingPolicy) {
            const oldPolicy = normalizeSystemPricingPolicy(currentSettings.pricingPolicy);
            const changedFields = ["cnyToUsd", "hotxUsdPerCredit", "markupMultiplier", "minimumMarginRate", "costBasis", "autoApplySalePrice"].filter(
                (field) => oldPolicy[field as keyof typeof oldPolicy] !== patch.pricingPolicy?.[field as keyof typeof patch.pricingPolicy],
            );
            await safeRecordAuditLog({
                action: "admin.billing.pricing_policy.update",
                actor: auditActorFromRequest(request, currentUser),
                target: { type: "settings", id: "pricing_policy" },
                metadata: {
                    oldVersion: oldPolicy.version,
                    newVersion: patch.pricingPolicy.version,
                    changedFields,
                    oldValues: Object.fromEntries(changedFields.map((field) => [field, oldPolicy[field as keyof typeof oldPolicy] ?? null])),
                    newValues: Object.fromEntries(changedFields.map((field) => [field, patch.pricingPolicy?.[field as keyof typeof patch.pricingPolicy] ?? null])),
                },
            });
        }
        const dflopChannelChanged = (Array.isArray(body.systemChannels) || Array.isArray(body.logicalModels)) && [...currentSettings.systemChannels, ...settings.systemChannels].some((channel) => channel.advancedConfig?.protocol === "dflop");
        if (dflopChannelChanged) {
            await safeRecordAuditLog({
                action: "admin.billing.dflop_pricing.sync",
                actor: auditActorFromRequest(request, currentUser),
                target: { type: "settings", id: "dflop_pricing" },
                metadata: buildDflopPricingAuditSummary(currentSettings.logicalModels, settings.logicalModels, settings.systemChannels, normalizeSystemPricingPolicy(settings.pricingPolicy)),
            });
        }
        const autoApplied = settings.logicalModels.flatMap((model) => {
            const previous = currentSettings.logicalModels.find((item) => item.id === model.id);
            if (model.salePriceSource !== "automatic" || model.saleRateCard?.revision === previous?.saleRateCard?.revision) return [];
            return [{ modelId: model.id, oldRevision: previous?.saleRateCard?.revision, newRevision: model.saleRateCard?.revision, pricingPolicyVersion: model.suggestedSaleRateCard?.pricingPolicyVersion }];
        });
        if (autoApplied.length) {
            await safeRecordAuditLog({
                action: "admin.billing.sale_price.auto_apply",
                actor: auditActorFromRequest(request, currentUser),
                target: { type: "settings", id: "logical_model_pricing" },
                metadata: { changes: autoApplied.slice(0, 30) },
            });
        }
        return NextResponse.json({ settings: serializeAdminSettingsForUser(settings, currentUser) });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.settings.update",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "settings", id: "auth" },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof NonTerminatingDecimalError) return NextResponse.json({ error: "成本策略计算结果超出可保存精度，请检查模型成本与汇率配置" }, { status: 422 });
        console.error("Admin settings update failed", error);
        return NextResponse.json({ error: "更新设置失败" }, { status: 500 });
    }
}

const SETTINGS_PERMISSION_BY_FIELD = {
    site: "system.manage",
    registrationEnabled: "system.manage",
    emailRegistrationEnabled: "system.manage",
    mail: "system.manage",
    dataLifecycle: "system.manage",
    modelPointCosts: "billing.manage",
    pricingPolicy: "billing.manage",
    generationPointMultipliers: "billing.manage",
    generationCostControl: "upstream.manage",
    generationConcurrency: "upstream.manage",
    generationDefaults: "upstream.manage",
    systemChannels: "upstream.manage",
    logicalModels: "upstream.manage",
    defaultModels: "upstream.manage",
    agentSkills: "upstream.manage",
} as const satisfies Partial<Record<keyof AuthSettings, AdminPermission>>;

function settingsPermissionsForPatch(patch: Partial<AuthSettings>, current?: AuthSettings) {
    const permissions: AdminPermission[] = [];
    for (const key of Object.keys(patch)) {
        if (key === "pricingPolicy") {
            if (!current) continue;
            const submitted = patch.pricingPolicy as Record<string, unknown> | undefined;
            const editable = ["cnyToUsd", "hotxUsdPerCredit", "markupMultiplier", "minimumMarginRate", "costBasis", "autoApplySalePrice"] as const;
            const managed = ["version", "dflopCreditsPerCny", "dflopCreditsPerCnySource", "dflopCurrencyConfigVersion"] as const;
            if (submitted && editable.some((field) => field in submitted && submitted[field] !== current.pricingPolicy[field])) permissions.push("billing.manage");
            if (submitted && managed.some((field) => field in submitted && submitted[field] !== current.pricingPolicy[field])) permissions.push("upstream.manage");
            continue;
        }
        const permission = SETTINGS_PERMISSION_BY_FIELD[key as keyof typeof SETTINGS_PERMISSION_BY_FIELD];
        if (permission && !permissions.includes(permission)) permissions.push(permission);
    }
    return permissions;
}

function siteSocialValidationError(socials: Partial<SiteSocialSettings> | undefined) {
    if (!socials) return "";
    const labels: Record<SiteSocialKey, string> = { email: "邮箱", telegram: "Telegram", x: "X", instagram: "Instagram" };
    for (const key of Object.keys(labels) as SiteSocialKey[]) {
        const social = socials[key];
        if (typeof social?.url !== "string" || !social.url.trim()) continue;
        if (!normalizeSiteSocial(key, social).url) return `${labels[key]} 地址无效，请填写完整链接或 @用户名`;
    }
    return "";
}

function customerServiceEmailValidationError(customerService: Partial<SiteCustomerServiceSettings> | undefined) {
    const email = normalizeEmail(customerService?.email);
    if (!email) return "";
    try {
        validateEmail(email);
        return "";
    } catch {
        return "客服邮箱格式不正确";
    }
}
