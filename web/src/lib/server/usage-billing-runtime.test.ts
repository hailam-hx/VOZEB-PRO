import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeBillableUsage } from "@/lib/billing/pricing";
import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { emptyDb } from "@/lib/auth/store-normalizers";
import { readAuthDb, writeAuthDb } from "@/lib/auth/store-repository";
import { meteredTextResponseBody } from "./system-ai-metered-text-stream";
import { closeTextTaskAttempt, createTextTask, getTextTask, openTextTaskAttempt, retryTextTask, transitionTextTask } from "./text-task-store";
import { textTaskBillingBusinessId, usageRecoveryIdentity } from "./generation-usage-context";
import { runTextTaskStep } from "./text-task-runtime";
import { systemAiUsageResponseHeaders, finalizeSystemAiUsageRequestHeaders } from "./system-ai-billing";
import * as outbound from "./safe-outbound-fetch";
import * as internal from "./internal-origin";
import * as authStore from "@/lib/auth/store";
import * as session from "@/lib/auth/session";
import * as security from "./security";
import { POST as systemProxyPost } from "@/app/api/ai/system/[channelId]/[...path]/route";
import { scheduleGenerationTask } from "./generation-task-scheduler";
import { getStoredGenerationTaskRecord } from "./generation-task-store";

import {
    attachUsageProviderEvidence,
    attachUsageProviderUpstreamTaskId,
    finalizeUsageBillingForBusiness,
    finishSystemAiTextAttempt,
    inspectPersistedUsageHold,
    recoverOrphanUsageHolds,
    finishUsageProviderAttempt,
    loadUsageBilling,
    recordUsageProviderAttempt,
    resolveSystemAiTextFailure,
    releaseUsageBilling,
    reserveUsageBilling,
    reserveOrReuseUsageBilling,
    settleCancelledUsageBilling,
    settleUsageBilling,
} from "./usage-billing-runtime";

const previousProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const previousDataDir = process.env.VOZEB_PRO_DATA_DIR;
let dataDir = "";

const imageSale = { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "1.5" }] };
const imageRequest = normalizeBillableUsage({ capability: "image", source: "request", count: 1 });

beforeAll(() => {
    process.env.VOZEB_PRO_DATABASE_PROVIDER = "file";
});

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vozeb-usage-runtime-"));
    process.env.VOZEB_PRO_DATA_DIR = dataDir;
    const db = emptyDb();
    db.users.push({
        id: "user-one",
        accountId: "0001",
        username: "runtime-user",
        displayName: "运行时用户",
        bio: "",
        role: "user",
        adminPermissions: [],
        status: "active",
        settledBalance: "10",
        passwordHash: "test",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
    });
    db.pointRecords.push({ id: "opening-credit", userId: "user-one", type: "credit", amount: "10", balanceAfter: "10", description: "测试充值", idempotencyKey: "opening-credit", createdAt: "2026-08-23T00:00:00.000Z" });
    await writeAuthDb(db);
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
});

