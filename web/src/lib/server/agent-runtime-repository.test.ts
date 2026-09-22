import { describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "@/lib/server/database";

import { bindAgentToolCallGeneration, claimReadyAgentTasks, prepareAgentToolCall, syncAgentRuntimeProjection } from "./agent-runtime-repository";

function client(rows: Record<string, unknown>[] = []) {
    return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

function jsonbClient(row: Omit<Record<string, unknown>, "input_json">) {
    const query = vi.fn(async (_sql: string, values?: unknown[]) => {
        const input = JSON.parse(String(values?.[5])) as unknown;
        return { rows: [{ ...row, input_json: input }], rowCount: 1 };
    });
    return {
        executor: { query: query as unknown as QueryExecutor["query"] },
        query,
    };
}

const run = {
    id: "run-1",
    userId: "user-1",
    conversationId: "conversation-1",
    clientRequestId: "request-1",
    surface: "chat" as const,
    inputMessageId: "message-1",
    assistantMessageId: "message-2",
    status: "running" as const,
    planningCycle: 2,
    prompt: "make an image",
    assetIds: [],
    reviewed: false,
    referencedAssetIds: [],
    tasks: [
        { id: "task-a", title: "A", type: "image" as const, prompt: "A", count: 1, dependencies: [], status: "completed" as const, attempts: 1, assetIds: ["asset-a"] },
        { id: "task-b", title: "B", type: "video" as const, prompt: "B", count: 1, dependencies: ["task-a"], status: "ready" as const, attempts: 0 },
    ],
    createdAt: 1,
    updatedAt: 2,
};

describe("agent runtime repository", () => {
    it("persists an immutable versioned plan and durable ordered DAG tasks", async () => {
        const db = client();

        await syncAgentRuntimeProjection(db, run);

        const sql = db.query.mock.calls.map(([statement]) => String(statement)).join("\n");
        expect(sql).toContain("INSERT INTO agent_plans");
        expect(sql).toContain("ON CONFLICT (run_id, version) DO NOTHING");
        expect(sql).toContain("INSERT INTO agent_tasks");
        expect(sql).toContain("ON CONFLICT (plan_id, task_key) DO UPDATE");
        expect(sql).toContain("INSERT INTO agent_task_dependencies");
        expect(db.query.mock.calls.some(([, values]) => Array.isArray(values) && values.includes(1) && values.includes("task-b"))).toBe(true);
        expect(db.query.mock.calls.some(([, values]) => Array.isArray(values) && values.includes("run-1:plan:2:task-b") && values.includes("run-1:plan:2:task-a"))).toBe(true);
    });

    it("persists a terminal task error code beside the diagnostic message", async () => {
        const db = client();
        const failedRun = {
            ...run,
            tasks: [
                {
                    ...run.tasks[1],
                    status: "failed" as const,
                    attempts: 1,
                    error: "provider diagnostic",
                    errorCode: "video_input_copyright_restricted",
                },
            ],
        };

        await syncAgentRuntimeProjection(db, failedRun);

        const taskInsert = db.query.mock.calls.find(([statement]) => String(statement).includes("INSERT INTO agent_tasks"));
        expect(JSON.parse(String(taskInsert?.[1]?.[9]))).toEqual({ message: "provider diagnostic", code: "video_input_copyright_restricted" });
    });

    it("prepares a tool call before side effects with a stable idempotency key", async () => {
        const db = client([{ id: "tool-1", run_id: "run-1", task_id: "task-a", tool_name: "image.generate", idempotency_key: "stable-key", status: "created", input_json: { prompt: "A" } }]);

        const call = await prepareAgentToolCall(db, { id: "tool-1", runId: "run-1", taskId: "task-a", toolName: "image.generate", idempotencyKey: "stable-key", input: { prompt: "A" }, now: 10 });

        expect(call.id).toBe("tool-1");
        expect(db.query.mock.calls[0]?.[0]).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
    });

    it.each([
        ["top-level undefined", { a: 1, b: undefined }, { a: 1 }],
        ["nested undefined", { context: { projectId: undefined, foo: "bar" } }, { context: { foo: "bar" } }],
        ["deep nested undefined", { a: { b: { c: undefined, d: 1 } } }, { a: { b: { d: 1 } } }],
        ["array undefined", { values: [1, undefined, 3] }, { values: [1, null, 3] }],
    ])("uses JSON semantics for %s when preparing an idempotent tool call", async (_name, input, expected) => {
        const db = jsonbClient({ id: "tool-1", run_id: "run-1", task_id: "task-a", tool_name: "image.generate", idempotency_key: "stable-key", status: "created" });

        const call = await prepareAgentToolCall(db.executor, { id: "tool-1", runId: "run-1", taskId: "task-a", toolName: "image.generate", idempotencyKey: "stable-key", input, now: 10 });

        expect(call.input).toEqual(expected);
        expect(JSON.parse(String(db.query.mock.calls[0]?.[1]?.[5]))).toEqual(expected);
    });

    it("still rejects a genuine payload conflict for the same idempotency identity", async () => {
        const db = client([{ id: "tool-1", run_id: "run-1", task_id: "task-a", tool_name: "image.generate", idempotency_key: "stable-key", status: "created", input_json: { prompt: "A" } }]);

        await expect(prepareAgentToolCall(db, { id: "tool-1", runId: "run-1", taskId: "task-a", toolName: "image.generate", idempotencyKey: "stable-key", input: { prompt: "B" }, now: 10 })).rejects.toThrow("Agent tool call idempotency conflict");
    });

    it("binds one generation to one tool call using compare-and-set semantics", async () => {
        const db = client([{ id: "tool-1", generation_task_id: "generation-1" }]);

        await bindAgentToolCallGeneration(db, "tool-1", "generation-1", 20);

        expect(db.query.mock.calls[0]?.[0]).toContain("generation_task_id IS NULL OR generation_task_id = $2");
    });

    it("claims only dependency-ready due work with skip-locked leases", async () => {
        const db = client();

        await claimReadyAgentTasks(db, { workerId: "worker-1", now: 100, leaseMs: 30_000, limit: 5 });

        const sql = String(db.query.mock.calls[0]?.[0]);
        expect(sql).toContain("FOR UPDATE SKIP LOCKED");
        expect(sql).toContain("agent_task_dependencies");
        expect(sql).toContain("dependency.status NOT IN ('completed', 'skipped')");
        expect(sql).toContain("lease_owner = $3");
        expect(sql).toContain("'ready', 'running', 'waiting_retry'");
    });
});
