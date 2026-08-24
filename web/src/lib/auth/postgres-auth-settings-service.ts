import { createPostgresRepositories, ensurePostgresSchema, withPostgresTransaction, type JsonValue } from "@/lib/server/database";
import type { AppSettingsRecord } from "@/lib/server/database/repository-types";

import { encryptAuthSettingsSecrets, normalizeSettings } from "./store-normalizers";
import { readPostgresAuthSettings } from "./store-repository";
import { preserveLogicalModelPricing } from "./store-settings-merge";
import type { AuthSettings, LogicalModel } from "./store-types";

export async function updatePostgresAuthSettings(patch: Partial<AuthSettings>) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const settingsRepository = createPostgresRepositories(client).settings;
        await settingsRepository.lock();
        const current = await readPostgresAuthSettings(client);
        const currentPatch = patch.logicalModels === undefined ? patch : { ...patch, logicalModels: preserveLogicalModelPricing(current.logicalModels, patch.logicalModels) };
        const settings = normalizeSettings({ ...current, ...currentPatch });
        const encrypted = encryptAuthSettingsSecrets(settings);

        const settingsPatch = postgresSettingsPatch(currentPatch, encrypted);
        if (Object.keys(settingsPatch).length) await settingsRepository.updateSettings(settingsPatch);

        if (patch.systemChannels !== undefined) {
            for (const [sortOrder, channel] of encrypted.systemChannels.entries()) {
                await settingsRepository.upsertSystemModelChannel({
                    id: channel.id,
                    name: channel.name,
                    baseUrl: channel.baseUrl,
                    apiKeyCiphertext: channel.apiKey,
                    webhookSecretCiphertext: channel.webhookSecret || "",
                    apiFormat: channel.apiFormat,
                    models: asJson(channel.models),
                    enabled: channel.enabled,
                    advancedConfig: channel.advancedConfig ? asJson(channel.advancedConfig) : undefined,
                    sortOrder,
                });
            }
            await settingsRepository.deleteSystemModelChannelsNotIn(encrypted.systemChannels.map((channel) => channel.id));
        }
        return settings;
    });
}

export async function mutatePostgresAuthLogicalModels(mutator: (models: LogicalModel[]) => LogicalModel[]) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const settingsRepository = createPostgresRepositories(client).settings;
        await settingsRepository.lock();
        const current = await readPostgresAuthSettings(client);
        const settings = normalizeSettings({ ...current, logicalModels: mutator(current.logicalModels) });
        const encrypted = encryptAuthSettingsSecrets(settings);
        await settingsRepository.updateSettings({ logicalModels: asJson(encrypted.logicalModels) });
        return settings;
    });
}

function postgresSettingsPatch(patch: Partial<AuthSettings>, settings: AuthSettings) {
    const result: Partial<Omit<AppSettingsRecord, "id" | "createdAt" | "updatedAt">> = {};
    if (patch.site !== undefined) result.site = asJson(settings.site);
    if (patch.registrationEnabled !== undefined) result.registrationEnabled = settings.registrationEnabled;
    if (patch.emailRegistrationEnabled !== undefined) result.emailRegistrationEnabled = settings.emailRegistrationEnabled;
    if (patch.mail !== undefined) result.mail = asJson(settings.mail);
    if (patch.allowUserApiConfig !== undefined) result.allowUserApiConfig = settings.allowUserApiConfig;
    if (patch.modelPointCosts !== undefined) result.modelPointCosts = asJson(settings.modelPointCosts);
    if (patch.generationPointMultipliers !== undefined) result.generationPointMultipliers = asJson(settings.generationPointMultipliers);
    if (patch.generationCostControl !== undefined) result.generationCostControl = asJson(settings.generationCostControl);
    if (patch.dataLifecycle !== undefined) result.dataLifecycle = asJson(settings.dataLifecycle);
    if (patch.generationConcurrency !== undefined) result.generationConcurrency = asJson(settings.generationConcurrency);
    if (patch.generationDefaults !== undefined) result.generationDefaults = asJson(settings.generationDefaults);
    if (patch.logicalModels !== undefined) result.logicalModels = asJson(settings.logicalModels);
    if (patch.defaultModels !== undefined) result.defaultModels = asJson(settings.defaultModels);
    if (patch.agentSkills !== undefined) result.agentSkills = asJson(settings.agentSkills);
    return result;
}

function asJson(value: unknown) {
    return value as JsonValue;
}
