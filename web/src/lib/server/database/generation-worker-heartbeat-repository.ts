import { ensurePostgresSchema, postgresQuery } from "./postgres";
import { GENERATION_WORKER_HEARTBEAT_MAX_STALE_MS } from "../generation-worker-heartbeat-policy";
import type { GenerationWorkerCompatibility } from "../generation-worker-compatibility";

export type StoredGenerationWorkerHeartbeat = GenerationWorkerCompatibility & { workerId: string; lastSeenAt: number };

export async function upsertGenerationWorkerHeartbeat(workerId: string, at: Date, compatibility: GenerationWorkerCompatibility) {
    await ensurePostgresSchema();
    await postgresQuery(
        `INSERT INTO generation_worker_heartbeats (worker_id, last_seen_at, build_version, git_sha, schema_version, runtime_protocol_version)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, build_version = EXCLUDED.build_version, git_sha = EXCLUDED.git_sha, schema_version = EXCLUDED.schema_version, runtime_protocol_version = EXCLUDED.runtime_protocol_version`,
        [workerId, at, compatibility.buildVersion, compatibility.gitSha, compatibility.schemaVersion, compatibility.runtimeProtocolVersion],
    );
    await postgresQuery("DELETE FROM generation_worker_heartbeats WHERE last_seen_at < $1", [new Date(at.getTime() - GENERATION_WORKER_HEARTBEAT_MAX_STALE_MS)]);
}

export async function latestGenerationWorkerHeartbeats(): Promise<StoredGenerationWorkerHeartbeat[]> {
    const result = await postgresQuery<{ worker_id: string; last_seen_at: Date | string; build_version: string; git_sha: string; schema_version: string; runtime_protocol_version: string }>(
        "SELECT worker_id, last_seen_at, build_version, git_sha, schema_version, runtime_protocol_version FROM generation_worker_heartbeats ORDER BY last_seen_at DESC",
    );
    return result.rows.flatMap((row) => {
        const lastSeenAt = row.last_seen_at instanceof Date ? row.last_seen_at.getTime() : new Date(row.last_seen_at).getTime();
        return Number.isFinite(lastSeenAt)
            ? [{ workerId: row.worker_id, lastSeenAt, buildVersion: row.build_version || "", gitSha: row.git_sha || "", schemaVersion: row.schema_version || "", runtimeProtocolVersion: row.runtime_protocol_version || "" }]
            : [];
    });
}
