import { ensurePostgresSchema, getDatabaseProvider, postgresQuery, withPostgresTransaction } from "@/lib/server/database";
import { readJsonDataFile, withJsonDataFileLock, writeJsonDataFile } from "@/lib/server/data-adapter";
import { ProviderHealthService, type ProviderHealthRecord, type ProviderHealthStore } from "./provider-health";

const PROVIDER_HEALTH_FILE = "provider-health.json";
type ProviderHealthFile = { version: 1; records: Record<string, ProviderHealthRecord> };

export class FileProviderHealthStore implements ProviderHealthStore {
    async read(key: string, now: number) {
        const data = await readFile();
        const current = data.records[key];
        return current && current.expiresAt > now ? structuredClone(current) : undefined;
    }

    async update(key: string, updater: (current: ProviderHealthRecord | undefined) => ProviderHealthRecord | undefined, now: number) {
        return withJsonDataFileLock(PROVIDER_HEALTH_FILE, async () => {
            const data = await readFile();
            for (const [recordKey, record] of Object.entries(data.records)) if (record.expiresAt <= now) delete data.records[recordKey];
            const next = updater(data.records[key] ? structuredClone(data.records[key]) : undefined);
            if (next) data.records[key] = structuredClone(next);
            else delete data.records[key];
            await writeJsonDataFile(PROVIDER_HEALTH_FILE, data);
            return next ? structuredClone(next) : undefined;
        });
    }
}

export class PostgresProviderHealthStore implements ProviderHealthStore {
    async read(key: string, now: number) {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ payload: ProviderHealthRecord }>("SELECT payload FROM provider_health WHERE binding_key = $1 AND expires_at > $2", [key, new Date(now)]);
        return result.rows[0]?.payload ? normalizeRecord(result.rows[0].payload) : undefined;
    }

    async update(key: string, updater: (current: ProviderHealthRecord | undefined) => ProviderHealthRecord | undefined, now: number) {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (database) => {
            const selected = await database.query<{ payload: ProviderHealthRecord; expires_at: Date | string }>("SELECT payload, expires_at FROM provider_health WHERE binding_key = $1 FOR UPDATE", [key]);
            const row = selected.rows[0];
            const current = row && new Date(row.expires_at).getTime() > now ? normalizeRecord(row.payload) : undefined;
            const next = updater(current);
            if (!next) {
                await database.query("DELETE FROM provider_health WHERE binding_key = $1", [key]);
                return undefined;
            }
            await database.query(
                `INSERT INTO provider_health (binding_key, scope, provider, channel_id, model, state, payload, updated_at, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
                 ON CONFLICT (binding_key) DO UPDATE SET scope = EXCLUDED.scope, provider = EXCLUDED.provider, channel_id = EXCLUDED.channel_id,
                 model = EXCLUDED.model, state = EXCLUDED.state, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at`,
                [key, next.scope, next.provider, next.channelId, next.model, next.state, JSON.stringify(next), new Date(next.updatedAt), new Date(next.expiresAt)],
            );
            return structuredClone(next);
        });
    }
}

export function createProviderHealthService() {
    const store = getDatabaseProvider() === "postgres" ? new PostgresProviderHealthStore() : new FileProviderHealthStore();
    return new ProviderHealthService(store, undefined, console);
}

async function readFile(): Promise<ProviderHealthFile> {
    const value = await readJsonDataFile<ProviderHealthFile>(PROVIDER_HEALTH_FILE, { version: 1, records: {} });
    return value?.version === 1 && value.records && typeof value.records === "object" ? value : { version: 1, records: {} };
}

function normalizeRecord(value: ProviderHealthRecord) {
    return { ...value, independentModels: Array.isArray(value.independentModels) ? value.independentModels : [] };
}
