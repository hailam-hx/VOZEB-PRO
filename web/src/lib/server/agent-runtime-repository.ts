import { ensurePostgresSchema, withPostgresTransaction, type QueryExecutor } from "@/lib/server/database";
import type { AgentRun, AgentRunTask } from "@/lib/server/agent-run-store";

type AgentToolCallRow = {
    id: string;
    run_id: string;
    task_id: string;
    tool_name: string;
    idempotency_key: string;
    status: string;
    generation_task_id?: string | null;
    input_json: unknown;
    output_json?: unknown;
    error_json?: unknown;
};

export type AgentToolCall = {
    id: string;
    runId: string;
    taskId: string;
    toolName: string;
    idempotencyKey: string;
    status: string;
    generationTaskId?: string;
    input: unknown;
    output?: unknown;
    error?: unknown;
};

export async function syncAgentRuntimeProjection(client: QueryExecutor, run: AgentRun) {
    const now = new Date(run.updatedAt);
    const version = Math.max(1, Math.floor(run.planningCycle || 1));
    await client.query(
        `INSERT INTO agent_runs (id, user_id, conversation_id, project_id, surface, status, active_plan_version, failure_code, created_at, updated_at, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, active_plan_version = EXCLUDED.active_plan_version,
             failure_code = EXCLUDED.failure_code, updated_at = EXCLUDED.updated_at, started_at = COALESCE(agent_runs.started_at, EXCLUDED.started_at),
             completed_at = EXCLUDED.completed_at`,
        [
            run.id,
            run.userId,
            run.conversationId,
            run.projectId || null,
            run.surface,
            agentRunStatus(run.status),
            run.tasks.length ? version : 0,
            run.failureStage || null,
            new Date(run.createdAt),
            now,
            run.timings?.executionStartedAt ? new Date(run.timings.executionStartedAt) : null,
            run.timings?.runCompletedAt ? new Date(run.timings.runCompletedAt) : null,
        ],
    );
    if (run.snapshot !== undefined) {
        await client.query(
            `INSERT INTO agent_context_snapshots (id, run_id, version, snapshot_json, created_at)
             VALUES ($1, $2, $3, $4::jsonb, $5)
             ON CONFLICT (run_id, version) DO NOTHING`,
            [`${run.id}:context:${version}`, run.id, version, JSON.stringify(run.snapshot), now],
        );
    }
    if (!run.tasks.length) return;
    const planId = `${run.id}:plan:${version}`;
    await client.query(
        `INSERT INTO agent_plans (id, run_id, version, goal, strategy, plan_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (run_id, version) DO NOTHING`,
        [planId, run.id, version, run.prompt, run.foundation ? JSON.stringify(run.foundation) : null, JSON.stringify({ tasks: run.tasks }), now],
    );
    for (const [ordinal, task] of run.tasks.entries()) {
        await upsertAgentTask(client, run.id, planId, ordinal, task, now);
    }
    for (const task of run.tasks) {
        for (const dependencyId of task.dependencies) {
            await client.query(
                `INSERT INTO agent_task_dependencies (task_id, depends_on_task_id)
                 VALUES ($1, $2)
                 ON CONFLICT (task_id, depends_on_task_id) DO NOTHING`,
                [agentTaskEntityId(planId, task.id), agentTaskEntityId(planId, dependencyId)],
            );
        }
    }
}

async function upsertAgentTask(client: QueryExecutor, runId: string, planId: string, ordinal: number, task: AgentRunTask, now: Date) {
    const status = agentTaskStatus(task.status);
    await client.query(
        `INSERT INTO agent_tasks (
            id, run_id, plan_id, task_key, ordinal, type, status, input_json, output_json, error_json,
            attempt_count, next_attempt_at, created_at, updated_at, started_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $13, $14, $15)
         ON CONFLICT (plan_id, task_key) DO UPDATE SET ordinal = EXCLUDED.ordinal, status = EXCLUDED.status,
             output_json = EXCLUDED.output_json, error_json = EXCLUDED.error_json, attempt_count = EXCLUDED.attempt_count,
             next_attempt_at = EXCLUDED.next_attempt_at, updated_at = EXCLUDED.updated_at,
             started_at = COALESCE(agent_tasks.started_at, EXCLUDED.started_at), completed_at = EXCLUDED.completed_at`,
        [
            agentTaskEntityId(planId, task.id),
            runId,
            planId,
            task.id,
            ordinal,
            task.type,
            status,
            JSON.stringify(agentTaskInput(task)),
            JSON.stringify(task),
            task.error ? JSON.stringify({ message: task.error }) : null,
            task.attempts,
            status === "ready" ? now : null,
            now,
            task.status === "running" ? now : null,
            task.status === "completed" || task.status === "failed" || task.status === "cancelled" ? now : null,
        ],
    );
}

