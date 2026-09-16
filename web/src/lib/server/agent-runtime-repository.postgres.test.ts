import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { initializePostgresSchema, postgresQuery, withPostgresTransaction } from "@/lib/server/database";
import type { AgentRun } from "@/lib/server/agent-run-store";
import { bindDurableAgentToolCallGeneration, claimDueAgentTasks, markDurableAgentToolCall, prepareDurableAgentToolCall, syncAgentRuntimeProjection } from "./agent-runtime-repository";

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
            const toolCalls = await Promise.all([
                prepareDurableAgentToolCall({ id: `tool-a-${suffix}`, runId, taskId: `${runId}:plan:1:${taskKey}`, toolName: "image.generate", idempotencyKey, input: { prompt: "主图" } }),
                prepareDurableAgentToolCall({ id: `tool-b-${suffix}`, runId, taskId: `${runId}:plan:1:${taskKey}`, toolName: "image.generate", idempotencyKey, input: { prompt: "主图" } }),
            ]);
            expect(new Set(toolCalls.map((call) => call.id)).size).toBe(1);
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
});
