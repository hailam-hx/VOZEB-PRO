import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { createPostgresRepositories, ensurePostgresSchema, getDatabaseProvider } from "./database";
import { getStoredGenerationTaskRecord } from "./generation-task-store";
import { scheduleGenerationTask } from "./generation-task-scheduler";
import { closeTextTaskAttempt, createTextTask, getTextTask, openTextTaskAttempt, retryTextTask, transitionTextTask } from "./text-task-store";
import { runTextTaskStep } from "./text-task-runtime";
import * as outbound from "./safe-outbound-fetch";

const postgresIt = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? it : it.skip;

describe("PostgreSQL text retry", () => {
    postgresIt("clears old execution state in the retry CAS and submits a new Custom upstream after reread", async () => {
        expect(getDatabaseProvider()).toBe("postgres");
        await ensurePostgresSchema();
        const repositories = createPostgresRepositories();
        const userId = `test-text-retry-${randomUUID()}`;
        const now = new Date().toISOString();
        const config = {
            baseUrl: "https://fixture.example",
            apiKey: "fixture",
            apiFormat: "openai" as const,
            model: "custom-model",
            advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom" as const, createPath: "/jobs", queryPath: "/jobs/:task_id", requestTemplate: '{"prompt":"{{prompt}}"}', resultField: "text" },
        };
        await repositories.users.createWithNextAccountId({
            id: userId,
            username: userId,
            displayName: "重试回归",
            bio: "",
            role: "user",
            adminPermissions: [],
            status: "active",
            settledBalance: "0",
            passwordHash: "fixture-only",
            createdAt: now,
            updatedAt: now,
        });
        try {
            const task = await createTextTask({ userId, config, messages: [{ role: "user", content: "fixture" }] });
            const opened = (await openTextTaskAttempt(task, config, "custom", []))!;
            const closed = (await closeTextTaskAttempt(task.id, opened.activeAttemptId!, "failed", { error: "old failure", pointsCost: 1.25, pointsRecordId: "old charge" }))!;
            const failed = (await transitionTextTask(closed, ["pending"], {
                status: "error",
                error: "old failure",
                result: { content: "old result" },
                upstream: { id: "old-upstream", createPath: "/jobs" },
                billing: { pointsCost: 1.25, pointsRecordId: "old charge", refunded: true },
            }))!;
            await scheduleGenerationTask("text", task.id, {
                executionPhase: "completed",
                upstreamTaskId: "old-upstream",
                submittedAt: Date.now(),
                lastPollAt: Date.now(),
                resultPayload: { text: "old result" },
                channelId: "old channel",
                provider: "old provider",
                queryPath: "/old/:task_id",
            });
            const outcomes = await Promise.all([retryTextTask(failed, { config, messages: [{ role: "user", content: "fixture" }] }), retryTextTask(failed, { config, messages: [{ role: "user", content: "fixture" }] })]);
            expect(outcomes.filter(Boolean)).toHaveLength(1);
            const retried = (await getTextTask(task.id))!;
            expect(await transitionTextTask(failed, ["pending"], { status: "error", error: "old cycle callback" })).toBeNull();
            expect(await openTextTaskAttempt(failed, config, "custom", [])).toBeNull();
            expect(retried).toMatchObject({ id: task.id, status: "pending", billingCycleId: outcomes.find(Boolean)!.billingCycleId, attempts: closed.attempts });
            for (const key of ["error", "result", "upstream", "billing"]) expect(retried).not.toHaveProperty(key);
            const schedule = (await getStoredGenerationTaskRecord("text", task.id))!;
            expect(schedule.executionPhase).toBe("created");
            for (const key of ["upstreamTaskId", "submittedAt", "lastPollAt", "resultPayload", "channelId", "provider", "queryPath", "workerId", "leaseUntil"] as const) expect(schedule[key]).toBeUndefined();
            const fetch = vi.spyOn(outbound, "fetchSafeOutbound").mockResolvedValue(Response.json({ task_id: "new-upstream" }));
            expect(await runTextTaskStep(retried, "http://internal", "")).toMatchObject({ state: "pending", upstreamTaskId: "new-upstream" });
            expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([["https://fixture.example/v1/jobs", "POST"]]);
            expect((await getTextTask(task.id))?.attempts?.[0]).toEqual(closed.attempts![0]);
        } finally {
            vi.restoreAllMocks();
            await repositories.users.delete(userId);
        }
    });
});