export async function hydrateAgentRuntimeProjection<T extends AgentRun>(client: QueryExecutor, run: T): Promise<T> {
    const result = await client.query<{ output_json: AgentRunTask }>(
        `SELECT task.output_json
         FROM agent_tasks task
         JOIN agent_runs run ON run.id = task.run_id AND run.active_plan_version > 0
         JOIN agent_plans plan ON plan.id = task.plan_id AND plan.version = run.active_plan_version
         WHERE task.run_id = $1
         ORDER BY task.ordinal ASC`,
        [run.id],
    );
    return result.rows.length ? { ...run, tasks: result.rows.map((row) => row.output_json) } : run;
}

export async function getPostgresAgentRun(id: string) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const result = await client.query<{ payload: AgentRun }>("SELECT payload FROM generation_tasks WHERE id = $1 AND task_type = 'agent' AND expires_at > now()", [id]);
        return result.rows[0] ? hydrateAgentRuntimeProjection(client, result.rows[0].payload) : null;
    });
}

export async function prepareAgentToolCall(client: QueryExecutor, input: { id: string; runId: string; taskId: string; toolName: string; idempotencyKey: string; input: unknown; now?: number }) {
    const now = new Date(input.now || Date.now());
    const inserted = await client.query<AgentToolCallRow>(
        `INSERT INTO agent_tool_calls (id, run_id, task_id, tool_name, idempotency_key, status, input_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'created', $6::jsonb, $7, $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [input.id, input.runId, input.taskId, input.toolName, input.idempotencyKey, JSON.stringify(input.input), now],
    );
    const row = inserted.rows[0] || (await client.query<AgentToolCallRow>("SELECT * FROM agent_tool_calls WHERE idempotency_key = $1", [input.idempotencyKey])).rows[0];
    if (!row) throw new Error("Agent tool call could not be prepared");
    if (row.run_id !== input.runId || row.task_id !== input.taskId || row.tool_name !== input.toolName || stableJson(row.input_json) !== stableJson(input.input)) {
        throw new Error("Agent tool call idempotency conflict");
    }
    return mapToolCall(row);
}

export async function bindAgentToolCallGeneration(client: QueryExecutor, toolCallId: string, generationTaskId: string, now = Date.now()) {
    const result = await client.query<AgentToolCallRow>(
        `UPDATE agent_tool_calls
         SET generation_task_id = $2, status = 'accepted', accepted_at = COALESCE(accepted_at, $3), updated_at = $3
         WHERE id = $1 AND (generation_task_id IS NULL OR generation_task_id = $2)
         RETURNING *`,
        [toolCallId, generationTaskId, new Date(now)],
    );
    if (!result.rows[0]) throw new Error("Agent tool call is already bound to another generation");
    return mapToolCall(result.rows[0]);
}

export async function prepareDurableAgentToolCall(input: Parameters<typeof prepareAgentToolCall>[1]) {
    if (!postgresConfigured()) return { id: input.id, runId: input.runId, taskId: input.taskId, toolName: input.toolName, idempotencyKey: input.idempotencyKey, status: "created", input: input.input } satisfies AgentToolCall;
    await ensurePostgresSchema();
    return withPostgresTransaction((client) => prepareAgentToolCall(client, input));
}

export async function bindDurableAgentToolCallGeneration(toolCallId: string, generationTaskId: string, now = Date.now()) {
    if (!postgresConfigured()) return null;
    await ensurePostgresSchema();
    return withPostgresTransaction((client) => bindAgentToolCallGeneration(client, toolCallId, generationTaskId, now));
}

export async function markDurableAgentToolCall(toolCallId: string, status: "failed" | "unknown", error: string, now = Date.now()) {
    if (!postgresConfigured()) return null;
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const result = await client.query<AgentToolCallRow>(
            `UPDATE agent_tool_calls SET status = $2, error_json = $3::jsonb, updated_at = $4
             WHERE id = $1 AND generation_task_id IS NULL AND status IN ('created', 'submitting', 'failed')
             RETURNING *`,
            [toolCallId, status, JSON.stringify({ message: error }), new Date(now)],
        );
        return result.rows[0] ? mapToolCall(result.rows[0]) : null;
    });
}

export async function claimReadyAgentTasks(client: QueryExecutor, input: { workerId: string; now?: number; leaseMs?: number; limit?: number; runId?: string }) {
    const now = input.now || Date.now();
    const leaseMs = Math.max(30_000, Math.min(5 * 60_000, Math.floor(input.leaseMs || 90_000)));
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit || 20)));
    const result = await client.query(
        `WITH ready AS (
            SELECT task.id
            FROM agent_tasks task
            WHERE task.status IN ('ready', 'running', 'waiting_retry')
              AND (task.next_attempt_at IS NULL OR task.next_attempt_at <= $1)
              AND (task.lease_until IS NULL OR task.lease_until <= $1 OR task.lease_owner = $3)
              AND ($5::text IS NULL OR task.run_id = $5)
              AND NOT EXISTS (
                  SELECT 1 FROM agent_task_dependencies edge
                  JOIN agent_tasks dependency ON dependency.id = edge.depends_on_task_id
                  WHERE edge.task_id = task.id AND dependency.status NOT IN ('completed', 'skipped')
              )
            ORDER BY task.next_attempt_at NULLS FIRST, task.created_at, task.id
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         )
         UPDATE agent_tasks task
         SET status = 'claimed', lease_owner = $3, lease_until = $4, updated_at = $1
         FROM ready WHERE task.id = ready.id
         RETURNING task.*`,
        [new Date(now), limit, input.workerId, new Date(now + leaseMs), input.runId || null],
    );
    return result.rows;
}

export async function claimDueAgentTasks(input: { workerId: string; now?: number; leaseMs?: number; limit?: number; runId?: string }) {
    await ensurePostgresSchema();
    return withPostgresTransaction((client) => claimReadyAgentTasks(client, input));
}

export async function deferAgentTask(runId: string, planVersion: number, taskKey: string, workerId: string, nextAttemptAt: number, error: string) {
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const result = await client.query(
            `UPDATE agent_tasks task
             SET status = 'waiting_retry', next_attempt_at = $5, lease_owner = NULL, lease_until = NULL,
                 error_json = $6::jsonb, updated_at = now()
             FROM agent_plans plan
             WHERE task.plan_id = plan.id AND task.run_id = $1 AND plan.version = $2 AND task.task_key = $3
               AND (task.lease_owner = $4 OR task.lease_owner IS NULL)
             RETURNING task.*`,
            [runId, planVersion, taskKey, workerId, new Date(nextAttemptAt), JSON.stringify({ message: error })],
        );
        return result.rows[0] || null;
    });
}

function agentTaskInput(task: AgentRunTask) {
    const { result: _result, error: _error, assetIds: _assetIds, taskId: _taskId, taskIds: _taskIds, childTasks: _childTasks, childSlots: _childSlots, ...input } = task;
    return input;
}

export function agentTaskEntityId(planId: string, taskKey: string) {
    return `${planId}:${taskKey}`;
}

function agentRunStatus(status: AgentRun["status"]) {
    return status === "planning" ? "planning" : status === "running" ? "executing" : status === "paused" ? "waiting_user" : status;
}

function agentTaskStatus(status: AgentRunTask["status"]) {
    return status === "ready" ? "ready" : status === "running" ? "running" : status;
}

function mapToolCall(row: AgentToolCallRow): AgentToolCall {
    return {
        id: row.id,
        runId: row.run_id,
        taskId: row.task_id,
        toolName: row.tool_name,
        idempotencyKey: row.idempotency_key,
        status: row.status,
        generationTaskId: row.generation_task_id || undefined,
        input: row.input_json,
        output: row.output_json,
        error: row.error_json,
    };
}

function stableJson(value: unknown): string {
    if (!value || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")}}`;
}

function postgresConfigured() {
    return Boolean(process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim());
}
