import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { VideoValidationItem, VideoValidationRun } from "@/lib/video-validation";
import { initializePostgresSchema, postgresQuery } from "./postgres";
import { VideoValidationRepository } from "./video-validation-repository";

const describePostgres = process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

describePostgres("video validation PostgreSQL budget integration", () => {
    const suffix = randomUUID();
    const userId = `validation-user-${suffix}`;
    const runId = `validation-run-${suffix}`;
    const reservedIds: string[] = [];
    const repository = new VideoValidationRepository({ query: postgresQuery });

    async function createSingleRun(label: string, bindingId = `binding-${label}`) {
        const now = new Date().toISOString();
        const id = `validation-${label}-${randomUUID()}`;
        const itemId = `${id}-item`;
        await repository.createRun(
            {
                id,
                mode: "all_models_minimum",
                status: "pending",
                previewRevision: "preview",
                registryRevision: "registry",
                pricingPolicyVersion: "policy",
                maxBudgetHotxCredits: "0.7",
                estimatedCostHotxCredits: "0",
                actualCostHotxCredits: "0",
                concurrency: 1,
                selectedCount: 1,
                runnableCount: 1,
                skippedCount: 0,
                createdBy: userId,
                createdAt: now,
            },
            [
                {
                    id: itemId,
                    runId: id,
                    logicalModelId: "model",
                    bindingId,
                    channelId: "channel",
                    upstreamModelId: "upstream",
                    contractFamily: "family",
                    caseId: "text-to-video",
                    testLevel: "MODEL_SMOKE",
                    status: "queued",
                    capabilityRevision: "cap",
                    pricingRevision: "price",
                    fingerprintVersion: 1,
                    fingerprintHash: "fingerprint",
                    requestPayloadDigest: "payload",
                    executionSnapshotHash: "snapshot",
                    estimatedCredits: "0.2268",
                    estimatedCostHotxCredits: "0.2268",
                    idempotencyKey: `${id}:1`,
                    createdAt: now,
                    updatedAt: now,
                },
            ],
        );
        return { id, itemId, now };
    }

    beforeAll(async () => {
        await initializePostgresSchema();
        await postgresQuery("INSERT INTO users (id, username, display_name, password_hash, status) VALUES ($1, $2, 'Validation test', 'integration-only', 'active')", [userId, `validation_${suffix.replaceAll("-", "")}`]);
        const now = new Date().toISOString();
        const run: VideoValidationRun = {
            id: runId,
            mode: "all_models_minimum",
            status: "pending",
            previewRevision: "preview",
            registryRevision: "registry",
            pricingPolicyVersion: "policy",
            maxBudgetHotxCredits: "0.7",
            estimatedCostHotxCredits: "0",
            actualCostHotxCredits: "0",
            concurrency: 4,
            selectedCount: 4,
            runnableCount: 4,
            skippedCount: 0,
            createdBy: userId,
            createdAt: now,
        };
        const items: VideoValidationItem[] = Array.from({ length: 4 }, (_, index) => ({
            id: `${runId}-item-${index}`,
            runId,
            logicalModelId: `model-${index}`,
            bindingId: `binding-${index}`,
            channelId: "channel",
            upstreamModelId: `upstream-${index}`,
            contractFamily: "family",
            caseId: "text-to-video",
            testLevel: "MODEL_SMOKE",
            status: "queued",
            probeStatus: "CONTRACT_READY",
            normalizedContext: { count: "1", durationSeconds: "5", resolution: "720p", aspectRatio: "16:9", generateAudio: false, watermark: false, references: [] },
            capabilityRevision: "cap",
            pricingRevision: "price",
            estimatedCostHotxCredits: "0.2268",
            estimatedCredits: "0.2268",
            fingerprintVersion: 1,
            fingerprintHash: "fingerprint",
            requestPayloadDigest: "payload",
            executionSnapshotHash: "snapshot",
            idempotencyKey: `${runId}:${index}`,
            createdAt: now,
            updatedAt: now,
        }));
        await repository.createRun(run, items);
    });

    afterAll(async () => {
        // This database is dedicated to the validation suite; immutable history is reset only in this disposable fixture.
        await postgresQuery("TRUNCATE model_validation_verifications");
        await postgresQuery("DELETE FROM video_validation_runs WHERE created_by = $1", [userId]);
        await postgresQuery("DELETE FROM users WHERE id = $1", [userId]);
    });

    it("rejects mutation of a stored execution fingerprint or cost bound", async () => {
        await expect(postgresQuery("UPDATE video_validation_items SET fingerprint_hash = 'forged' WHERE id = $1", [`${runId}-item-0`])).rejects.toThrow(/execution identity is immutable/);
        await expect(postgresQuery("UPDATE video_validation_items SET estimated_credits = 0.01 WHERE id = $1", [`${runId}-item-0`])).rejects.toThrow(/execution identity is immutable/);
    });

    it("allows exactly three concurrent fractional reservations within a 0.7 budget", async () => {
        const now = new Date().toISOString();
        const results = await Promise.all(Array.from({ length: 4 }, (_, index) => new VideoValidationRepository({ query: postgresQuery }).reserveItemBudget({ runId, itemId: `${runId}-item-${index}`, executionSnapshotHash: "snapshot", now })));
        expect(results.filter((result) => result === "RESERVED")).toHaveLength(3);
        results.forEach((result, index) => {
            if (result === "RESERVED") reservedIds.push(`${runId}-item-${index}`);
        });
        const stored = await repository.getRunWithItems(runId);
        expect(stored?.run.estimatedCostHotxCredits).toBe("0.68040000");
        expect(stored?.items.filter((item) => item.reservationState === "RESERVED").every((item) => item.reservedCredits === "0.22680000" && item.settledCredits === "0.00000000")).toBe(true);
    });

    it("records full actual above reserve, stops new submits and writes immutable history", async () => {
        const now = new Date().toISOString();
        await repository.markSubmissionStarted(reservedIds[0]!, "snapshot", now);
        await repository.markSubmissionStarted(reservedIds[1]!, "snapshot", now);
        const result = await repository.finalizeItem(reservedIds[0]!, {
            status: "passed",
            actualCredits: "0.31",
            creditSettlementSource: "PROVIDER_REPORTED_CREDITS",
            actualCostProvenance: { field: "usage.total_credits", providerTaskId: "task-0", observedAt: now },
            testedAt: now,
        });
        expect(result).toMatchObject({ actualCredits: "0.31000000", reasonCode: "COST_BOUND_VIOLATION", creditSettlementSource: "PROVIDER_REPORTED_CREDITS" });
        const stored = await repository.getRunWithItems(runId);
        expect(stored?.run).toMatchObject({ status: "reconciling", totalSettledCredits: "0.31000000", activeReservedCredits: "0.45360000", budgetViolationAt: now });
        expect(result).toMatchObject({ reservedCredits: "0.22680000", settledCredits: "0.31000000" });
        const unreservedId = Array.from({ length: 4 }, (_, index) => `${runId}-item-${index}`).find((id) => !reservedIds.includes(id))!;
        expect(await repository.reserveItemBudget({ runId, itemId: unreservedId, executionSnapshotHash: "snapshot", now })).toBe("NOT_ELIGIBLE");
        const bindingId = `binding-${reservedIds[0]!.split("-").at(-1)}`;
        const latest = await repository.latestVerificationByBindingCase([{ bindingId, caseId: "text-to-video" }]);
        expect(latest.get(`${bindingId}:text-to-video`)).toMatchObject({ status: "FAILED", fingerprintHash: "fingerprint" });
        await expect(postgresQuery("UPDATE model_validation_verifications SET status = 'FAILED' WHERE validation_item_id = $1", [reservedIds[0]])).rejects.toThrow(/append-only/);
    });

    it("settles missing actual cost at the reservation and does so exactly once", async () => {
        const now = new Date().toISOString();
        const first = await repository.finalizeItem(reservedIds[1]!, { status: "passed", testedAt: now });
        expect(first).toMatchObject({ creditSettlementSource: "ESTIMATED_FALLBACK", reservationState: "SETTLED", reservedCredits: "0.22680000", settledCredits: "0.22680000" });
        expect(first?.actualCredits).toBeUndefined();
        await repository.finalizeItem(reservedIds[1]!, { status: "passed", testedAt: now });
        const stored = await repository.getRunWithItems(runId);
        expect(stored?.run.totalSettledCredits).toBe("0.53680000");
        const history = await postgresQuery("SELECT count(*)::integer AS count FROM model_validation_verifications WHERE validation_item_id = $1", [reservedIds[1]]);
        expect(history.rows[0]?.count).toBe(1);
    });

    it("releases a reservation only with explicit no-charge evidence", async () => {
        const now = new Date().toISOString();
        const result = await repository.finalizeItem(reservedIds[2]!, { status: "cancelled", noChargeProof: "NO_SUBMISSION_STARTED", testedAt: now });
        expect(result).toMatchObject({ reservationState: "RELEASED", creditSettlementSource: "NO_CHARGE_RELEASE", reservedCredits: "0.22680000", settledCredits: "0.00000000" });
        const stored = await repository.getRunWithItems(runId);
        expect(stored?.run.activeReservedCredits).toBe("0.00000000");
    });

    it("retains the reserve after an interrupted submit and never claims it for automatic replay", async () => {
        const now = new Date().toISOString();
        const interruptedRunId = `validation-interrupted-${randomUUID()}`;
        await repository.createRun(
            {
                id: interruptedRunId,
                mode: "changed_models",
                status: "pending",
                previewRevision: "preview",
                registryRevision: "registry",
                pricingPolicyVersion: "policy",
                maxBudgetHotxCredits: "0.3",
                estimatedCostHotxCredits: "0",
                actualCostHotxCredits: "0",
                concurrency: 1,
                selectedCount: 1,
                runnableCount: 1,
                skippedCount: 0,
                createdBy: userId,
                createdAt: now,
            },
            [
                {
                    id: `${interruptedRunId}-item`,
                    runId: interruptedRunId,
                    logicalModelId: "model",
                    bindingId: "binding-interrupted",
                    channelId: "channel",
                    upstreamModelId: "upstream",
                    contractFamily: "family",
                    caseId: "text-to-video",
                    testLevel: "MODEL_SMOKE",
                    status: "queued",
                    capabilityRevision: "cap",
                    pricingRevision: "price",
                    fingerprintVersion: 1,
                    fingerprintHash: "fingerprint",
                    requestPayloadDigest: "payload",
                    executionSnapshotHash: "snapshot",
                    estimatedCredits: "0.2268",
                    estimatedCostHotxCredits: "0.2268",
                    idempotencyKey: `${interruptedRunId}:1`,
                    createdAt: now,
                    updatedAt: now,
                },
            ],
        );
        expect(await repository.reserveItemBudget({ runId: interruptedRunId, itemId: `${interruptedRunId}-item`, executionSnapshotHash: "snapshot", now })).toBe("RESERVED");
        expect(await repository.markSubmissionStarted(`${interruptedRunId}-item`, "snapshot", now)).toBe(true);
        await repository.saveSubmissionUncertain(`${interruptedRunId}-item`, now, "worker interrupted after submit");
        const stored = await repository.getRunWithItems(interruptedRunId);
        expect(stored?.run).toMatchObject({ status: "reconciling", activeReservedCredits: "0.22680000" });
        expect(stored?.items[0]).toMatchObject({ status: "submission_unknown", reasonCode: "NEEDS_RECONCILIATION", reservationState: "RESERVED" });
        expect(await repository.markSubmissionStarted(`${interruptedRunId}-item`, "snapshot", now)).toBe(false);
        await expect(repository.finalizeItem(`${interruptedRunId}-item`, { status: "cancelled", noChargeProof: "NO_SUBMISSION_STARTED", testedAt: now })).rejects.toThrow(/cannot release/);
    });

    it("lets an active UNKNOWN override an older PASS for the same binding and fingerprint", async () => {
        const bindingId = `binding-${reservedIds[1]!.split("-").at(-1)}`;
        const fixture = await createSingleRun("new-unknown", bindingId);
        await repository.reserveItemBudget({ runId: fixture.id, itemId: fixture.itemId, executionSnapshotHash: "snapshot", now: fixture.now });
        await repository.markSubmissionStarted(fixture.itemId, "snapshot", fixture.now);
        await repository.saveSubmissionUncertain(fixture.itemId, fixture.now, "accepted without persisted task id");
        const latest = await repository.latestVerificationByBindingCase([{ bindingId, caseId: "text-to-video" }]);
        expect(latest.get(`${bindingId}:text-to-video`)).toMatchObject({ status: "UNKNOWN", fingerprintHash: "fingerprint" });
    });

    it("settles a submitted cancellation conservatively without provider no-charge proof", async () => {
        const fixture = await createSingleRun("cancelled-submitted");
        expect(await repository.reserveItemBudget({ runId: fixture.id, itemId: fixture.itemId, executionSnapshotHash: "snapshot", now: fixture.now })).toBe("RESERVED");
        expect(await repository.markSubmissionStarted(fixture.itemId, "snapshot", fixture.now)).toBe(true);
        await repository.saveSubmittedTask(fixture.itemId, { providerTaskId: "task-cancel", providerStatus: "pending", submittedAt: fixture.now, nextAttemptAt: fixture.now });
        const terminal = await repository.finalizeItem(fixture.itemId, { status: "cancelled", providerStatus: "cancelled", testedAt: fixture.now });
        expect(terminal).toMatchObject({ creditSettlementSource: "ESTIMATED_FALLBACK", reservationState: "SETTLED" });
        expect(terminal?.actualCostProvenance).toMatchObject({ reason: "PROVIDER_ACTUAL_COST_UNAVAILABLE", providerTaskId: "task-cancel" });
        const stored = await repository.getRunWithItems(fixture.id);
        expect(stored?.run.totalSettledCredits).toBe("0.22680000");
    });

    it("rolls back item, ledger and verification when audit insertion fails", async () => {
        const fixture = await createSingleRun("audit-rollback");
        await repository.reserveItemBudget({ runId: fixture.id, itemId: fixture.itemId, executionSnapshotHash: "snapshot", now: fixture.now });
        await postgresQuery("CREATE FUNCTION validation_test_reject_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'video_validation.item.finalize' THEN RAISE EXCEPTION 'audit rejected'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
        await postgresQuery("CREATE TRIGGER validation_test_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION validation_test_reject_audit()");
        try {
            await expect(repository.finalizeItem(fixture.itemId, { status: "passed", testedAt: fixture.now })).rejects.toThrow(/audit rejected/);
        } finally {
            await postgresQuery("DROP TRIGGER validation_test_reject_audit ON audit_logs");
            await postgresQuery("DROP FUNCTION validation_test_reject_audit()");
        }
        const stored = await repository.getRunWithItems(fixture.id);
        expect(stored?.run).toMatchObject({ activeReservedCredits: "0.22680000", totalSettledCredits: "0.00000000" });
        expect(stored?.items[0]).toMatchObject({ status: "reserved", reservationState: "RESERVED" });
        const history = await postgresQuery("SELECT count(*)::integer AS count FROM model_validation_verifications WHERE validation_item_id = $1", [fixture.itemId]);
        expect(history.rows[0]?.count).toBe(0);
    });

    it("requires a fresh item, key and second reservation for a new generation attempt", async () => {
        const fixture = await createSingleRun("new-attempt");
        await repository.reserveItemBudget({ runId: fixture.id, itemId: fixture.itemId, executionSnapshotHash: "snapshot", now: fixture.now });
        const previous = (await repository.getRunWithItems(fixture.id))!.items[0]!;
        const next = {
            ...previous,
            id: `${fixture.id}-attempt-2`,
            attemptNumber: 2,
            status: "queued" as const,
            reservationState: "NONE" as const,
            idempotencyKey: `${fixture.id}:2`,
            executionSnapshotHash: "snapshot-2",
            providerTaskId: undefined,
            submissionStartedAt: undefined,
            createdAt: fixture.now,
            updatedAt: fixture.now,
        };
        await expect(repository.createNextAttempt({ previousItemId: fixture.itemId, item: { ...next, idempotencyKey: previous.idempotencyKey } })).rejects.toThrow(/fresh immutable snapshot/);
        await repository.createNextAttempt({ previousItemId: fixture.itemId, item: next });
        expect(await repository.reserveItemBudget({ runId: fixture.id, itemId: next.id, executionSnapshotHash: "snapshot-2", now: fixture.now })).toBe("RESERVED");
        const stored = await repository.getRunWithItems(fixture.id);
        expect(stored?.run.activeReservedCredits).toBe("0.45360000");
        expect(stored?.items).toHaveLength(2);
        expect(stored?.items.every((item) => item.reservationState === "RESERVED")).toBe(true);
    });
});