afterAll(() => {
    if (previousProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
    else process.env.VOZEB_PRO_DATABASE_PROVIDER = previousProvider;
    if (previousDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
    else process.env.VOZEB_PRO_DATA_DIR = previousDataDir;
});

describe("usage billing runtime", () => {
    it("enriches a failed provider attempt when usage evidence arrives after terminalization", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "text-task:late-provider-evidence",
            requestFingerprint: "0".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "迟到用量证据",
        });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "fixture",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "output", dimension: "outputTokens", unitPrice: "0.1" }] },
        });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed" });

        await attachUsageProviderEvidence({ billing, attemptNumber: 1, usage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "5", outputTokens: "7" }) });

        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({
            status: "failed",
            nativeCostAmount: "0.7",
            costUsd: "0.7",
            normalizedUsage: { inputTokens: "5", outputTokens: "7" },
            observedUsage: { inputTokens: "5", outputTokens: "7" },
        });
    });

    it("persists equivalent failed attempt evidence in either write order", async () => {
        const evidence = normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "5", outputTokens: "7" });
        const rate = { version: 1 as const, components: [{ id: "output", dimension: "outputTokens" as const, unitPrice: "0.1" }] };
        const run = async (suffix: string, evidenceFirst: boolean) => {
            const billing = await reserveUsageBilling({
                userId: "user-one",
                businessId: `text-task:provider-evidence-${suffix}`,
                requestFingerprint: suffix.repeat(64).slice(0, 64),
                logicalModelId: "writer",
                saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
                requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
                description: "用量证据写入顺序",
            });
            await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" }, costRateSnapshot: rate });
            if (evidenceFirst) {
                await attachUsageProviderEvidence({ billing, attemptNumber: 1, usage: evidence });
                await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed" });
            } else {
                await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed" });
                await attachUsageProviderEvidence({ billing, attemptNumber: 1, usage: evidence });
            }
            return (await readAuthDb()).providerUsageAttempts.find((attempt) => attempt.holdId === billing.holdId)!;
        };

        const evidenceFirst = await run("a", true);
        const terminalFirst = await run("b", false);
        for (const attempt of [evidenceFirst, terminalFirst]) {
            expect(attempt).toMatchObject({ status: "failed", nativeCostAmount: "0.7", costUsd: "0.7", normalizedUsage: { inputTokens: "5", outputTokens: "7" }, observedUsage: { inputTokens: "5", outputTokens: "7" } });
        }
        expect({ ...evidenceFirst, id: undefined, holdId: undefined, requestFingerprint: undefined, createdAt: undefined, updatedAt: undefined, completedAt: undefined }).toEqual({
            ...terminalFirst,
            id: undefined,
            holdId: undefined,
            requestFingerprint: undefined,
            createdAt: undefined,
            updatedAt: undefined,
            completedAt: undefined,
        });
        expect((await readAuthDb()).pointRecords.filter((record) => record.type === "consume")).toHaveLength(0);
    });

    it("reconciles an already settled system AI text attempt without charging twice", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:settlement-recovery",
            requestFingerprint: "9".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner fixture",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }));

        await finishSystemAiTextAttempt(headers, { status: "succeeded" });
        await expect(finishSystemAiTextAttempt(headers, { status: "succeeded" })).resolves.toBeUndefined();

        const db = await readAuthDb();
        expect(db.walletHolds).toEqual([expect.objectContaining({ id: billing.holdId, status: "settled" })]);
        expect(db.providerUsageAttempts).toEqual([expect.objectContaining({ attemptNumber: 1, status: "succeeded" })]);
        expect(db.usageCharges).toHaveLength(1);
    });

    it("reports the exact planner billing integrity step when the provider attempt is missing", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:missing-attempt",
            requestFingerprint: "8".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner integrity fixture",
        });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }));

        await expect(finishSystemAiTextAttempt(headers, { status: "succeeded" })).rejects.toMatchObject({ code: "load_attempt:usage_attempt_missing" });
    });

    it("rejects a provider price card incompatible with the reserved capability before creating an attempt", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:invalid-cost-dimension",
            requestFingerprint: "5".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner invalid provider price fixture",
        });
        expect(() =>
            recordUsageProviderAttempt({
                billing,
                attemptNumber: 1,
                status: "pending",
                provider: "fixture",
                bindingId: "binding",
                nativeCostAmount: "0",
                nativeCostUnit: { kind: "fiat", currency: "USD" },
                costRateSnapshot: { version: 1, components: [{ id: "invalid-text-count", dimension: "count", unitPrice: "1" }] },
                observedUsage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "5", outputTokens: "2" }),
            }),
        ).toThrow("文本能力价格卡不支持维度：count");
        expect((await readAuthDb()).providerUsageAttempts).toEqual([]);
    });

    it("logs actionable context when a legacy attempt snapshot is missing a required pricing dimension", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:legacy-invalid-cost-dimension",
            requestFingerprint: "4".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner legacy provider price fixture",
        });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "fixture",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "output-tokens", dimension: "outputTokens", unitPrice: "1" }] },
            normalizedUsage: normalizeBillableUsage({ capability: "text", source: "reserve", inputTokens: "5", outputTokens: "10" }),
            observedUsage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "5", outputTokens: "2" }),
        });
        const db = await readAuthDb();
        db.providerUsageAttempts[0].costRateSnapshot = { version: 1, components: [{ id: "output-tokens", dimension: "count", unitPrice: "1" }] };
        await writeAuthDb(db);
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed" })).rejects.toMatchObject({ requiredDimension: "count", priceComponentId: "output-tokens" });
        expect(errorLog).toHaveBeenCalledWith(
            "Usage provider attempt pricing dimension missing",
            expect.objectContaining({
                holdId: billing.holdId,
                attemptId: expect.stringContaining("provider-attempt:"),
                taskId: undefined,
                runId: undefined,
                provider: "fixture",
                model: "writer",
                capability: "text",
                priceCardId: expect.stringContaining("rate-card-v1:"),
                priceComponentId: "output-tokens",
                requiredDimension: "count",
                usageKeys: expect.arrayContaining(["capability", "inputTokens", "outputTokens", "source"]),
                requestedUsage: expect.objectContaining({ inputTokens: "5" }),
                normalizedUsage: expect.objectContaining({ inputTokens: "5", outputTokens: "2" }),
                attemptStatus: "pending",
                holdStatus: "active",
            }),
        );
    });

    it("preserves the provider-attempt conflict type and status during planner finalization", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:terminal-conflict",
            requestFingerprint: "7".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner conflict fixture",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed" });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }));

        await expect(finishSystemAiTextAttempt(headers, { status: "succeeded" })).rejects.toMatchObject({
            code: "finish_attempt:wallet_conflict",
            status: 409,
        });
    });

    it("reconciles a validated planner response after its proxy transport was already canceled", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:transport-cancel-recovery",
            requestFingerprint: "6".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner transport cancellation fixture",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "canceled" });
        await settleCancelledUsageBilling({ billing, description: "proxy transport cancellation" });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }));

        await expect(finishSystemAiTextAttempt(headers, { status: "succeeded" })).resolves.toBeUndefined();

        const db = await readAuthDb();
        expect(db.walletHolds).toEqual([expect.objectContaining({ id: billing.holdId, status: "settled" })]);
        expect(db.providerUsageAttempts).toEqual([expect.objectContaining({ attemptNumber: 1, status: "canceled" })]);
        expect(db.usageCharges).toHaveLength(1);
    });

    it("does not reinterpret an unsettled canceled attempt as a successful planner response", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "agent-plan:active-cancel-conflict",
            requestFingerprint: "5".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "planner active cancellation fixture",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "canceled" });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }));

        await expect(finishSystemAiTextAttempt(headers, { status: "succeeded" })).rejects.toMatchObject({
            code: "finish_attempt:wallet_conflict",
            status: 409,
        });
    });

    it("preserves protocol completion billing when HTTP transport cancellation loses the local cleanup reason", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "text-task:http-terminal",
            requestFingerprint: "a".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "fixture",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2}}}\n\n'));
            },
        });
        const reader = meteredTextResponseBody(body, billing, 1).getReader();
        await reader.read();
        await reader.cancel();
        const db = await readAuthDb();
        expect(db.walletHolds[0].status).toBe("active");
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "pending", observedUsage: { inputTokens: "5", outputTokens: "2" } });
        expect(db.usageCharges).toEqual([]);
    });

    it("records the raw proxy stream body-timeout root cause without logging text content", async () => {
        vi.stubEnv("VOZEB_PRO_TEXT_STREAM_DIAGNOSTICS_TEST", "1");
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "text-task:proxy-diagnostic",
            requestFingerprint: "f".repeat(64),
            logicalModelId: "writer",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
            description: "fixture",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const rootError = Object.assign(new TypeError("terminated"), {
            cause: Object.assign(new Error("body timed out"), { name: "BodyTimeoutError", code: "UND_ERR_BODY_TIMEOUT" }),
        });
        let sent = false;
        const source = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (!sent) {
                    sent = true;
                    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"private streamed text"}}]}\n\n'));
                    return;
                }
                controller.error(rootError);
            },
        });
        const reader = meteredTextResponseBody(source, billing, 1, {
            protocol: "chat",
            diagnosticContext: { source: "system_proxy_upstream", taskId: "proxy-diagnostic", attemptNo: 1, channelId: "channel", model: "model" },
        }).getReader();

        await reader.read();
        await expect(reader.read()).rejects.toThrow("terminated");

        expect(warn).toHaveBeenCalledWith(
            "Text stream transport diagnostic",
            expect.objectContaining({ source: "system_proxy_upstream", taskId: "proxy-diagnostic", connectionTermination: "body_timeout", framesReceived: 1, bytesReceived: expect.any(Number) }),
        );
        expect(info).toHaveBeenCalledWith("Text stream frame diagnostic", expect.objectContaining({ source: "system_proxy_upstream", sequence: 1, textDelta: true }));
        expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain("private streamed text");
    });
    it("resubmits Custom async retry without polling its previous upstream task or restoring its scheduler result", async () => {
        const config = {
            baseUrl: "https://fixture.example",
            apiFormat: "openai" as const,
            apiKey: "fixture",
            model: "custom-model",
            advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom" as const, createPath: "/jobs", queryPath: "/jobs/:task_id", requestTemplate: '{"prompt":"{{prompt}}"}', resultField: "text" },
        };
        const task = await createTextTask({ userId: "user-one", config, messages: [{ role: "user", content: "fixture" }] });
        const upstream = vi
            .spyOn(outbound, "fetchSafeOutbound")
            .mockResolvedValueOnce(Response.json({ task_id: "old-upstream" }))
            .mockResolvedValueOnce(Response.json({ status: "failed" }))
            .mockResolvedValueOnce(Response.json({ task_id: "new-upstream" }));
        expect(await runTextTaskStep(task, "http://internal", "")).toMatchObject({ state: "pending", upstreamTaskId: "old-upstream" });
        await scheduleGenerationTask("text", task.id, { executionPhase: "submitted", upstreamTaskId: "old-upstream", submittedAt: Date.now(), resultPayload: { text: "stale" } });
        expect(await runTextTaskStep((await getTextTask(task.id))!, "http://internal", "")).toMatchObject({ state: "failed" });
        await retryTextTask((await getTextTask(task.id))!, { config, messages: [{ role: "user", content: "fixture" }], candidateConfigs: [] });
        expect(await getStoredGenerationTaskRecord("text", task.id)).toMatchObject({ executionPhase: "created" });
        expect((await getStoredGenerationTaskRecord("text", task.id))?.upstreamTaskId).toBeUndefined();
        expect((await getStoredGenerationTaskRecord("text", task.id))?.resultPayload).toBeUndefined();
        expect(await runTextTaskStep((await getTextTask(task.id))!, "http://internal", "")).toMatchObject({ state: "pending", upstreamTaskId: "new-upstream" });
        expect(upstream.mock.calls.map(([url, init]) => [String(url), init?.method || "GET"])).toEqual([
            ["https://fixture.example/v1/jobs", "POST"],
            ["https://fixture.example/v1/jobs/old-upstream", "GET"],
            ["https://fixture.example/v1/jobs", "POST"],
        ]);
    });
    it("creates a fresh persisted billing cycle for explicit retry and shares it only across that cycle's failovers", async () => {
        const rate = { version: 1 as const, components: [{ id: "request", dimension: "request" as const, unitPrice: "1" }] };
        const config = {
            apiSource: "system" as const,
            baseUrl: "/api/ai/system/fixture-channel",
            apiFormat: "openai" as const,
            apiKey: "system",
            model: "fixture-model",
            logicalModel: "writer",
            channelId: "fixture-channel",
            capabilityProfile: { maxOutputTokens: 128 },
            usagePricing: { logicalModelId: "writer", bindingId: "fixture-binding", saleRateCard: rate, costRateCard: rate, providerCostUnit: { kind: "fiat" as const, currency: "USD" as const } },
        };
        const db = await readAuthDb();
        vi.spyOn(session, "getCurrentUser").mockResolvedValue({ ...db.users[0], heldBalance: "0", availableBalance: "10", mfaEnabled: false });
        vi.spyOn(authStore, "getAuthSettings").mockResolvedValue({
            ...db.settings,
            logicalModels: [
                {
                    id: "writer",
                    name: "测试写作",
                    capability: "text",
                    enabled: true,
                    saleRateCard: rate,
                    bindings: [
                        {
                            id: "fixture-binding",
                            channelId: "fixture-channel",
                            upstreamModel: "fixture-model",
                            enabled: true,
                            priority: 1,
                            weight: 1,
                            costRateCard: rate,
                            providerCostUnit: { kind: "fiat", currency: "USD" },
                            capabilityProfile: { maxOutputTokens: 128 },
                        },
                    ],
                },
            ],
            systemChannels: [{ id: "fixture-channel", name: "fixture", enabled: true, baseUrl: "https://fixture.example/v1", apiKey: "fixture-key", apiFormat: "openai", models: ["fixture-model"] }],
        });
        vi.spyOn(security, "isSafeOutboundUrl").mockResolvedValue(true);
        vi.spyOn(internal, "fetchInternalApi").mockImplementation(async (url, init) => {
            const target = new URL(url);
            const headers = new Headers(init?.headers);
            finalizeSystemAiUsageRequestHeaders(headers, { method: "POST", canonicalPath: target.pathname, canonicalQuery: target.searchParams.toString(), bodyDigest: createHash("sha256").update(String(init?.body)).digest("hex") });
            return systemProxyPost(new Request(url, { ...init, headers }), { params: Promise.resolve({ channelId: "fixture-channel", path: ["chat", "completions"] }) });
        });
        const responses = [
            'data: {"error":{"message":"fixture failure"}}\n\n',
            'data: {"error":{"message":"retry failover"}}\n\n',
            'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
        ];
        const upstream = vi.spyOn(outbound, "fetchSafeOutbound").mockImplementation(async () => new Response(responses.shift(), { headers: { "content-type": "text/event-stream" } }));
        const task = await createTextTask({ userId: "user-one", config, messages: [{ role: "user", content: "fixture" }] });
        expect(await runTextTaskStep(task, "http://internal", "")).toMatchObject({ state: "failed" });
        const failed = (await getTextTask(task.id))!;
        const firstAudit = structuredClone(failed.attempts);
        const firstBilling = await readAuthDb();
        expect(firstBilling.walletHolds[0].status).toBe("released");

        await retryTextTask(failed, { config, candidateConfigs: [config], messages: [{ role: "user", content: "fixture" }] });
        const retried = (await getTextTask(task.id))!;
        expect(await runTextTaskStep(retried, "http://internal", "")).toEqual({ state: "completed" });
        expect(upstream).toHaveBeenCalledTimes(3);
        const completed = (await getTextTask(task.id))!;
        expect(completed.id).toBe(task.id);
        expect(completed.attempts?.slice(0, 1)).toEqual(firstAudit);
        expect(completed.attempts?.map((attempt) => attempt.status)).toEqual(["failed", "failed", "succeeded"]);
        const settled = await readAuthDb();
        expect(settled.walletHolds).toHaveLength(2);
        expect(settled.walletHolds.find((hold) => hold.id === firstBilling.walletHolds[0].id)).toEqual(firstBilling.walletHolds[0]);
        const retryHold = settled.walletHolds.find((hold) => hold.id !== firstBilling.walletHolds[0].id)!;
        expect(retryHold).toMatchObject({ status: "settled", runtimeSnapshot: { recovery: { taskType: "text", taskId: task.id } } });
        expect(
            settled.providerUsageAttempts
                .filter((attempt) => attempt.holdId === retryHold.id)
                .map((attempt) => attempt.status)
                .sort(),
        ).toEqual(["failed", "succeeded"]);
        expect(settled.usageCharges).toHaveLength(1);
    });
    it("settles multiline terminal usage on an open Responses stream exactly once", async () => {
        const task = await createTextTask({
            userId: "user-one",
            messages: [{ role: "user", content: "fixture" }],
            config: { baseUrl: "https://fixture.example", apiFormat: "openai", apiKey: "fixture", model: "text-model", advancedConfig: { ...emptyAdvancedConfig(), createPath: "/responses" } },
        });
        const rate = {
            version: 1 as const,
            components: [
                { id: "input", dimension: "inputTokens" as const, unitPrice: "0.1" },
                { id: "cached", dimension: "cachedInputTokens" as const, unitPrice: "0.01" },
                { id: "output", dimension: "outputTokens" as const, unitPrice: "0.2" },
            ],
        };
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: `text-task:${task.id}`,
            requestFingerprint: createHash("sha256").update(task.id).digest("hex"),
            logicalModelId: "text-model",
            saleRateSnapshot: rate,
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", cachedInputTokens: "0", maxOutputTokens: "10" }),
            description: "文本预留",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" }, costRateSnapshot: rate });
        let sourceController!: ReadableStreamDefaultController<Uint8Array>;
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                sourceController = controller;
                controller.enqueue(
                    new TextEncoder().encode(
                        'data: {"type":"response.output_text.delta","delta":"完成"}\n\nevent: response.completed\ndata: {"type":"response.completed",\ndata: "response":{"usage":{"input_tokens":5,"output_tokens":2,\ndata: "input_tokens_details":{"cached_tokens":1}}}}\n\n',
                    ),
                );
            },
        });
        vi.spyOn(outbound, "fetchSafeOutbound").mockResolvedValue(
            new Response(meteredTextResponseBody(source, billing, 1), { headers: { "content-type": "text/event-stream", ...systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }) } }),
        );
        let settled = false;
        const execution = runTextTaskStep(task, "http://internal", "").then((result) => {
            settled = true;
            return result;
        });
        try {
            // The persisted public snapshot proves the runtime consumed this stream before checking completion.
            await vi.waitFor(async () => expect((await getTextTask(task.id))?.visibleTextSnapshot?.content).toBe("完成"));
            await vi.waitFor(() => expect(settled).toBe(true));
        } finally {
            if (!settled) sourceController.close();
            await execution;
        }
        const db = await readAuthDb();
        expect(db.walletHolds[0].status).toBe("settled");
        expect(db.usageCharges).toHaveLength(1);
        expect(db.usageCharges[0]).toMatchObject({ settledCredits: "0.81", estimated: false });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "succeeded", normalizedUsage: { inputTokens: "4", cachedInputTokens: "1", outputTokens: "2" } });
        expect(db.pointRecords.filter((record) => record.type === "consume")).toHaveLength(1);
    });
    it.each([
        {
            protocol: "chat",
            path: "/chat/completions",
            frames: 'data: {"choices":[{"delta":{"content":"部分"}}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":1}}}\n\ndata: {"error":{"message":"fixture"}}\n\n',
        },
        {
            protocol: "claude",
            path: "/messages",
            frames: 'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"cache_read_input_tokens":1,"cache_creation_input_tokens":0}}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"部分"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":1}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\ndata: {"type":"error","error":{"message":"fixture"}}\n\n',
        },
        {
            protocol: "responses",
            path: "/responses",
            frames: 'data: {"type":"response.output_text.delta","delta":"部分"}\n\ndata: {"type":"response.failed","response":{"usage":{"input_tokens":5,"output_tokens":2,"input_tokens_details":{"cached_tokens":1}},"error":{"message":"fixture"}}}\n\n',
        },
    ])("retains $protocol streaming failure usage and nonzero supplier cost before EOF", async ({ path, frames }) => {
        const task = await createTextTask({
            userId: "user-one",
            messages: [{ role: "user", content: "fixture" }],
            config: { baseUrl: "https://fixture.example", apiFormat: "openai", apiKey: "fixture", model: "text-model", advancedConfig: { ...emptyAdvancedConfig(), createPath: path }, capabilityProfile: { maxOutputTokens: 128 } },
        });
        const requestUsage = normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", cachedInputTokens: "0", maxOutputTokens: "128" });
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: `text-task:${task.id}`,
            requestFingerprint: createHash("sha256").update(task.id).digest("hex"),
            logicalModelId: "text-model",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1.5" }] },
            requestUsage,
            description: "文本预留",
        });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "fixture",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: {
                version: 1,
                components: [
                    { id: "input", dimension: "inputTokens", unitPrice: "0.1" },
                    { id: "output", dimension: "outputTokens", unitPrice: "0.2" },
                    { id: "cached", dimension: "cachedInputTokens", unitPrice: "0.01" },
                ],
            },
            normalizedUsage: requestUsage,
        });
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(frames));
            },
        });
        const response = new Response(meteredTextResponseBody(source, billing, 1), {
            headers: { "content-type": "text/event-stream", ...systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: 1, requestFingerprint: billing.requestFingerprint }) },
        });
        vi.spyOn(outbound, "fetchSafeOutbound").mockResolvedValue(response);
        await expect(runTextTaskStep(task, "http://internal", "")).resolves.toMatchObject({ state: "failed" });
        const db = await readAuthDb();
        expect(db.walletHolds[0].status).toBe("released");
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "failed", nativeCostAmount: "0.81", costUsd: "0.81", normalizedUsage: { inputTokens: "4", cachedInputTokens: "1", outputTokens: "2" } });
        expect(db.usageCharges).toEqual([]);
        if (path === "/responses") expect((await getTextTask(task.id))?.attempts?.[0]).toMatchObject({ usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } });
    });

    it("keeps a failed text attempt hold active when its stream is closed before failover", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "text-task:stream-failover",
            requestFingerprint: createHash("sha256").update("stream-failover").digest("hex"),
            logicalModelId: "text-model",
            saleRateSnapshot: { version: 1, components: [{ id: "request", dimension: "request", unitPrice: "1.5" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", cachedInputTokens: "0", maxOutputTokens: "128" }),
            description: "文本生成预留",
        });
        await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "vendor", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"fixture"}}\n\n'));
            },
        });
        const reader = meteredTextResponseBody(source, billing, 1).getReader();
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed" });
        await reader.cancel("failed attempt cleanup");
        const db = await readAuthDb();
        expect(db.walletHolds[0].status).toBe("active");
        expect(db.providerUsageAttempts[0].status).toBe("failed");
        expect(db.usageCharges).toEqual([]);
    });

    it("settles an active business hold immediately when its persisted task succeeds", async () => {
        const billing = await reservation("terminal-success");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        });
        await finalizeUsageBillingForBusiness({
            userId: billing.userId,
            businessId: billing.businessId,
            inspect: async () => ({ state: "succeeded", actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) }),
        });
        const db = await readAuthDb();

        expect(db.walletHolds[0]).toMatchObject({ status: "settled" });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "succeeded", nativeCostAmount: "0.375" });
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1.5", estimated: false })]);
    });

    it("releases an active business hold without a usage charge when its persisted task fails", async () => {
        const billing = await reservation("terminal-failure");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            normalizedUsage: imageRequest,
        });
        await finalizeUsageBillingForBusiness({
            userId: billing.userId,
            businessId: billing.businessId,
            inspect: async () => ({ state: "failed", reason: "供应商确认失败" }),
        });
        const db = await readAuthDb();

        expect(db.walletHolds[0]).toMatchObject({ status: "released", releaseReason: "供应商确认失败" });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "failed" });
        expect(db.usageCharges).toEqual([]);
        expect(db.pointRecords).toEqual([expect.objectContaining({ id: "opening-credit" })]);
    });

    it("settles an accepted provider attempt when the persisted task is later cancelled", async () => {
        const billing = await reservation("terminal-cancelled");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0.4",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            normalizedUsage: imageRequest,
        });
        await finalizeUsageBillingForBusiness({
            userId: billing.userId,
            businessId: billing.businessId,
            inspect: async () => ({ state: "canceled", description: "用户取消已被上游接受的任务" }),
        });
        const db = await readAuthDb();

        expect(db.walletHolds[0]).toMatchObject({ status: "settled" });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "canceled", upstreamTaskId: "upstream-one" });
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1.5", estimated: true, totalProviderCostUsd: "0.4" })]);
    });

    it("sums failed and successful provider costs while charging once from the frozen sale snapshot", async () => {
        const billing = await reservation("failover");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "failed",
            provider: "vendor-a",
            bindingId: "binding-a",
            nativeCostAmount: "2",
            nativeCostUnit: { kind: "provider-native", provider: "vendor-a", unit: "job", usdConversion: { version: "fx-old", usdPerUnit: "0.125" } },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2" }] },
            normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }),
        });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 2,
            status: "succeeded",
            provider: "vendor-b",
            bindingId: "binding-b",
            nativeCostAmount: "0.2",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.2" }] },
            normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }),
        });

        const settled = await settleUsageBilling({ billing, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "图片生成结算" });
        const db = await readAuthDb();

        expect(settled.charge).toMatchObject({
            settledCredits: "1.5",
            totalProviderCostUsd: "0.45",
            runtimeSnapshot: { logicalModelId: "image-pro", saleRateSnapshot: imageSale, reserve: { credits: "1.5" }, reservedCredits: "1.5" },
            finalSaleCharge: { usage: { source: "actual" }, estimated: false },
        });
        expect(db.pointRecords.filter((record) => record.type === "consume")).toHaveLength(1);
        expect(db.providerUsageAttempts.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
    });

    it("ignores sale and FX edits made after reserve", async () => {
        const billing = await reservation("immutable");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "succeeded",
            provider: "vendor",
            bindingId: "binding",
            nativeCostAmount: "2",
            nativeCostUnit: { kind: "provider-native", provider: "vendor", unit: "job", usdConversion: { version: "fx-old", usdPerUnit: "0.125" } },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2" }] },
        });

        const settled = await settleUsageBilling({
            billing,
            actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }),
            description: "冻结快照结算",
        });

        expect(settled.charge).toMatchObject({ settledCredits: "1.5", totalProviderCostUsd: "0.25", saleRateSnapshot: imageSale });
        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({ usdConversionRate: "0.125", nativeCostUnit: { usdConversion: { version: "fx-old" } } });
    });

    it("selects actual, derived, then reserve fallback usage markers", async () => {
        const actual = await reservation("actual");
        await settleUsageBilling({ billing: actual, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "actual" });
        const derived = await reservation("derived");
        await settleUsageBilling({ billing: derived, derivedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }), description: "derived" });
        const fallback = await reservation("fallback");
        await settleUsageBilling({ billing: fallback, description: "fallback" });

        expect((await readAuthDb()).usageCharges.map((charge) => ({ source: charge.normalizedUsage.source, estimated: charge.estimated }))).toEqual([
            { source: "actual", estimated: false },
            { source: "derived", estimated: false },
            { source: "reserve", estimated: true },
        ]);
    });

    it("releases provider failures but charges a user cancellation after accepted work", async () => {
        const failed = await reservation("failed");
        await recordUsageProviderAttempt({ billing: failed, attemptNumber: 1, status: "failed", provider: "vendor", bindingId: "binding", nativeCostAmount: "0.3", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await releaseUsageBilling({ billing: failed, reason: "供应商确认失败" });

        const cancelled = await reservation("cancelled");
        await recordUsageProviderAttempt({ billing: cancelled, attemptNumber: 1, status: "canceled", provider: "vendor", bindingId: "binding", upstreamTaskId: "upstream-one", nativeCostAmount: "0.4", nativeCostUnit: { kind: "fiat", currency: "USD" } });
        await settleCancelledUsageBilling({ billing: cancelled, description: "用户取消已接受任务" });

        const db = await readAuthDb();
        expect(db.walletHolds.map((hold) => hold.status)).toEqual(["released", "settled"]);
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1.5", estimated: true, totalProviderCostUsd: "0.4" })]);
    });

    it("settles a free success as an auditable usage charge without a point record", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "runtime:free",
            requestFingerprint: "f".repeat(64),
            logicalModelId: "free-image",
            saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0" }] },
            requestUsage: imageRequest,
            description: "免费图片预留",
        });

        await settleUsageBilling({ billing, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "免费图片结算" });
        const db = await readAuthDb();

        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "0" })]);
        expect(db.pointRecords).toEqual([expect.objectContaining({ id: "opening-credit" })]);
    });

    it("finishes a persisted pending attempt from its frozen cost snapshot", async () => {
        const billing = await reservation("pending-finish");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencyKey: "task:attempt:1",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
        });

        const reloaded = await loadUsageBilling(billing.holdId);
        await finishUsageProviderAttempt({ billing: reloaded, attemptNumber: 1, status: "succeeded", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) });
        await settleUsageBilling({ billing: reloaded, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "pending" });

        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({ status: "succeeded", nativeCostAmount: "0.375", costUsd: "0.375", upstreamTaskId: "upstream-one" });
    });

    it("freezes business identity and provider idempotency capability in audit snapshots", async () => {
        const billing = await reservation("audit-identities");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "task:attempt:1",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
        });
        const db = await readAuthDb();

        expect(db.walletHolds[0].runtimeSnapshot).toMatchObject({ businessId: "runtime:audit-identities", originalRequestFingerprint: createHash("sha256").update("audit-identities").digest("hex") });
        expect(db.providerUsageAttempts[0]).toMatchObject({ providerIdempotencySupported: true });
    });

    it("retains failed-attempt cost evidence and sums it with the successful failover", async () => {
        const billing = await reservation("failover-cost");
        const costRateSnapshot = { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "0.25" }] };
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "primary",
            bindingId: "primary",
            providerIdempotencySupported: false,
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot,
        });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }) });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 2,
            status: "pending",
            provider: "backup",
            bindingId: "backup",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "backup:2",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot,
        });
        await finishUsageProviderAttempt({ billing, attemptNumber: 2, status: "succeeded", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) });
        await settleUsageBilling({ billing, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }), description: "failover" });

        expect((await readAuthDb()).usageCharges[0]).toMatchObject({ settledCredits: "1.5", totalProviderCostUsd: "0.5" });
    });

    it("reuses the first sale snapshot when pricing changes between failover attempts", async () => {
        const first = await reservation("pricing-failover");
        const second = await reserveOrReuseUsageBilling({
            userId: first.userId,
            businessId: first.businessId,
            requestFingerprint: first.requestFingerprint,
            logicalModelId: "image-pro",
            saleRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "99" }] },
            requestUsage: imageRequest,
            description: "edited price",
        });

        expect(second.holdId).toBe(first.holdId);
        expect(second.snapshot.saleRateSnapshot).toMatchObject(imageSale);
        expect(second.snapshot.saleRateSnapshot.revision).toBe(first.snapshot.saleRateSnapshot.revision);
        expect(second.snapshot.reservedCredits).toBe("1.5");
    });

    it("binds a persisted upstream task identity once without settling the async attempt", async () => {
        const billing = await reservation("attach-upstream");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencyKey: "task:attempt:1",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        });

        await attachUsageProviderUpstreamTaskId({ holdId: billing.holdId, attemptNumber: 1, upstreamTaskId: "upstream-one" });
        await attachUsageProviderUpstreamTaskId({ holdId: billing.holdId, attemptNumber: 1, upstreamTaskId: "upstream-one" });

        expect((await readAuthDb()).providerUsageAttempts[0]).toMatchObject({ status: "pending", upstreamTaskId: "upstream-one" });
        await expect(attachUsageProviderUpstreamTaskId({ holdId: billing.holdId, attemptNumber: 1, upstreamTaskId: "changed" })).rejects.toThrow("参数不一致");
    });

    it("rejects provider identity and cost snapshot edits while an attempt is completing", async () => {
        const billing = await reservation("attempt-immutable");
        const pending = {
            billing,
            attemptNumber: 1,
            status: "pending" as const,
            provider: "vendor",
            bindingId: "binding",
            providerIdempotencyKey: "task:attempt:1",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat" as const, currency: "USD" as const },
            costRateSnapshot: { version: 1 as const, components: [{ id: "count", dimension: "count" as const, unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        };
        await recordUsageProviderAttempt(pending);

        await expect(recordUsageProviderAttempt({ ...pending, status: "succeeded", providerIdempotencyKey: "changed-key", nativeCostAmount: "0.375" })).rejects.toThrow("参数不一致");
        await expect(recordUsageProviderAttempt({ ...pending, status: "succeeded", costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "99" }] }, nativeCostAmount: "99" })).rejects.toThrow("参数不一致");
    });

    it("releases an ambiguous pending system text attempt without creating consumption", async () => {
        const billing = await reservation("system-text-pending");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "primary",
            bindingId: "binding-primary",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "system-text-pending:attempt:1",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.25" }] },
            normalizedUsage: imageRequest,
        });

        const resolution = await resolveSystemAiTextFailure({ userId: "user-one", businessId: billing.businessId, reason: "transport acceptance unknown", final: true });
        const db = await readAuthDb();

        expect(resolution).toEqual({ state: "released" });
        expect(db.walletHolds[0]).toMatchObject({ status: "released", releaseReason: "transport acceptance unknown" });
        expect(db.providerUsageAttempts).toEqual([expect.objectContaining({ status: "failed" })]);
        expect(db.usageCharges).toEqual([]);
    });

    it("allows failover only after a terminal failure and releases all-failed work without erasing cost evidence", async () => {
        const billing = await reservation("system-text-terminal");
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "primary",
            bindingId: "binding-primary",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.25" }] },
            normalizedUsage: imageRequest,
        });
        await finishUsageProviderAttempt({ billing, attemptNumber: 1, status: "failed", normalizedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }) });

        await expect(resolveSystemAiTextFailure({ userId: "user-one", businessId: billing.businessId, reason: "invalid response", final: false })).resolves.toEqual({ state: "safe_to_failover" });
        expect((await readAuthDb()).walletHolds[0]).toMatchObject({ status: "active" });
        await expect(resolveSystemAiTextFailure({ userId: "user-one", businessId: billing.businessId, reason: "all candidates failed", final: true })).resolves.toEqual({ state: "released" });

        const db = await readAuthDb();
        expect(db.walletHolds[0]).toMatchObject({ status: "released", releaseReason: "all candidates failed" });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "failed", nativeCostAmount: "0.25", costUsd: "0.25" });
    });

    it("does not retry an ambiguous transport when no persisted hold exists", async () => {
        await expect(resolveSystemAiTextFailure({ userId: "user-one", businessId: "runtime:not-received", reason: "proxy rejected before provider", final: false, requestNotReceived: true })).resolves.toEqual({ state: "safe_to_failover" });
        await expect(resolveSystemAiTextFailure({ userId: "user-one", businessId: "runtime:unknown-transport", reason: "transport unknown", final: false })).resolves.toEqual({ state: "closed" });
        await expect(
            resolveSystemAiTextFailure({
                userId: "user-one",
                businessId: "runtime:current-attempt-unknown",
                reason: "current attempt acceptance unknown",
                final: false,
                requestNotReceived: true,
                currentAttempt: { attemptNumber: 2, acceptance: "unknown" },
            }),
        ).resolves.toEqual({ state: "closed" });
    });
});

