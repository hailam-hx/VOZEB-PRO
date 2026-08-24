import { isPostgresDatabaseEnabled } from "@/lib/server/database";
import { mutatePostgresAuthLogicalModels, updatePostgresAuthSettings } from "./postgres-auth-settings-service";
import { normalizeSettings } from "./store-normalizers";
import { mutateAuthDb, readAuthDb, readPostgresAuthSettings } from "./store-repository";
import { preserveLogicalModelPricing } from "./store-settings-merge";
import type { AuthSettings, LogicalModel } from "./store-types";

const AUTH_SETTINGS_CACHE_TTL_MS = 1000;
let postgresAuthSettingsCache: { value: AuthSettings; expiresAt: number } | null = null;
let postgresAuthSettingsRequest: Promise<AuthSettings> | null = null;
let postgresAuthSettingsVersion = 0;

export async function getAuthSettings() {
    if (isPostgresDatabaseEnabled()) {
        const now = Date.now();
        if (postgresAuthSettingsCache && postgresAuthSettingsCache.expiresAt > now) return postgresAuthSettingsCache.value;
        if (postgresAuthSettingsRequest) return postgresAuthSettingsRequest;
        const requestVersion = postgresAuthSettingsVersion;
        const request = readPostgresAuthSettings().then((settings) => {
            if (requestVersion === postgresAuthSettingsVersion) postgresAuthSettingsCache = { value: settings, expiresAt: Date.now() + AUTH_SETTINGS_CACHE_TTL_MS };
            return settings;
        });
        postgresAuthSettingsRequest = request;
        void request.then(
            () => {
                if (postgresAuthSettingsRequest === request) postgresAuthSettingsRequest = null;
            },
            () => {
                if (postgresAuthSettingsRequest === request) postgresAuthSettingsRequest = null;
            },
        );
        return request;
    }
    return (await readAuthDb()).settings;
}

export async function getFreshAuthSettings() {
    if (!isPostgresDatabaseEnabled()) return (await readAuthDb()).settings;
    const settings = await readPostgresAuthSettings();
    updatePostgresCache(settings);
    return settings;
}

export async function setAuthSettings(patch: Partial<AuthSettings>) {
    const settings = isPostgresDatabaseEnabled()
        ? await updatePostgresAuthSettings(patch)
        : await mutateAuthDb((db) => {
              const currentPatch = patch.logicalModels === undefined ? patch : { ...patch, logicalModels: preserveLogicalModelPricing(db.settings.logicalModels, patch.logicalModels) };
              db.settings = normalizeSettings({ ...db.settings, ...currentPatch });
              return db.settings;
          });
    updatePostgresCache(settings);
    return settings;
}

export async function mutateAuthLogicalModels(mutator: (models: LogicalModel[]) => LogicalModel[]) {
    const settings = isPostgresDatabaseEnabled()
        ? await mutatePostgresAuthLogicalModels(mutator)
        : await mutateAuthDb((db) => {
              db.settings = normalizeSettings({ ...db.settings, logicalModels: mutator(db.settings.logicalModels) });
              return db.settings;
          });
    updatePostgresCache(settings);
    return settings;
}

function updatePostgresCache(settings: AuthSettings) {
    if (!isPostgresDatabaseEnabled()) return;
    postgresAuthSettingsVersion += 1;
    postgresAuthSettingsCache = { value: settings, expiresAt: Date.now() + AUTH_SETTINGS_CACHE_TTL_MS };
}
