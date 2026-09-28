import type { VideoValidationItem, VideoValidationRun, VideoValidationRunStatus } from "@/lib/video-validation";
import { decimal } from "@/lib/billing/decimal";
import { randomUUID } from "node:crypto";
import type { QueryExecutor } from "./postgres";
import { withPostgresTransaction } from "./postgres";

export class VideoValidationRepository {
    constructor(
        private readonly db: QueryExecutor,
        private readonly transaction: <T>(handler: (db: QueryExecutor) => Promise<T>) => Promise<T> = withPostgresTransaction,
    ) {}

    async createRun(run: VideoValidationRun, items: VideoValidationItem[]) {
        await this.db.query(
            `INSERT INTO video_validation_runs (id, mode, status, preview_revision, registry_revision, pricing_policy_version, max_budget_hotx_credits, estimated_cost_hotx_credits, actual_cost_hotx_credits, concurrency, selected_count, runnable_count, skipped_count, created_by, created_at, started_at, completed_at, cancelled_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
                run.id,
                run.mode,
                run.status,
                run.previewRevision,
                run.registryRevision,
                run.pricingPolicyVersion,
                run.maxBudgetHotxCredits,
                run.estimatedCostHotxCredits,
                run.actualCostHotxCredits,
                run.concurrency,
                run.selectedCount,
                run.runnableCount,
                run.skippedCount,
                run.createdBy,
                run.createdAt,
                run.startedAt || null,
                run.completedAt || null,
                run.cancelledAt || null,
            ],
        );
        for (const item of items) await this.insertItem(item);
        return { run, items };
    }

    async createNextAttempt(input: { previousItemId: string; item: VideoValidationItem }) {
        return this.transaction(async (db) => {
            const identity = (await db.query("SELECT run_id FROM video_validation_items WHERE id = $1", [input.previousItemId])).rows[0];
            if (!identity) throw new Error("previous validation attempt not found");
            const run = (await db.query("SELECT * FROM video_validation_runs WHERE id = $1 FOR UPDATE", [identity.run_id])).rows[0];
            const previous = (await db.query("SELECT * FROM video_validation_items WHERE id = $1 FOR UPDATE", [input.previousItemId])).rows[0];
            if (!run || !previous || !["pending", "running"].includes(String(run.status))) throw new Error("validation run cannot start a new paid attempt");
            if (
                input.item.runId !== identity.run_id ||
                input.item.id === input.previousItemId ||
                input.item.idempotencyKey === previous.idempotency_key ||
                input.item.attemptNumber !== Number(previous.attempt_number) + 1 ||
                !input.item.fingerprintHash ||
                !input.item.requestPayloadDigest ||
                !input.item.executionSnapshotHash ||
                input.item.status !== "queued"
            )
                throw new Error("new validation attempt requires a fresh immutable snapshot and idempotency key");
            await this.insertItem(input.item, db);
            await db.query("INSERT INTO audit_logs (id, action, status, actor_user_id, actor_role, target_type, target_id, metadata, created_at) VALUES ($1,'video_validation.attempt.create','success',$2,'admin','video_validation_item',$3,$4::jsonb,$5)", [
                randomUUID(),
                run.created_by,
                input.item.id,
                JSON.stringify({ previousItemId: input.previousItemId, runId: identity.run_id, bindingId: input.item.bindingId, estimatedCredits: input.item.estimatedCredits }),
                input.item.createdAt,
            ]);
            return input.item;
        });
    }

    async listRuns(input: { page: number; pageSize: number }) {
        const offset = (input.page - 1) * input.pageSize;
        const [rows, total] = await Promise.all([
            this.db.query("SELECT * FROM video_validation_runs ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2", [input.pageSize, offset]),
            this.db.query("SELECT count(*)::text AS total FROM video_validation_runs"),
        ]);
        return { items: rows.rows.map(mapRun), total: Number(total.rows[0]?.total || 0) };
    }

    async getRunWithItems(runId: string) {
        const [run, items] = await Promise.all([this.db.query("SELECT * FROM video_validation_runs WHERE id = $1", [runId]), this.db.query("SELECT * FROM video_validation_items WHERE run_id = $1 ORDER BY created_at ASC, id ASC", [runId])]);
        return run.rows[0] ? { run: mapRun(run.rows[0]), items: items.rows.map(mapItem) } : null;
    }

    async authorizesProxyRequest(input: { itemId: string; channelId: string; upstreamModelId: string; operation: "create" | "query" | "cancel"; providerTaskId?: string }) {
        const result = await this.db.query(
            `SELECT 1 FROM video_validation_items item
             INNER JOIN video_validation_runs run ON run.id = item.run_id
             WHERE item.id = $1 AND item.channel_id = $2 AND lower(item.upstream_model_id) = lower($3)
               AND run.status IN ('pending','running','reconciling')
               AND item.status IN ('reserved','submitted','polling')
               AND (($4 = 'create' AND run.status IN ('pending','running') AND item.submission_started_at IS NOT NULL) OR ($4 <> 'create' AND item.provider_task_id = $5))
             LIMIT 1`,
            [input.itemId, input.channelId, input.upstreamModelId, input.operation, input.providerTaskId || null],
        );
        return Boolean(result.rowCount);
    }

    async latestVerificationByBindingCase(keys: Array<{ bindingId: string; caseId: string }>) {
        const result = new Map<string, { fingerprintVersion: number; fingerprintHash: string; status: string }>();
        if (!keys.length) return result;
        const rows = await this.db.query(
            `WITH requested AS (SELECT * FROM unnest($1::text[], $2::text[]) AS requested_key(binding_id, case_id)), events AS (
                SELECT history.binding_id, history.case_id, history.fingerprint_version, history.fingerprint_hash, history.status, history.verified_at AS observed_at, history.id
                FROM model_validation_verifications history INNER JOIN requested ON requested.binding_id = history.binding_id AND requested.case_id = history.case_id
                UNION ALL
                SELECT item.binding_id, item.case_id, item.fingerprint_version, item.fingerprint_hash, 'UNKNOWN' AS status, item.updated_at AS observed_at, item.id
                FROM video_validation_items item INNER JOIN requested ON requested.binding_id = item.binding_id AND requested.case_id = item.case_id
                WHERE item.status = 'submission_unknown' AND item.fingerprint_version IS NOT NULL AND item.fingerprint_hash IS NOT NULL
             )
             SELECT DISTINCT ON (binding_id, case_id) binding_id, case_id, fingerprint_version, fingerprint_hash, status
             FROM events ORDER BY binding_id, case_id, observed_at DESC, id DESC`,
            [keys.map((key) => key.bindingId), keys.map((key) => key.caseId)],
        );
        for (const row of rows.rows) result.set(`${row.binding_id}:${row.case_id}`, { fingerprintVersion: Number(row.fingerprint_version), fingerprintHash: String(row.fingerprint_hash), status: String(row.status) });
        return result;
    }

    async findReusablePassed(input: { bindingId: string; caseId: string; fingerprintVersion?: number; fingerprintHash?: string }) {
        const result = await this.db.query(
            `SELECT item.* FROM model_validation_verifications history
             INNER JOIN video_validation_items item ON item.id = history.validation_item_id
             WHERE history.binding_id = $1 AND history.case_id = $2
             ORDER BY history.verified_at DESC, history.id DESC LIMIT 1`,
            [input.bindingId, input.caseId],
        );
        const row = result.rows[0];
        return row && row.status === "passed" && Number(row.fingerprint_version || input.fingerprintVersion) === input.fingerprintVersion && String(row.fingerprint_hash || input.fingerprintHash) === input.fingerprintHash ? mapItem(row) : null;
    }

    async claimNextItems(input: { workerId: string; now: string; leaseUntil: string; limit: number }) {
        const result = await this.db.query(
            `WITH locked_runs AS MATERIALIZED (
                SELECT run.id, run.concurrency, run.status FROM video_validation_runs run
                WHERE run.status IN ('pending','running','reconciling')
                  AND EXISTS (
                    SELECT 1 FROM video_validation_items item
                    WHERE item.run_id = run.id AND (item.status IN ('submitted','polling') OR (run.status IN ('pending','running') AND item.status IN ('queued','reserved')) OR (run.status = 'reconciling' AND item.status = 'reserved' AND item.reason_code = 'CANCEL_REQUESTED'))
                      AND item.next_attempt_at <= $2 AND (item.lease_until IS NULL OR item.lease_until <= $2)
                  )
                FOR UPDATE OF run
             ), active AS (
                SELECT item.run_id, count(*)::integer AS count
                FROM video_validation_items item INNER JOIN locked_runs ON locked_runs.id = item.run_id
                WHERE item.status IN ('queued','reserved','submitted','polling') AND item.lease_until > $2
                GROUP BY item.run_id
             ), ranked AS (
                SELECT item.id, item.run_id, item.next_attempt_at,
                       row_number() OVER (PARTITION BY item.run_id ORDER BY item.next_attempt_at ASC, item.id ASC) AS slot
                FROM video_validation_items item INNER JOIN locked_runs ON locked_runs.id = item.run_id
                WHERE (item.status IN ('submitted','polling') OR (locked_runs.status IN ('pending','running') AND item.status IN ('queued','reserved')) OR (locked_runs.status = 'reconciling' AND item.status = 'reserved' AND item.reason_code = 'CANCEL_REQUESTED'))
                  AND item.next_attempt_at <= $2
                  AND (item.lease_until IS NULL OR item.lease_until <= $2)
             ), due AS (
                SELECT ranked.id FROM ranked
                INNER JOIN locked_runs ON locked_runs.id = ranked.run_id
                LEFT JOIN active ON active.run_id = ranked.run_id
                WHERE ranked.slot <= locked_runs.concurrency - coalesce(active.count, 0)
                ORDER BY ranked.next_attempt_at ASC, ranked.id ASC LIMIT $4
             )
             UPDATE video_validation_items item SET lease_owner = $1, lease_until = $3
             FROM due WHERE item.id = due.id RETURNING item.*`,
            [input.workerId, input.now, input.leaseUntil, input.limit],
        );
        return result.rows.map(mapItem);
    }

    async reserveItemBudget(input: { runId: string; itemId: string; executionSnapshotHash: string; now: string }): Promise<"RESERVED" | "BUDGET_EXCEEDED" | "SNAPSHOT_CHANGED" | "NOT_ELIGIBLE"> {
        return this.transaction(async (db) => {
            const run = (await db.query("SELECT * FROM video_validation_runs WHERE id = $1 FOR UPDATE", [input.runId])).rows[0];
            if (!run || !["pending", "running"].includes(String(run.status))) return "NOT_ELIGIBLE";
            const item = (await db.query("SELECT * FROM video_validation_items WHERE id = $1 AND run_id = $2 FOR UPDATE", [input.itemId, input.runId])).rows[0];
            if (!item) return "NOT_ELIGIBLE";
            if (item.reservation_state === "RESERVED") return item.execution_snapshot_hash === input.executionSnapshotHash ? "RESERVED" : "SNAPSHOT_CHANGED";
            if (item.status !== "queued" || item.reservation_state !== "NONE") return "NOT_ELIGIBLE";
            if (!item.execution_snapshot_hash || item.execution_snapshot_hash !== input.executionSnapshotHash || !item.fingerprint_hash || !item.request_payload_digest) return "SNAPSHOT_CHANGED";
            const estimated = decimal(String(item.estimated_credits));
            const remaining = decimal(String(run.max_budget_hotx_credits))
                .minus(decimal(String(run.total_settled_credits)))
                .minus(decimal(String(run.active_reserved_credits)));
            if (estimated.greaterThan(remaining)) return "BUDGET_EXCEEDED";
            await db.query(
                "UPDATE video_validation_runs SET active_reserved_credits = active_reserved_credits + $2::numeric, estimated_cost_hotx_credits = estimated_cost_hotx_credits + $2::numeric, status = 'running', started_at = coalesce(started_at, $3) WHERE id = $1",
                [input.runId, estimated.toString(), input.now],
            );
            await db.query("UPDATE video_validation_items SET status = 'reserved', reservation_state = 'RESERVED', reserved_credits = estimated_credits, next_attempt_at = $2 WHERE id = $1", [input.itemId, input.now]);
            return "RESERVED";
        });
    }

    async saveSubmittedTask(itemId: string, input: { providerTaskId: string; providerStatus: string; submittedAt: string; nextAttemptAt: string }) {
        const result = await this.db.query("UPDATE video_validation_items SET status = 'submitted', provider_task_id = $2, provider_status = $3, submitted_at = $4, next_attempt_at = $5, lease_owner = NULL, lease_until = NULL WHERE id = $1 RETURNING *", [
            itemId,
            input.providerTaskId,
            input.providerStatus,
            input.submittedAt,
            input.nextAttemptAt,
        ]);
        return result.rows[0] ? mapItem(result.rows[0]) : null;
    }

    async markSubmissionStarted(itemId: string, executionSnapshotHash: string, now: string) {
        return this.transaction(async (db) => {
            const identity = (await db.query("SELECT run_id FROM video_validation_items WHERE id = $1", [itemId])).rows[0];
            if (!identity) return false;
            const run = (await db.query("SELECT status FROM video_validation_runs WHERE id = $1 FOR UPDATE", [identity.run_id])).rows[0];
            if (!run || !["pending", "running"].includes(String(run.status))) return false;
            const item = (await db.query("SELECT * FROM video_validation_items WHERE id = $1 FOR UPDATE", [itemId])).rows[0];
            if (!item || item.status !== "reserved" || item.reservation_state !== "RESERVED" || item.submission_started_at || item.execution_snapshot_hash !== executionSnapshotHash) return false;
            await db.query("UPDATE video_validation_items SET submission_started_at = $2 WHERE id = $1", [itemId, now]);
            return true;
        });
    }

    async saveSubmissionUncertain(itemId: string, nextAttemptAt: string, errorMessage?: string) {
        return this.transaction(async (db) => {
            const result = await db.query(
                `UPDATE video_validation_items SET status = 'submission_unknown', reason_code = 'NEEDS_RECONCILIATION', error_message = $3,
                 next_attempt_at = $2, lease_owner = NULL, lease_until = NULL WHERE id = $1 AND reservation_state = 'RESERVED' RETURNING *`,
                [itemId, nextAttemptAt, errorMessage || null],
            );
            if (result.rows[0]) await db.query("UPDATE video_validation_runs SET status = 'reconciling' WHERE id = $1 AND status IN ('pending','running')", [result.rows[0].run_id]);
            return result.rows[0] ? mapItem(result.rows[0]) : null;
        });
    }

    async savePolling(itemId: string, providerStatus: string, nextAttemptAt: string) {
        const result = await this.db.query(
            "UPDATE video_validation_items SET status = 'polling', provider_status = $2, reason_code = CASE WHEN $2 = 'cancel_unsupported' THEN 'CANCEL_UNSUPPORTED' WHEN $2 IN ('accepted','cancel_requested') THEN 'CANCEL_PENDING_QUERY' ELSE reason_code END, next_attempt_at = $3, lease_owner = NULL, lease_until = NULL WHERE id = $1 RETURNING *",
            [itemId, providerStatus, nextAttemptAt],
        );
        return result.rows[0] ? mapItem(result.rows[0]) : null;
    }

    async saveItemTerminal(
        itemId: string,
        input: {
            status: "passed" | "failed" | "cancelled" | "skipped";
            providerStatus?: string;
            actualCostHotxCredits?: string;
            actualCredits?: string;
            actualProviderCost?: VideoValidationItem["actualProviderCost"];
            actualCostProvenance?: Record<string, unknown>;
            creditSettlementSource?: VideoValidationItem["creditSettlementSource"];
            noChargeProof?: string;
            resultSummary?: Record<string, unknown>;
            errorCode?: string;
            errorMessage?: string;
            testedAt: string;
        },
    ) {
        return this.finalizeItem(itemId, input);
    }

    async finalizeItem(
        itemId: string,
        input: {
            status: "passed" | "failed" | "cancelled" | "skipped";
            providerStatus?: string;
            actualCostHotxCredits?: string;
            actualCredits?: string;
            actualProviderCost?: VideoValidationItem["actualProviderCost"];
            actualCostProvenance?: Record<string, unknown>;
            creditSettlementSource?: VideoValidationItem["creditSettlementSource"];
            noChargeProof?: string;
            resultSummary?: Record<string, unknown>;
            errorCode?: string;
            errorMessage?: string;
            testedAt: string;
        },
    ) {
        return this.transaction(async (db) => {
            const identity = (await db.query("SELECT run_id FROM video_validation_items WHERE id = $1", [itemId])).rows[0];
            if (!identity) return null;
            const run = (await db.query("SELECT * FROM video_validation_runs WHERE id = $1 FOR UPDATE", [identity.run_id])).rows[0];
            const item = (await db.query("SELECT * FROM video_validation_items WHERE id = $1 FOR UPDATE", [itemId])).rows[0];
            if (!run || !item) return null;
            if (["SETTLED", "RELEASED"].includes(String(item.reservation_state))) return mapItem(item);
            if (item.status === "submission_unknown" && !input.noChargeProof && !input.actualCredits && !input.actualCostHotxCredits) return mapItem(item);
            const wasReserved = item.reservation_state === "RESERVED";
            if (input.noChargeProof === "NO_SUBMISSION_STARTED" && item.submission_started_at) throw new Error("cannot release a submission that may have reached the provider");
            const reserved = wasReserved ? decimal(String(item.estimated_credits)) : decimal(0);
            const release = Boolean(input.noChargeProof) || !wasReserved;
            const actual = input.actualCredits || input.actualCostHotxCredits;
            if (input.noChargeProof && actual) throw new Error("no-charge proof conflicts with reported actual cost");
            if (actual && !input.actualCostProvenance) throw new Error("actual cost provenance is required");
            const settled = release ? decimal(0) : actual ? decimal(actual) : reserved;
            const violation = wasReserved && settled.greaterThan(reserved);
            const source = release ? "NO_CHARGE_RELEASE" : input.creditSettlementSource || (actual ? "PROVIDER_REPORTED_CREDITS" : "ESTIMATED_FALLBACK");
            const provenance = input.actualCostProvenance || { source, reason: release ? input.noChargeProof || "NO_CHARGE" : "PROVIDER_ACTUAL_COST_UNAVAILABLE", providerTaskId: item.provider_task_id || null, observedAt: input.testedAt };
            if (wasReserved)
                await db.query(
                    `UPDATE video_validation_runs SET active_reserved_credits = active_reserved_credits - $2::numeric,
                 total_settled_credits = total_settled_credits + $3::numeric,
                 actual_cost_hotx_credits = actual_cost_hotx_credits + $3::numeric,
                 cost_bound_violated = cost_bound_violated OR $4,
                 budget_violation_at = CASE WHEN $4 THEN coalesce(budget_violation_at, $5::timestamptz) ELSE budget_violation_at END,
                 status = CASE WHEN $4 THEN 'reconciling' ELSE status END WHERE id = $1`,
                    [identity.run_id, reserved.toString(), settled.toString(), violation, input.testedAt],
                );
            const result = await db.query(
                `UPDATE video_validation_items SET status = $2, provider_status = $3,
                 actual_cost_hotx_credits = $4::numeric, actual_credits = $5::numeric,
                 actual_provider_cost = $6::jsonb, actual_cost_provenance = $7::jsonb,
                 credit_settlement_source = $8, reservation_state = $9, settled_credits = $15::numeric,
                 result_summary = $10::jsonb, error_code = $11, error_message = $12,
                 reason_code = CASE WHEN $13 THEN 'COST_BOUND_VIOLATION' ELSE reason_code END,
                 tested_at = $14, lease_owner = NULL, lease_until = NULL WHERE id = $1 RETURNING *`,
                [
                    itemId,
                    input.status,
                    input.providerStatus || null,
                    release ? null : settled.toString(),
                    actual || null,
                    input.actualProviderCost ? JSON.stringify(input.actualProviderCost) : null,
                    JSON.stringify(provenance),
                    source,
                    release ? "RELEASED" : "SETTLED",
                    input.resultSummary ? JSON.stringify(input.resultSummary) : null,
                    violation ? "COST_BOUND_VIOLATION" : input.errorCode || null,
                    input.errorMessage || null,
                    violation,
                    input.testedAt,
                    settled.toString(),
                ],
            );
            if (wasReserved && item.submission_started_at && item.fingerprint_hash && item.fingerprint_version)
                await db.query(
                    `INSERT INTO model_validation_verifications (id, validation_item_id, validation_run_id, binding_id, case_id, fingerprint_version, fingerprint_hash, fingerprint_hash_algorithm, fingerprint_snapshot, status, reason_code, verification_mode, provider_task_id, actual_provider_cost, actual_credits, actual_cost_provenance, settled_credits, credit_settlement_source, verified_at, actual_cost_capability, actual_cost_capability_evidence)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'sha256',$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14::numeric,$15::jsonb,$16::numeric,$17,$18,$19,$20::jsonb)`,
                    [
                        randomUUID(),
                        itemId,
                        identity.run_id,
                        item.binding_id,
                        item.case_id,
                        item.fingerprint_version,
                        item.fingerprint_hash,
                        item.fingerprint_snapshot ? JSON.stringify(item.fingerprint_snapshot) : null,
                        violation ? "FAILED" : input.status === "passed" ? "PASSED" : input.status === "cancelled" ? "CANCELLED" : "FAILED",
                        violation ? "COST_BOUND_VIOLATION" : input.errorCode || null,
                        run.mode,
                        item.provider_task_id || null,
                        input.actualProviderCost ? JSON.stringify(input.actualProviderCost) : null,
                        actual || null,
                        JSON.stringify(provenance),
                        settled.toString(),
                        source,
                        input.testedAt,
                        item.actual_cost_capability || "UNAVAILABLE",
                        item.actual_cost_capability_evidence ? JSON.stringify(item.actual_cost_capability_evidence) : null,
                    ],
                );
            await db.query(
                `INSERT INTO audit_logs (id, action, status, actor_user_id, actor_role, target_type, target_id, metadata, created_at)
                 VALUES ($1,'video_validation.item.finalize','success',$2,'admin','video_validation_item',$3,$4::jsonb,$5)`,
                [
                    randomUUID(),
                    run.created_by,
                    itemId,
                    JSON.stringify({
                        runId: identity.run_id,
                        reservedCredits: reserved.toString(),
                        settledCredits: settled.toString(),
                        actualCredits: actual || null,
                        creditSettlementSource: source,
                        noChargeProof: input.noChargeProof || null,
                        costBoundViolation: violation,
                        fingerprintHash: item.fingerprint_hash || null,
                    }),
                    input.testedAt,
                ],
            );
            return result.rows[0] ? mapItem(result.rows[0]) : null;
        });
    }

    async skipItem(itemId: string, reasonCode: string, testedAt: string) {
        return this.saveItemTerminal(itemId, { status: "skipped", errorCode: reasonCode, testedAt });
    }

    async requestCancellation(runId: string, now: string) {
        await this.db.query("UPDATE video_validation_runs SET status = 'reconciling', cancelled_at = $2 WHERE id = $1 AND status IN ('pending','running')", [runId, now]);
        await this.db.query("UPDATE video_validation_items SET status = 'cancelled', tested_at = $2 WHERE run_id = $1 AND status = 'queued' AND reservation_state = 'NONE'", [runId, now]);
        await this.db.query("UPDATE video_validation_items SET reason_code = 'CANCEL_REQUESTED', next_attempt_at = $2, lease_owner = NULL, lease_until = NULL WHERE run_id = $1 AND status IN ('reserved','submitted','polling')", [runId, now]);
    }

    async aggregateRunStatus(runId: string, status: VideoValidationRunStatus, now: string) {
        await this.db.query(
            `UPDATE video_validation_runs run SET status = $2, completed_at = CASE WHEN $2 IN ('completed','failed','cancelled') THEN $3 ELSE completed_at END,
             actual_cost_hotx_credits = coalesce((SELECT sum(actual_cost_hotx_credits) FROM video_validation_items WHERE run_id = $1), 0) WHERE id = $1`,
            [runId, status, now],
        );
    }

    async aggregateRunFromItems(runId: string, now: string) {
        await this.db.query(
            `UPDATE video_validation_runs run SET
                status = CASE
                    WHEN run.cost_bound_violated THEN 'reconciling'
                    WHEN run.status = 'reconciling' AND EXISTS (SELECT 1 FROM video_validation_items WHERE run_id = $1 AND reservation_state = 'RESERVED') THEN 'reconciling'
                    WHEN run.cancelled_at IS NOT NULL THEN 'cancelled'
                    WHEN EXISTS (SELECT 1 FROM video_validation_items WHERE run_id = $1 AND status IN ('queued','reserved','submitted','polling','submission_unknown')) THEN 'running'
                    WHEN EXISTS (SELECT 1 FROM video_validation_items WHERE run_id = $1 AND status = 'failed') THEN 'failed'
                    ELSE 'completed'
                END,
                completed_at = CASE
                    WHEN NOT EXISTS (SELECT 1 FROM video_validation_items WHERE run_id = $1 AND status IN ('queued','reserved','submitted','polling','submission_unknown')) THEN coalesce(completed_at, $2)
                    ELSE completed_at
                END,
                actual_cost_hotx_credits = total_settled_credits
             WHERE id = $1`,
            [runId, now],
        );
    }

    private async insertItem(item: VideoValidationItem, db = this.db) {
        await db.query(
            `INSERT INTO video_validation_items (id, run_id, logical_model_id, binding_id, channel_id, upstream_model_id, contract_family, case_id, test_level, status, probe_status, reason_code, normalized_context, capability_revision, pricing_revision, estimated_cost_hotx_credits, actual_cost_hotx_credits, provider_task_id, provider_status, result_summary, error_code, error_message, idempotency_key, submitted_at, tested_at, created_at, updated_at, fingerprint_version, fingerprint_hash, fingerprint_snapshot, execution_snapshot_hash, request_payload_digest, attempt_number, estimated_provider_cost, actual_provider_cost, actual_cost_provenance, estimated_credits, actual_credits, credit_settlement_source, reservation_state, submission_started_at, bound_evidence, actual_cost_capability, actual_cost_capability_evidence)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::numeric,$17::numeric,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31,$32,$33,$34::jsonb,$35::jsonb,$36::jsonb,$37::numeric,$38::numeric,$39,$40,$41,$42::jsonb,$43,$44::jsonb)`,
            [
                item.id,
                item.runId,
                item.logicalModelId,
                item.bindingId,
                item.channelId,
                item.upstreamModelId,
                item.contractFamily,
                item.caseId,
                item.testLevel,
                item.status,
                item.probeStatus || null,
                item.reasonCode || null,
                item.normalizedContext ? JSON.stringify(item.normalizedContext) : null,
                item.capabilityRevision,
                item.pricingRevision,
                item.estimatedCostHotxCredits,
                item.actualCostHotxCredits || null,
                item.providerTaskId || null,
                item.providerStatus || null,
                item.resultSummary ? JSON.stringify(item.resultSummary) : null,
                item.errorCode || null,
                item.errorMessage || null,
                item.idempotencyKey,
                item.submittedAt || null,
                item.testedAt || null,
                item.createdAt,
                item.updatedAt,
                item.fingerprintVersion || null,
                item.fingerprintHash || null,
                item.fingerprintSnapshot ? JSON.stringify(item.fingerprintSnapshot) : null,
                item.executionSnapshotHash || null,
                item.requestPayloadDigest || null,
                item.attemptNumber || 1,
                item.estimatedProviderCost ? JSON.stringify(item.estimatedProviderCost) : null,
                item.actualProviderCost ? JSON.stringify(item.actualProviderCost) : null,
                item.actualCostProvenance ? JSON.stringify(item.actualCostProvenance) : null,
                item.estimatedCredits || item.estimatedCostHotxCredits,
                item.actualCredits || null,
                item.creditSettlementSource || null,
                item.reservationState || "NONE",
                item.submissionStartedAt || null,
                item.boundEvidence ? JSON.stringify(item.boundEvidence) : null,
                item.actualCostCapability || "UNAVAILABLE",
                item.actualCostCapabilityEvidence ? JSON.stringify(item.actualCostCapabilityEvidence) : null,
            ],
        );
    }
}

function mapRun(row: Record<string, unknown>): VideoValidationRun {
    return {
        id: String(row.id),
        mode: row.mode as VideoValidationRun["mode"],
        status: row.status as VideoValidationRun["status"],
        previewRevision: String(row.preview_revision),
        registryRevision: String(row.registry_revision),
        pricingPolicyVersion: String(row.pricing_policy_version),
        maxBudgetHotxCredits: String(row.max_budget_hotx_credits),
        estimatedCostHotxCredits: String(row.estimated_cost_hotx_credits),
        actualCostHotxCredits: String(row.actual_cost_hotx_credits),
        activeReservedCredits: String(row.active_reserved_credits || "0"),
        totalSettledCredits: String(row.total_settled_credits || "0"),
        costBoundViolated: row.cost_bound_violated === true,
        ...(row.budget_violation_at ? { budgetViolationAt: iso(row.budget_violation_at) } : {}),
        concurrency: Number(row.concurrency),
        selectedCount: Number(row.selected_count),
        runnableCount: Number(row.runnable_count),
        skippedCount: Number(row.skipped_count),
        createdBy: String(row.created_by),
        createdAt: iso(row.created_at),
        ...(row.started_at ? { startedAt: iso(row.started_at) } : {}),
        ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
        ...(row.cancelled_at ? { cancelledAt: iso(row.cancelled_at) } : {}),
    };
}

function mapItem(row: Record<string, unknown>): VideoValidationItem {
    return {
        id: String(row.id),
        runId: String(row.run_id),
        logicalModelId: String(row.logical_model_id),
        bindingId: String(row.binding_id),
        channelId: String(row.channel_id),
        upstreamModelId: String(row.upstream_model_id),
        contractFamily: String(row.contract_family),
        caseId: String(row.case_id),
        testLevel: row.test_level as VideoValidationItem["testLevel"],
        status: row.status as VideoValidationItem["status"],
        ...(row.probe_status ? { probeStatus: row.probe_status as VideoValidationItem["probeStatus"] } : {}),
        ...(row.reason_code ? { reasonCode: String(row.reason_code) } : {}),
        ...(row.normalized_context ? { normalizedContext: row.normalized_context as VideoValidationItem["normalizedContext"] } : {}),
        capabilityRevision: String(row.capability_revision),
        pricingRevision: String(row.pricing_revision),
        ...(row.fingerprint_version ? { fingerprintVersion: Number(row.fingerprint_version) } : {}),
        ...(row.fingerprint_hash ? { fingerprintHash: String(row.fingerprint_hash) } : {}),
        ...(row.fingerprint_snapshot ? { fingerprintSnapshot: row.fingerprint_snapshot as Record<string, unknown> } : {}),
        ...(row.execution_snapshot_hash ? { executionSnapshotHash: String(row.execution_snapshot_hash) } : {}),
        ...(row.request_payload_digest ? { requestPayloadDigest: String(row.request_payload_digest) } : {}),
        attemptNumber: Number(row.attempt_number || 1),
        ...(row.estimated_provider_cost ? { estimatedProviderCost: row.estimated_provider_cost as VideoValidationItem["estimatedProviderCost"] } : {}),
        ...(row.bound_evidence ? { boundEvidence: row.bound_evidence as Record<string, unknown> } : {}),
        ...(row.actual_cost_capability ? { actualCostCapability: row.actual_cost_capability as VideoValidationItem["actualCostCapability"] } : {}),
        ...(row.actual_cost_capability_evidence ? { actualCostCapabilityEvidence: row.actual_cost_capability_evidence as Record<string, unknown> } : {}),
        ...(row.actual_provider_cost ? { actualProviderCost: row.actual_provider_cost as VideoValidationItem["actualProviderCost"] } : {}),
        ...(row.actual_cost_provenance ? { actualCostProvenance: row.actual_cost_provenance as Record<string, unknown> } : {}),
        estimatedCredits: String(row.estimated_credits || row.estimated_cost_hotx_credits),
        ...(row.actual_credits !== null && row.actual_credits !== undefined ? { actualCredits: String(row.actual_credits) } : {}),
        ...(row.credit_settlement_source ? { creditSettlementSource: row.credit_settlement_source as VideoValidationItem["creditSettlementSource"] } : {}),
        reservationState: (row.reservation_state || "NONE") as VideoValidationItem["reservationState"],
        reservedCredits: String(row.reserved_credits || "0"),
        settledCredits: String(row.settled_credits || "0"),
        estimatedCostHotxCredits: String(row.estimated_cost_hotx_credits),
        ...(row.actual_cost_hotx_credits !== null && row.actual_cost_hotx_credits !== undefined ? { actualCostHotxCredits: String(row.actual_cost_hotx_credits) } : {}),
        ...(row.provider_task_id ? { providerTaskId: String(row.provider_task_id) } : {}),
        ...(row.provider_status ? { providerStatus: String(row.provider_status) } : {}),
        ...(row.result_summary ? { resultSummary: row.result_summary as Record<string, unknown> } : {}),
        ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
        ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
        idempotencyKey: String(row.idempotency_key),
        ...(row.submitted_at ? { submittedAt: iso(row.submitted_at) } : {}),
        ...(row.submission_started_at ? { submissionStartedAt: iso(row.submission_started_at) } : {}),
        ...(row.tested_at ? { testedAt: iso(row.tested_at) } : {}),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

function iso(value: unknown) {
    return value instanceof Date ? value.toISOString() : String(value);
}
