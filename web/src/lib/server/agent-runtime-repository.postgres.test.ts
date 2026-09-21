import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { initializePostgresSchema, postgresQuery, withPostgresTransaction } from "@/lib/server/database";
import type { AgentRun } from "@/lib/server/agent-run-store";
import { bindDurableAgentToolCallGeneration, claimDueAgentTasks, markDurableAgentToolCall, prepareDurableAgentToolCall, resetAgentTaskClaimsForRetry, syncAgentRuntimeProjection } from "./agent-runtime-repository";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("Agent runtime PostgreSQL recovery invariants", () => {
    postgresIt("allows one concurrent claim and one durable tool-call identity for one logical task", async () => {
        await initializePostgresSchema();
        const suffix = randomUUID();
        const userId = `agent-runtime-user-${suffix}`;
        const conversationId = `agent-runtime-conversation-${suffix}`;
        const runId = `agent-runtime-run-${suffix}`;
        const taskKey = "image-one";
        const now = Date.now();
        const run: AgentRun = {
            id: runId,
            userId,
            conversationId,
            clientRequestId: `agent-runtime-request-${suffix}`,
            surface: "chat",
            inputMessageId: `input-${suffix}`,
            assistantMessageId: `assistant-${suffix}`,
            prompt: "生成一张图",
            referencedAssetIds: [],
            assetIds: [],
            status: "running",
            executionId: `execution-${suffix}`,
            planningCycle: 1,
            tasks: [{ id: taskKey, title: "主图", type: "image", prompt: "主图", count: 1, dependencies: [], status: "ready", attempts: 0 }],
            reviewed: false,
            createdAt: now,
            updatedAt: now,
        };
        try {
            await withPostgresTransaction(async (client) => {
                await client.query("INSERT INTO users (id, username, display_name, password_hash, status) VALUES ($1, $2, 'Agent Runtime Test', 'integration-test-only', 'active')", [userId, `agent_runtime_${suffix.replaceAll("-", "").slice(0, 12)}`]);
                await client.query("INSERT INTO creative_conversations (id, user_id, surface, source, title, status, created_at, updated_at, last_message_at) VALUES ($1, $2, 'chat', 'agent', 'Agent Runtime Test', 'active', now(), now(), now())", [
                    conversationId,
                    userId,
                ]);
                await client.query(
                    `INSERT INTO generation_tasks (id, user_id, task_type, status, payload, created_at, updated_at, expires_at, conversation_id, run_id, surface, client_request_id, execution_phase, next_poll_at, last_upstream_status)
                     VALUES ($1, $2, 'agent', 'running', $3::jsonb, now(), now(), now() + interval '1 hour', $4, $1, 'chat', $5, 'polling', now(), 'running')`,
                    [runId, userId, JSON.stringify(run), conversationId, run.clientRequestId],
                );
                await syncAgentRuntimeProjection(client, run);
            });

            const claims = await Promise.all([claimDueAgentTasks({ workerId: `worker-a-${suffix}`, runId, limit: 1 }), claimDueAgentTasks({ workerId: `worker-b-${suffix}`, runId, limit: 1 })]);
            expect(claims.flat()).toHaveLength(1);

            const idempotencyKey = `${run.clientRequestId}:${taskKey}:1:1`;
            const input = { prompt: "主图", context: { projectId: undefined, values: [1, undefined, 3] } };
            const toolCalls = await Promise.all([
                prepareDurableAgentToolCall({ id: `tool-a-${suffix}`, runId, taskId: `${runId}:plan:1:${taskKey}`, toolName: "image.generate", idempotencyKey, input }),
                prepareDurableAgentToolCall({ id: `tool-b-${suffix}`, runId, taskId: `${runId}:plan:1:${taskKey}`, toolName: "image.generate", idempotencyKey, input }),
            ]);
            expect(new Set(toolCalls.map((call) => call.id)).size).toBe(1);
            expect(toolCalls[0]?.input).toEqual({ prompt: "主图", context: { values: [1, null, 3] } });
            const count = await postgresQuery<{ count: string }>("SELECT count(*)::text AS count FROM agent_tool_calls WHERE idempotency_key = $1", [idempotencyKey]);
            expect(count.rows[0]?.count).toBe("1");

            await bindDurableAgentToolCallGeneration(toolCalls[0]!.id, runId);
            const failedCall = await prepareDurableAgentToolCall({
                id: `tool-failed-${suffix}`,
                runId,
                taskId: `${runId}:plan:1:${taskKey}`,
                toolName: "image.generate",
                idempotencyKey: `${idempotencyKey}:failed`,
                input: { prompt: "失败分支" },
            });
            await markDurableAgentToolCall(failedCall.id, "failed", "provider rejected request");
            const persisted = await postgresQuery<{ id: string; status: string; generation_task_id?: string | null }>("SELECT id, status, generation_task_id FROM agent_tool_calls WHERE id = ANY($1::text[]) ORDER BY id", [
                [toolCalls[0]!.id, failedCall.id],
            ]);
            expect(persisted.rows).toEqual([
                { id: toolCalls[0]!.id, status: "accepted", generation_task_id: runId },
                { id: failedCall.id, status: "failed", generation_task_id: null },
            ]);
        } finally {
            await postgresQuery("DELETE FROM users WHERE id = $1", [userId]);
        }
    });

    postgresIt("reclaims a manually retried failed task without waiting for its previous lease", async () => {
        await initializePostgresSchema();
        const suffix = randomUUID();
        const userId = `agent-retry-user-${suffix}`;
        const conversationId = `agent-retry-conversation-${suffix}`;
        const runId = `agent-retry-run-${suffix}`;
        const now = Date.now();
        const run: AgentRun = {
            id: runId,
            userId,
            conversationId,
            clientRequestId: `agent-retry-request-${suffix}`,
            surface: "chat",
            inputMessageId: `input-${suffix}`,
            assistantMessageId: `assistant-${suffix}`,
            prompt: "生成视频",
            referencedAssetIds: [],
            assetIds: [],
            status: "running",
            executionId: `execution-${suffix}`,
            planningCycle: 1,
            tasks: [
                { id: "video-one", title: "视频", type: "video", prompt: "生成视频", count: 1, dependencies: [], status: "ready", attempts: 0 },
                { id: "video-sibling", title: "并行视频", type: "video", prompt: "生成并行视频", count: 1, dependencies: [], status: "ready", attempts: 0 },
            ],
            reviewed: false,
            createdAt: now,
            updatedAt: now,
        };
        try {
            await withPostgresTransaction(async (client) => {
                await client.query("INSERT INTO users (id, username, display_name, password_hash, status) VALUES ($1, $2, 'Agent Retry Test', 'integration-test-only', 'active')", [userId, `agent_retry_${suffix.replaceAll("-", "").slice(0, 12)}`]);
                await client.query("INSERT INTO creative_conversations (id, user_id, surface, source, title, status, created_at, updated_at, last_message_at) VALUES ($1, $2, 'chat', 'agent', 'Agent Retry Test', 'active', now(), now(), now())", [
                    conversationId,
                    userId,
                ]);
                await client.query(
                    `INSERT INTO generation_tasks (id, user_id, task_type, status, payload, created_at, updated_at, expires_at, conversation_id, run_id, surface, client_request_id, execution_phase, next_poll_at, last_upstream_status)
                     VALUES ($1, $2, 'agent', 'running', $3::jsonb, now(), now(), now() + interval '1 hour', $4, $1, 'chat', $5, 'polling', now(), 'running')`,
                    [runId, userId, JSON.stringify(run), conversationId, run.clientRequestId],
                );
                await syncAgentRuntimeProjection(client, run);
            });

            expect(await claimDueAgentTasks({ workerId: `old-worker-${suffix}`, runId, limit: 2 })).toHaveLength(2);
            await withPostgresTransaction(async (client) => {
                await syncAgentRuntimeProjection(client, {
                    ...run,
                    status: "failed",
                    updatedAt: now + 1,
                    tasks: [
                        { ...run.tasks[0]!, status: "failed", attempts: 1, error: "reference URL is not public" },
                        { ...run.tasks[1]!, status: "running", attempts: 1 },
                    ],
                });
                await syncAgentRuntimeProjection(client, {
                    ...run,
                    updatedAt: now + 2,
                    tasks: [
                        { ...run.tasks[0]!, status: "ready", attempts: 1 },
                        { ...run.tasks[1]!, status: "running", attempts: 1 },
                    ],
                });
            });
            await resetAgentTaskClaimsForRetry(runId, ["video-one"]);

            const reclaimed = await claimDueAgentTasks({ workerId: `retry-worker-${suffix}`, runId, limit: 1 });
            const sibling = await postgresQuery<{ status: string; lease_owner: string | null }>("SELECT status, lease_owner FROM agent_tasks WHERE run_id = $1 AND task_key = 'video-sibling'", [runId]);

            expect(reclaimed).toHaveLength(1);
            expect(reclaimed[0]).toMatchObject({ task_key: "video-one", status: "claimed", attempt_count: 1, lease_owner: `retry-worker-${suffix}` });
            expect(sibling.rows[0]).toEqual({ status: "running", lease_owner: `old-worker-${suffix}` });
        } finally {
            await postgresQuery("DELETE FROM users WHERE id = $1", [userId]);
        }
    });
});
