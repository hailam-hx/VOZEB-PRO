import { getDatabaseProvider } from "@/lib/server/database";
import { latestGenerationWorkerHeartbeats, upsertGenerationWorkerHeartbeat, type StoredGenerationWorkerHeartbeat } from "@/lib/server/database/generation-worker-heartbeat-repository";
import { GENERATION_WORKER_HEARTBEAT_MAX_STALE_MS, normalizeGenerationWorkerStaleMs } from "@/lib/server/generation-worker-heartbeat-policy";
import { isWorkerTokenConfigured } from "@/lib/server/maintenance-auth";
import { GENERATION_WORKER_RUNTIME_PROTOCOL_VERSION, GENERATION_WORKER_SCHEMA_VERSION, isGenerationWorkerCompatible, type GenerationWorkerCompatibility } from "@/lib/server/generation-worker-compatibility";

const runtime = globalThis as typeof globalThis & { __vozebProGenerationWorkerHeartbeats?: Map<string, StoredGenerationWorkerHeartbeat> };
const fileHeartbeats = (runtime.__vozebProGenerationWorkerHeartbeats ??= new Map<string, StoredGenerationWorkerHeartbeat>());

export async function recordGenerationWorkerHeartbeat(workerId: string, compatibilityOrAt: GenerationWorkerCompatibility | number = currentCompatibility(), at = Date.now()) {
    const normalized = workerId.trim().slice(0, 160);
    if (!normalized) return false;
    const compatibility = typeof compatibilityOrAt === "number" ? currentCompatibility() : compatibilityOrAt;
    const recordedAt = typeof compatibilityOrAt === "number" ? compatibilityOrAt : at;
    if (getDatabaseProvider() === "postgres") await upsertGenerationWorkerHeartbeat(normalized, new Date(recordedAt), compatibility);
    else {
        fileHeartbeats.set(normalized, { workerId: normalized, lastSeenAt: recordedAt, ...compatibility });
        for (const [id, heartbeat] of fileHeartbeats) if (heartbeat.lastSeenAt < recordedAt - GENERATION_WORKER_HEARTBEAT_MAX_STALE_MS) fileHeartbeats.delete(id);
    }
    return true;
}

export async function getGenerationWorkerHealth(now = Date.now()) {
    const staleAfterMs = normalizeGenerationWorkerStaleMs(process.env.VOZEB_PRO_GENERATION_WORKER_STALE_MS);
    if (!isWorkerTokenConfigured()) return { required: true, healthy: false, lastHeartbeatAt: null, staleAfterMs, reason: "worker_token_missing" as const };
    const heartbeats = getDatabaseProvider() === "postgres" ? await latestGenerationWorkerHeartbeats() : [...fileHeartbeats.values()];
    const compatibleLastSeenAt = latestHeartbeat(heartbeats.filter(isGenerationWorkerCompatible));
    const lastSeenAt = compatibleLastSeenAt || latestHeartbeat(heartbeats);
    return {
        required: true,
        healthy: Boolean(compatibleLastSeenAt && now - compatibleLastSeenAt <= staleAfterMs),
        lastHeartbeatAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
        staleAfterMs,
        ...(!lastSeenAt ? { reason: "heartbeat_missing" as const } : !compatibleLastSeenAt ? { reason: "worker_incompatible" as const } : now - compatibleLastSeenAt > staleAfterMs ? { reason: "heartbeat_stale" as const } : {}),
    };
}

function latestHeartbeat(heartbeats: StoredGenerationWorkerHeartbeat[]) {
    return heartbeats.reduce((latest, heartbeat) => Math.max(latest, heartbeat.lastSeenAt), 0) || undefined;
}

function currentCompatibility(): GenerationWorkerCompatibility {
    return {
        buildVersion: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "v0.0.6",
        gitSha: process.env.VOZEB_PRO_GIT_SHA?.trim() || "unknown",
        schemaVersion: GENERATION_WORKER_SCHEMA_VERSION,
        runtimeProtocolVersion: GENERATION_WORKER_RUNTIME_PROTOCOL_VERSION,
    };
}