describe("orphan usage recovery", () => {
    it("retains the current text cycle hold between failover attempts and settles only its successful usage", async () => {
        const config = { baseUrl: "https://fixture.example", apiFormat: "openai" as const, apiKey: "fixture", model: "text-model" };
        const task = await createTextTask({ userId: "user-one", config, messages: [], billingCycleId: "current-retry" });
        const businessId = `text-task:${task.id}:cycle:current-retry`;
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId,
            requestFingerprint: createHash("sha256").update(businessId).digest("hex"),
            logicalModelId: "text-model",
            saleRateSnapshot: { version: 1, components: [{ id: "input", dimension: "inputTokens", unitPrice: "0.01" }] },
            requestUsage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "10", maxOutputTokens: "20" }),
            description: "文本预留",
            expiresAt: new Date("2026-08-23T00:00:00.000Z"),
            recovery: usageRecoveryIdentity(businessId),
        });
        const running = (await transitionTextTask(task, ["pending"], { status: "running" }))!;
        const first = (await openTextTaskAttempt(running, config, "chat", [config]))!;
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "failed",
            provider: "fixture",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            normalizedUsage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "2" }),
        });
        const switching = (await closeTextTaskAttempt(task.id, first.activeAttemptId!, "failed", { error: "switch candidate" }))!;
        expect(await recoverOrphanUsageHolds({ limit: 5, now: new Date(), inspect: inspectPersistedUsageHold })).toEqual({ inspected: 1, retained: 1, settled: 0, released: 0 });
        expect((await readAuthDb()).walletHolds[0].status).toBe("active");
        const second = (await openTextTaskAttempt(switching, config, "chat", []))!;
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 2,
            status: "succeeded",
            provider: "fixture",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            normalizedUsage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "7" }),
        });
        await transitionTextTask(second, ["running"], { status: "success", result: { content: "完成" } });
        await closeTextTaskAttempt(task.id, second.activeAttemptId!, "succeeded");
        expect(await recoverOrphanUsageHolds({ limit: 5, now: new Date(), inspect: inspectPersistedUsageHold })).toEqual({ inspected: 1, retained: 0, settled: 1, released: 0 });
        const recovered = await readAuthDb();
        expect(recovered.walletHolds).toHaveLength(1);
        expect(recovered.usageCharges[0]).toMatchObject({ settledCredits: "0.07", estimated: false });
    });
    it.each([undefined, "prior-retry"])("releases a crashed failed cycle %s after the stable text task succeeds on explicit retry", async (billingCycleId) => {
        const config = { baseUrl: "https://fixture.example", apiFormat: "openai" as const, apiKey: "fixture", model: "text-model" };
        const messages = [{ role: "user" as const, content: "fixture" }];
        const task = await createTextTask({ userId: "user-one", config, messages, billingCycleId });
        const rate = { version: 1 as const, components: [{ id: "request", dimension: "request" as const, unitPrice: "1" }] };
        const reserve = async (businessId: string) => {
            const billing = await reserveUsageBilling({
                userId: "user-one",
                businessId,
                requestFingerprint: createHash("sha256").update(businessId).digest("hex"),
                logicalModelId: "text-model",
                saleRateSnapshot: rate,
                requestUsage: normalizeBillableUsage({ capability: "text", source: "request", request: "1", inputTokens: "5", maxOutputTokens: "10" }),
                description: "文本预留",
                expiresAt: new Date("2026-08-23T00:00:00.000Z"),
                recovery: usageRecoveryIdentity(businessId),
            });
            await recordUsageProviderAttempt({ billing, attemptNumber: 1, status: "pending", provider: "fixture", bindingId: "binding", nativeCostAmount: "0", nativeCostUnit: { kind: "fiat", currency: "USD" } });
            return billing;
        };
        const oldBilling = await reserve(textTaskBillingBusinessId(task));
        const running = (await transitionTextTask(task, ["pending"], { status: "running" }))!;
        const opened = (await openTextTaskAttempt(running, config, "chat", []))!;
        // Crash after persisting the failed task/attempt but before releasing its active hold.
        const failed = (await transitionTextTask(opened, ["running"], { status: "error", error: "old cycle failed" }))!;
        await closeTextTaskAttempt(task.id, failed.activeAttemptId!, "failed", { error: "old cycle failed" });
        const oldAudit = structuredClone((await getTextTask(task.id))!.attempts);
        const retried = (await retryTextTask((await getTextTask(task.id))!, { config, messages, candidateConfigs: [] }))!;
        const newBilling = await reserve(textTaskBillingBusinessId(retried));
        const body = new Response('data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n').body!;
        vi.spyOn(outbound, "fetchSafeOutbound").mockResolvedValue(
            new Response(meteredTextResponseBody(body, newBilling, 1), {
                headers: { "content-type": "text/event-stream", ...systemAiUsageResponseHeaders({ holdId: newBilling.holdId, attemptNumber: 1, requestFingerprint: newBilling.requestFingerprint }) },
            }),
        );
        expect(await runTextTaskStep(retried, "http://internal", "")).toEqual({ state: "completed" });
        const beforeRecovery = await readAuthDb();
        expect(beforeRecovery.walletHolds.find((hold) => hold.id === oldBilling.holdId)?.status).toBe("active");
        expect(beforeRecovery.walletHolds.find((hold) => hold.id === newBilling.holdId)?.status).toBe("settled");
        const result = await recoverOrphanUsageHolds({ limit: 5, now: new Date(), inspect: inspectPersistedUsageHold });
        expect(result).toEqual({ inspected: 1, retained: 0, settled: 0, released: 1 });
        const recovered = await readAuthDb();
        expect(recovered.walletHolds.find((hold) => hold.id === oldBilling.holdId)).toMatchObject({ status: "released", releaseReason: "old cycle failed" });
        expect(recovered.providerUsageAttempts.find((attempt) => attempt.holdId === oldBilling.holdId)?.status).toBe("failed");
        expect(recovered.usageCharges).toHaveLength(1);
        expect(recovered.usageCharges[0]).toMatchObject({ holdId: newBilling.holdId, settledCredits: "1", estimated: false });
        expect(recovered.users[0].settledBalance).toBe("9");
        expect(recovered.pointRecords.filter((record) => record.type === "consume")).toHaveLength(1);
        const completed = (await getTextTask(task.id))!;
        expect(completed).toMatchObject({ id: task.id, status: "success" });
        expect(completed.attempts?.slice(0, 1)).toEqual(oldAudit);
    });
    it("releases unknown holds without creating consumption", async () => {
        await reservation("unknown", new Date("2026-08-23T00:00:00.000Z"));

        const result = await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "供应商状态未知" })) });
        const hold = (await readAuthDb()).walletHolds[0];

        expect(result).toEqual({ inspected: 1, retained: 0, settled: 0, released: 1 });
        expect(hold).toMatchObject({ status: "released", releaseReason: "供应商状态未知" });
        expect((await readAuthDb()).usageCharges).toEqual([]);
    });

    it("releases an unknown hold when partial provider evidence omits a priced request dimension", async () => {
        const billing = await reservation("unknown-partial-usage", new Date("2026-08-23T00:00:00.000Z"));
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
            observedUsage: normalizeBillableUsage({ capability: "image", source: "actual", resolution: "1024x1024" }),
        });

        const result = await recoverOrphanUsageHolds({
            limit: 5,
            now: new Date("2026-08-23T01:00:00.000Z"),
            inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "供应商状态未知" })),
        });
        const db = await readAuthDb();

        expect(result).toEqual({ inspected: 1, retained: 0, settled: 0, released: 1 });
        expect(db.walletHolds[0]).toMatchObject({ status: "released", releaseReason: "供应商状态未知" });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "failed", nativeCostAmount: "0.375", normalizedUsage: { count: "1", resolution: "1024x1024" } });
        expect(db.usageCharges).toEqual([]);
    });

    it("preserves a requested count greater than one when failed recovery has partial provider evidence", async () => {
        const billing = await reserveUsageBilling({
            userId: "user-one",
            businessId: "runtime:unknown-partial-multi-output",
            requestFingerprint: createHash("sha256").update("unknown-partial-multi-output").digest("hex"),
            logicalModelId: "image-pro",
            saleRateSnapshot: imageSale,
            requestUsage: normalizeBillableUsage({ capability: "image", source: "request", count: 3, resolution: "1024x1024" }),
            description: "图片生成预留",
            expiresAt: new Date("2026-08-23T00:00:00.000Z"),
        });
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: normalizeBillableUsage({ capability: "image", source: "reserve", count: 3, resolution: "1024x1024" }),
            observedUsage: normalizeBillableUsage({ capability: "image", source: "actual", resolution: "1024x1024" }),
        });

        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "供应商状态未知" })) });
        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T02:00:00.000Z"), inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "供应商状态未知" })) });
        const db = await readAuthDb();

        expect(db.walletHolds[0]).toMatchObject({ status: "released" });
        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "failed", nativeCostAmount: "1.125", normalizedUsage: { count: "3", resolution: "1024x1024" } });
        expect(db.usageCharges).toEqual([]);
        expect(db.pointRecords).toEqual([expect.objectContaining({ id: "opening-credit" })]);
    });

    it("advances bounded recovery after releasing an unknown hold", async () => {
        await reservation("reviewed-first", new Date("2026-08-23T00:00:00.000Z"));
        await reservation("later", new Date("2026-08-23T00:01:00.000Z"));
        const now = new Date("2026-08-23T01:00:00.000Z");
        await recoverOrphanUsageHolds({ limit: 1, now, inspect: vi.fn(async () => ({ state: "unknown" as const, reason: "人工复核" })) });
        const inspect = vi.fn(async () => ({ state: "failed" as const, reason: "确认失败" }));
        await recoverOrphanUsageHolds({ limit: 1, now, inspect });

        expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ businessId: "runtime:later" }));
    });

    it("rotates a retained pending hold behind other eligible work in the bounded batch", async () => {
        await reservation("pending-first", new Date("2026-08-23T00:00:00.000Z"));
        await reservation("terminal-later", new Date("2026-08-23T00:01:00.000Z"));
        const now = new Date("2026-08-23T01:00:00.000Z");

        await recoverOrphanUsageHolds({ limit: 1, now, inspect: vi.fn(async () => ({ state: "pending" as const, upstreamTaskId: "upstream-pending" })) });
        const inspect = vi.fn(async () => ({ state: "failed" as const, reason: "确认失败" }));
        await recoverOrphanUsageHolds({ limit: 1, now, inspect });

        expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ businessId: "runtime:terminal-later" }));
        expect((await readAuthDb()).walletHolds.find((hold) => hold.businessId === "runtime:pending-first")).toMatchObject({ status: "active", recoveryCheckedAt: now.toISOString() });
    });

    it("releases confirmed failures and settles confirmed successes from snapshots", async () => {
        await reservation("orphan-failure", new Date("2026-08-23T00:00:00.000Z"));
        await reservation("orphan-success", new Date("2026-08-23T00:00:00.000Z"));
        const inspect = vi.fn(async (hold: { businessId: string }) =>
            hold.businessId.endsWith("failure") ? { state: "failed" as const, reason: "上游确认失败" } : { state: "succeeded" as const, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) },
        );

        const result = await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect });
        const db = await readAuthDb();

        expect(result).toEqual({ inspected: 2, retained: 0, released: 1, settled: 1 });
        expect(db.walletHolds.map((hold) => hold.status)).toEqual(["released", "settled"]);
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1.5", estimated: false })]);
    });

    it("finishes a recovered successful attempt with its frozen provider cost rate", async () => {
        const billing = await reservation("orphan-provider-cost", new Date("2026-08-23T00:00:00.000Z"));
        await recordUsageProviderAttempt({
            billing,
            attemptNumber: 1,
            status: "pending",
            provider: "vendor",
            bindingId: "binding",
            upstreamTaskId: "upstream-one",
            nativeCostAmount: "0",
            nativeCostUnit: { kind: "fiat", currency: "USD" },
            costRateSnapshot: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "0.375" }] },
            normalizedUsage: imageRequest,
        });

        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect: vi.fn(async () => ({ state: "succeeded" as const, derivedUsage: normalizeBillableUsage({ capability: "image", source: "derived", count: 1 }) })) });
        const db = await readAuthDb();

        expect(db.providerUsageAttempts[0]).toMatchObject({ status: "succeeded", nativeCostAmount: "0.375", costUsd: "0.375" });
        expect(db.usageCharges[0]).toMatchObject({ totalProviderCostUsd: "0.375" });
    });

    it("does not recreate or double-settle work when recovery is replayed", async () => {
        await reservation("replay", new Date("2026-08-23T00:00:00.000Z"));
        const inspect = vi.fn(async () => ({ state: "succeeded" as const, actualUsage: normalizeBillableUsage({ capability: "image", source: "actual", count: 1 }) }));

        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T01:00:00.000Z"), inspect });
        await recoverOrphanUsageHolds({ limit: 5, now: new Date("2026-08-23T02:00:00.000Z"), inspect });

        expect(inspect).toHaveBeenCalledTimes(1);
        expect((await readAuthDb()).usageCharges).toHaveLength(1);
    });
});

async function reservation(name: string, expiresAt?: Date) {
    return reserveUsageBilling({
        userId: "user-one",
        businessId: `runtime:${name}`,
        requestFingerprint: createHash("sha256").update(name).digest("hex"),
        logicalModelId: "image-pro",
        saleRateSnapshot: imageSale,
        requestUsage: imageRequest,
        description: "图片生成预留",
        expiresAt,
        recovery: { taskType: "image", taskId: `task-${name}` },
    });
}
