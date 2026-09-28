import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

import type { VideoValidationItem } from "@/lib/video-validation";
import { processVideoValidationBatchWithDependencies, processVideoValidationItem } from "./video-validation-worker";

function item(overrides: Partial<VideoValidationItem> = {}): VideoValidationItem {
    return {
        id: "item",
        runId: "run",
        logicalModelId: "model",
        bindingId: "binding",
        channelId: "channel",
        upstreamModelId: "video",
        contractFamily: "family",
        caseId: "text-to-video",
        testLevel: "FAMILY_CANARY",
        status: "reserved",
        probeStatus: "CONTRACT_READY",
        normalizedContext: { count: "1", durationSeconds: "5", resolution: "720p", aspectRatio: "16:9", generateAudio: false, watermark: false, references: [] },
        capabilityRevision: "cap",
        pricingRevision: "price",
        estimatedCostHotxCredits: "1.134",
        executionSnapshotHash: "snapshot",
        idempotencyKey: "video-validation:item",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
        ...overrides,
    };
}

describe("video validation worker", () => {
    it("claims queued work, reserves the Decimal budget before submit and aggregates the run", async () => {
        const queued = item({ status: "queued" });
        const reserveItemBudget = vi.fn(async () => "RESERVED" as const);
        const aggregateRun = vi.fn(async () => undefined);
        const result = await processVideoValidationBatchWithDependencies(
            { workerId: "worker", limit: 1 },
            {
                claimNextItems: vi.fn(async () => [queued]),
                reserveItemBudget,
                processItem: vi.fn(async () => ({ status: "passed" as const, providerTaskId: "provider-task" })),
                aggregateRun,
                skipItem: vi.fn(async () => undefined),
                now: () => "2026-09-26T00:01:00.000Z",
            },
        );
        expect(reserveItemBudget).toHaveBeenCalledWith({ runId: "run", itemId: "item", executionSnapshotHash: "snapshot", now: "2026-09-26T00:01:00.000Z" });
        expect(aggregateRun).toHaveBeenCalledWith("run");
        expect(result).toEqual({ claimed: 1, processed: 1, skippedBudget: 0 });
    });

    it("skips only the item when its hard-budget reservation fails", async () => {
        const skipItem = vi.fn(async () => undefined);
        const result = await processVideoValidationBatchWithDependencies(
            { workerId: "worker", limit: 1 },
            {
                claimNextItems: vi.fn(async () => [item({ status: "queued" })]),
                reserveItemBudget: vi.fn(async () => "BUDGET_EXCEEDED" as const),
                processItem: vi.fn(),
                aggregateRun: vi.fn(async () => undefined),
                skipItem,
                now: () => "2026-09-26T00:01:00.000Z",
            },
        );
        expect(skipItem).toHaveBeenCalledWith("item", "SKIPPED_BUDGET_EXHAUSTED", "2026-09-26T00:01:00.000Z");
        expect(result).toEqual({ claimed: 1, processed: 0, skippedBudget: 1 });
    });

    it("submits once with stable idempotency and saves a passed terminal result", async () => {
        const submit = vi.fn(async () => ({ taskId: "provider-task", status: "pending" as const }));
        const saveSubmittedTask = vi.fn(async () => undefined);
        const saveItemTerminal = vi.fn(async () => undefined);
        await processVideoValidationItem(item(), {
            submit,
            query: vi.fn(async () => ({ status: "completed" as const, resultUrl: "https://media.example/video.mp4", actualCostHotxCredits: "1.1" })),
            cancel: vi.fn(),
            saveSubmittedTask,
            saveItemTerminal,
            now: () => "2026-09-26T00:01:00.000Z",
        });
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "video-validation:item" }));
        expect(saveSubmittedTask).toHaveBeenCalledWith("item", expect.objectContaining({ providerTaskId: "provider-task" }));
        expect(saveItemTerminal).toHaveBeenCalledWith("item", expect.objectContaining({ status: "passed", actualCostHotxCredits: "1.1", resultSummary: { hasResult: true } }));
    });

    it("does not replay an ambiguous submission without verified provider replay support", async () => {
        const submit = vi.fn(async () => ({ taskId: "duplicate-task", status: "pending" as const }));
        const saveSubmissionUncertain = vi.fn(async () => undefined);
        await processVideoValidationItem(item({ status: "submission_unknown", submissionStartedAt: "2026-09-26T00:00:00.000Z" }), {
            submit,
            query: vi.fn(async () => ({ status: "pending" as const })),
            cancel: vi.fn(),
            saveSubmittedTask: vi.fn(async () => undefined),
            saveSubmissionUncertain,
            saveItemTerminal: vi.fn(async () => undefined),
            now: () => "2026-09-26T00:01:00.000Z",
        });
        expect(submit).not.toHaveBeenCalled();
        expect(saveSubmissionUncertain).toHaveBeenCalledOnce();
    });

    it("reschedules an unknown submission outcome without changing the idempotency key", async () => {
        const failure = Object.assign(new Error("gateway timeout"), { outcome: "unknown", retryable: true });
        const saveSubmissionUncertain = vi.fn(async () => undefined);
        const submit = vi.fn(async () => {
            throw failure;
        });
        const result = await processVideoValidationItem(item(), {
            submit,
            query: vi.fn(),
            cancel: vi.fn(),
            saveSubmittedTask: vi.fn(),
            saveSubmissionUncertain,
            saveItemTerminal: vi.fn(),
            now: () => "2026-09-26T00:01:00.000Z",
        });
        expect(result).toEqual({ status: "submission_unknown" });
        expect(saveSubmissionUncertain).toHaveBeenCalledWith("item", "2026-09-26T00:01:00.000Z", "gateway timeout");
        expect(submit).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "video-validation:item" }));
    });

    it("polls an existing provider task without submitting again", async () => {
        const submit = vi.fn();
        await processVideoValidationItem(item({ status: "submitted", providerTaskId: "existing" }), {
            submit,
            query: vi.fn(async () => ({ status: "completed" as const, resultUrl: "https://media.example/video.mp4" })),
            cancel: vi.fn(),
            saveSubmittedTask: vi.fn(async () => undefined),
            saveItemTerminal: vi.fn(async () => undefined),
            now: () => "2026-09-26T00:01:00.000Z",
        });
        expect(submit).not.toHaveBeenCalled();
    });

    it("uses one local TCP create request when an accepted task has an ambiguous response", async () => {
        const received: string[] = [];
        const server = createServer((request, response) => {
            received.push(String(request.headers["idempotency-key"] || ""));
            response.writeHead(503).end("upstream gateway lost task acknowledgement");
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("fixture port unavailable");
            const submit = vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
                const response = await fetch(`http://127.0.0.1:${address.port}/videos/generations`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: "{}" });
                if (!response.ok) throw Object.assign(new Error("ambiguous response"), { outcome: "unknown" as const });
                return { taskId: "task", status: "pending" };
            });
            const dependencies = {
                submit: ({ idempotencyKey }: { idempotencyKey: string }) => submit({ idempotencyKey }),
                query: vi.fn(),
                cancel: vi.fn(),
                saveSubmittedTask: vi.fn(),
                saveSubmissionUncertain: vi.fn(async () => undefined),
                saveItemTerminal: vi.fn(),
                now: () => "2026-09-26T00:01:00.000Z",
            };
            expect(await processVideoValidationItem(item(), dependencies as never)).toEqual({ status: "submission_unknown" });
            expect(await processVideoValidationItem(item({ status: "submission_unknown", submissionStartedAt: "2026-09-26T00:01:00.000Z" }), dependencies as never)).toEqual({ status: "submission_unknown" });
            expect(received).toEqual(["video-validation:item"]);
            expect(submit).toHaveBeenCalledTimes(1);
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
