import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn<() => "file" | "postgres">(),
    getPostgresConnectionString: vi.fn(),
    postgresQuery: vi.fn(),
    withPostgresTransaction: vi.fn(),
}));

vi.mock("@/lib/server/database", () => database);

import { bindDurableAgentToolCallGeneration, listAgentRuntimeTraces, markDurableAgentToolCall, prepareDurableAgentToolCall } from "./agent-runtime-repository";

const toolCallInput = {
    id: "tool-1",
    runId: "run-file",
    taskId: "run-file:plan:1:image-one",
    toolName: "image.generate",
    idempotencyKey: "request-1:image-one:1:1",
    input: { prompt: "blue image" },
};

describe("Agent runtime repository provider selection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        database.getDatabaseProvider.mockReturnValue("file");
        database.getPostgresConnectionString.mockReturnValue("");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ["configured", "postgres://configured-but-inactive.invalid/vozeb"],
        ["absent", ""],
    ])("keeps every durable tool-call operation off PostgreSQL when the active provider is file and a connection string is %s", async (_name, connectionString) => {
        database.getPostgresConnectionString.mockReturnValue(connectionString);
        if (connectionString) vi.stubEnv("DATABASE_URL", connectionString);

        const first = await prepareDurableAgentToolCall(toolCallInput);
        const replay = await prepareDurableAgentToolCall(toolCallInput);
        const bound = await bindDurableAgentToolCallGeneration(toolCallInput.id, "generation-1");
        const failed = await markDurableAgentToolCall(toolCallInput.id, "failed", "provider rejected request");
        const unknown = await markDurableAgentToolCall(toolCallInput.id, "unknown", "provider outcome unknown");
        const traces = await listAgentRuntimeTraces([toolCallInput.runId]);

        expect(first).toMatchObject({ id: "tool-1", runId: "run-file", status: "created" });
        expect(replay).toEqual(first);
        expect(bound).toBeNull();
        expect(failed).toBeNull();
        expect(unknown).toBeNull();
        expect(traces.size).toBe(0);
        expect(database.ensurePostgresSchema).not.toHaveBeenCalled();
        expect(database.withPostgresTransaction).not.toHaveBeenCalled();
        expect(database.postgresQuery).not.toHaveBeenCalled();
    });

    it("uses PostgreSQL for prepare, bind, failure marking, and trace reads when PostgreSQL is active and configured", async () => {
        database.getDatabaseProvider.mockReturnValue("postgres");
        database.getPostgresConnectionString.mockReturnValue("postgres://active.invalid/vozeb");
        vi.stubEnv("DATABASE_URL", "postgres://active.invalid/vozeb");
        const query = vi.fn(async (sql: string) => {
            if (sql.includes("INSERT INTO agent_tool_calls")) {
                return {
                    rows: [
                        {
                            id: "tool-1",
                            run_id: "run-file",
                            task_id: "run-file:plan:1:image-one",
                            tool_name: "image.generate",
                            idempotency_key: "request-1:image-one:1:1",
                            status: "created",
                            input_json: { prompt: "blue image" },
                        },
                    ],
                    rowCount: 1,
                };
            }
            if (sql.includes("generation_task_id = $2")) {
                return { rows: [{ id: "tool-1", status: "accepted", generation_task_id: "generation-1", input_json: {} }], rowCount: 1 };
            }
            return { rows: [{ id: "tool-1", status: "failed", input_json: {}, error_json: { message: "failed" } }], rowCount: 1 };
        });
        database.withPostgresTransaction.mockImplementation(async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }));
        database.postgresQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        await expect(prepareDurableAgentToolCall(toolCallInput)).resolves.toMatchObject({ id: "tool-1", status: "created" });
        await expect(bindDurableAgentToolCallGeneration("tool-1", "generation-1")).resolves.toMatchObject({ id: "tool-1", status: "accepted" });
        await expect(markDurableAgentToolCall("tool-1", "failed", "failed")).resolves.toMatchObject({ id: "tool-1", status: "failed" });
        await expect(listAgentRuntimeTraces(["run-file"])).resolves.toEqual(new Map());

        expect(database.ensurePostgresSchema).toHaveBeenCalledTimes(4);
        expect(database.withPostgresTransaction).toHaveBeenCalledTimes(3);
        expect(database.postgresQuery).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["prepare", () => prepareDurableAgentToolCall(toolCallInput)],
        ["bind", () => bindDurableAgentToolCallGeneration("tool-1", "generation-1")],
        ["mark", () => markDurableAgentToolCall("tool-1", "failed", "failed")],
        ["trace read", () => listAgentRuntimeTraces(["run-file"])],
    ])("fails clearly for %s when PostgreSQL is active without a connection string", async (_name, operation) => {
        database.getDatabaseProvider.mockReturnValue("postgres");
        database.getPostgresConnectionString.mockReturnValue("");

        await expect(operation()).rejects.toThrow("DATABASE_URL is required when VOZEB_PRO_DATABASE_PROVIDER=postgres");
        expect(database.ensurePostgresSchema).not.toHaveBeenCalled();
        expect(database.withPostgresTransaction).not.toHaveBeenCalled();
        expect(database.postgresQuery).not.toHaveBeenCalled();
    });
});
