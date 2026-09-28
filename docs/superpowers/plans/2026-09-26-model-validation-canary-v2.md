# Model Validation/Canary V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user explicitly forbids commit and push for this work, so commit steps are omitted.

**Goal:** Make low-cost video validation select canaries by an immutable runtime fingerprint, verify changed bindings independently, and account for every provider submission through an atomic HOTX-credit budget ledger.

**Architecture:** A pure fingerprint/cost layer builds one immutable execution snapshot per binding and case. A PostgreSQL run/item ledger reserves before submit and settles or releases with terminal evidence; an append-only verification table drives `changed_models`. The existing video adapter performs live create/query/cancel, while thin admin APIs and the operations panel expose accurate metrics and provenance.

**Tech Stack:** Next.js Route Handlers, TypeScript, React, Ant Design, Decimal.js, PostgreSQL `NUMERIC`, Vitest, local TCP fixture, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-model-validation-canary-v2-design.md`

## Global Constraints

- Do not change user wallet hold, settlement, refund, usage snapshot, formal `saleRateCard`, or existing provider image/video generation behavior.
- No live provider generation during implementation or automated validation. Use the repository's local TCP fixture and fixed test credentials.
- Client sends IDs, mode, budget, concurrency, and preview revision only; server derives fingerprint, normalized context, price, payload, and idempotency identity.
- Every live submit requires `READY`, an executable normalized context, a proven conservative maximum `estimatedCredits`, an immutable matching execution snapshot, and an atomically committed reservation.
- Terminal actual cost is optional for submit. Missing actual after a billable submission settles the full reserved estimate as `ESTIMATED_FALLBACK`; it never implies release.
- Ambiguous create is replayed only when the provider contract explicitly proves same-key idempotent replay or reconciliation. Otherwise retain reservation and enter `SUBMISSION_UNKNOWN / NEEDS_RECONCILIATION`.
- A new generation attempt or provider/binding switch receives its own item, key, cost bound, and additional reservation. Prior attempt accounting remains independent.
- Actual credits above reserve are recorded in full with `COST_BOUND_VIOLATION`; stop further live submits for the run while continuing queries of already submitted tasks.
- All money is Decimal in code, `NUMERIC` in PostgreSQL, and decimal strings in DTOs. Raw provider amount/currency/unit and HOTX credits remain separate.
- No API keys, Authorization, sensitive raw responses, or signed media URLs in fingerprint, audit, history, or API DTOs.
- Preserve `REFERENCE_FIXTURE_UNAVAILABLE`; never send localhost references to an external provider.
- CI PostgreSQL tests use `VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1`, an isolated database, and `--no-file-parallelism`.
- Do not commit, push, create a PR, or modify unrelated dirty workspace files.

## Review Focus

1. A provider accepts `Idempotency-Key` but has no verified same-key replay contract: ambiguous create must not be issued again. Task 6 tests this separately from supported replay.
2. Worker configuration changes between preview, reserve, and submit: Task 1 and Task 5 test snapshot mismatch before any provider call.
3. Provider reports `actualCredits > reservedCredits`: Task 4 tests full actual accounting, `COST_BOUND_VIOLATION`, and no new submit.
4. Cancel is acknowledged without a no-charge guarantee: Task 6 tests conservative settlement, not release.
5. An administrator retries a failed validation on another binding: Task 4 tests a new attempt and additional reservation rather than transferring the old one.

## File Map

| Responsibility | Files |
| --- | --- |
| Public types and request validation | `web/src/lib/video-validation.ts`, `web/src/app/api/admin/video-validation/request.ts`, `web/src/services/api/admin-video-validation.ts` |
| Fingerprint and execution snapshot | New `web/src/lib/server/video-validation-fingerprint.ts`; existing `video-validation-contract.ts`, `video-validation-context.ts`, `video-generation-application.ts` |
| Cost bound, provider units and provenance | `web/src/lib/server/video-validation-cost.ts`; new `video-validation-cost-provenance.ts`; existing pricing policy/provider pricing types |
| Selection, history lookup and start | `web/src/lib/server/video-validation-service.ts`, `video-validation-probe.ts` |
| Schema and atomic ledger | `web/src/lib/server/database/schema.ts`, `schema-triggers.ts`, `postgres.ts`, `video-validation-repository.ts`, `repositories.ts` |
| Runtime, recovery and cancel | `web/src/lib/server/video-validation-worker.ts`, `video-task-runtime.ts`, `generation-task-cancellation-service.ts`, internal proxy route |
| Admin API and UI | `web/src/app/api/admin/video-validation/**`, `web/src/app/admin/generation-operations/components/video-validation-panel.tsx`, `video-validation-run-details.tsx` |
| PostgreSQL/CI/docs | `web/src/lib/server/database/video-validation.postgres.test.ts`, `.github/workflows/quality.yml`, `.github/workflows/docker-image.yml`, `docs/backend-database.md`, `docs/content/docs/backend/backend-database.mdx` |

## Transaction and State Map

| Operation | Lock and atomic writes | Provider network |
| --- | --- | --- |
| Create run | One transaction: run + items + audit; immutable snapshots | None |
| Reserve | Lock run then item; check `budget - settled - activeReserved >= estimatedCredits`; `NONE→RESERVED`; increment activeReserved | Only after commit |
| Save submit result | Compare item identity/digest; persist task ID or unknown state with same reservation | Outside transaction |
| Settle actual | Lock run then item; `RESERVED→SETTLED`; subtract reserve, add full actual; terminal item + provenance + verification + audit; mark violation if actual exceeds reserve | None inside transaction |
| Settle fallback | Same transaction; add reserved estimate to settled, leave actual fields null | None |
| Release | Only with proof of no task/no charge; `RESERVED→RELEASED`; subtract reserve; terminal item + verification/audit | None inside transaction |
| Cancel submitted | Mark request, keep reservation; settle/release only after provider terminal and billing evidence | Cancel outside transaction |
| Recovery | Lease/age triggers lookup only; unknown remains reserved until evidence | Query by task ID or verified same-key contract |

The active ledger invariant is `remainingBudget = budgetCredits - totalSettledCredits - activeReservedCredits`. SQL uses explicit `$n::numeric` for parameters used in arithmetic/comparison. `reconciling` runs may query submitted tasks but must not claim queued items for create.

### Task 1: Immutable fingerprint and executable request identity

**Files:** Create `web/src/lib/server/video-validation-fingerprint.ts`, `video-validation-fingerprint.test.ts`; modify `video-validation-contract.ts`, `video-generation-application.ts`, and `web/src/lib/video-validation.ts`.

**Interfaces:** Produce `buildVideoValidationFingerprint(input: FingerprintInput): FingerprintEnvelope`, `buildValidationExecutionSnapshot(input: ExecutionSnapshotInput): { hash: string; payloadDigest: string; fingerprint: FingerprintEnvelope }`, and a pure adapter request descriptor builder reused by validation preview and `createUpstream`. Descriptor includes final create endpoint, payload or multipart field digest, method, reference roles/immutable fixture revision, and idempotency key; it must not expose secrets.

- [ ] Write failing tests: canonical key order and set arrays produce the same V1 hash; ordered arrays retain order; provider, endpoint type, create/query path, request/parser shape, reference capability, billing basis, pricing/conversion revision, credential revision, or actual-cost capability revision changes the hash; display name does not. V2 and V1 never compare equal.
- [ ] Run `cd web && pnpm exec vitest run src/lib/server/video-validation-fingerprint.test.ts`; confirm RED for missing exports/behavior.
- [ ] Implement whitelist canonicalization, `sha256("model-validation-fingerprint:v1\n" + canonicalJson)`, and server-only credential HMAC revision. Extract only the provider request descriptor preparation needed so preview and runtime share payload construction; preserve all existing generation call paths.
- [ ] Add a test in `video-validation-fingerprint.test.ts` that changing normalized duration, reference URL/checksum, request template, binding, provider, pricing, or idempotency key after estimation makes the execution snapshot mismatch; the same snapshot survives reserve→submit.
- [ ] Run the focused test plus `video-validation-contract.test.ts` and relevant existing video adapter tests; confirm GREEN, then run `pnpm run typecheck`.

### Task 2: Proven cost bound, units, and settlement provenance

**Files:** Modify `web/src/lib/server/video-validation-cost.ts`, `video-validation-cost.test.ts`, `video-validation-context.ts`, `video-validation-context.test.ts`, `web/src/lib/video-validation.ts`; create `web/src/lib/server/video-validation-cost-provenance.ts` and matching test.

**Interfaces:** Produce `estimateValidationCost(input): { ok:true; estimatedProviderCost: ProviderCost|null; estimatedCredits:string; boundEvidence: BoundEvidence; actualCostCapability; conversionRevision } | { ok:false; reasonCode:"BUDGET_BOUND_UNAVAILABLE"|"COST_NOT_ESTIMATABLE" }`. Produce `normalizeValidationActualCost(input, frozenConversion): { actualProviderCost; actualCredits; provenance; source } | { source:"ESTIMATED_FALLBACK"; settledCredits:string; provenance }`. `selectLowestCostCanaries` groups by fingerprint version/hash plus case and compares Decimal credits, then channel priority and binding ID.

- [ ] Write failing tests: fixed per-second price and bounded duration are admitted; a token basis without proven maximum returns `BUDGET_BOUND_UNAVAILABLE`; a `NUMERIC(30,8)` bound is rounded upward, never down; no arbitrary markup/buffer is introduced; missing terminal actual-cost capability does not disqualify the bound.
- [ ] Run focused cost/context/provenance tests and confirm RED.
- [ ] Implement conservative maximum from current `providerPricingProfile`/`costRateCard` and pricing conversion snapshot. Preserve raw provider currency/unit where derivable; otherwise return provider cost `null` with an explicit credit-estimate source. Never label HOTX credits as provider cost.
- [ ] Add actual normalization tests: authoritative raw provider cost yields `ACTUAL_PROVIDER_COST` plus source field/time/task/units/revision; provider-reported HOTX credits uses `PROVIDER_REPORTED_CREDITS`; no credible actual yields null actual fields and `ESTIMATED_FALLBACK` at full reservation.
- [ ] Run focused tests and typecheck; confirm GREEN. Do not expand accepted billing bases solely to increase live coverage.

### Task 3: Schema and append-only verification history

**Files:** Modify `web/src/lib/server/database/schema.ts`, `schema-triggers.ts`, `postgres.ts`, `video-validation-repository.ts`, `postgres.test.ts`; update `docs/backend-database.md` and `docs/content/docs/backend/backend-database.mdx`.

**Interfaces:** Store V1 fingerprint version/hash/snapshot, execution snapshot/payload digest, attempt number, provider/credit costs, provenance, reservation state, run budget ledger, `SUBMISSION_UNKNOWN` item status, and `model_validation_verifications`. Expose repository `latestVerificationByBindingCase(keys)` as a bounded SQL lookup and `appendVerification` only inside terminal transaction. History has `UNIQUE(validation_item_id)` and cannot be updated/deleted; FK behavior retains history.

- [ ] Write failing schema/repository tests for table inventory, CHECK/UNIQUE/index definitions, V1 immutable snapshot, per-item idempotency uniqueness, latest PASS vs later FAIL/UNKNOWN ordering, and append-only protection.
- [ ] Run `cd web && pnpm exec vitest run src/lib/server/database/postgres.test.ts src/lib/server/database/video-validation-repository.test.ts`; confirm RED.
- [ ] Implement one-time pre-launch validation-table rebuild DDL; no synthetic backfill of old records. Add a PostgreSQL UPDATE/DELETE rejection trigger for verification history, indexes for `(binding_id,case_id,verified_at DESC,id DESC)` and same-fingerprint PASS lookup, plus reserved-age recovery index. Preserve all non-validation schema objects.
- [ ] Update both database docs with state/retention/provenance. Run focused tests and typecheck; confirm GREEN.

### Task 4: Atomic reservation, terminal settlement, cancellation, and attempts

**Files:** Modify `web/src/lib/server/database/video-validation-repository.ts`, `video-validation-repository.test.ts`, `video-validation.postgres.test.ts`, `web/src/lib/video-validation.ts`.

**Interfaces:** Replace `reserveItemBudget(runId,itemId,estimatedCost,now)` with `reserveItemBudget({runId,itemId,executionSnapshotHash,now}): Promise<"RESERVED"|"BUDGET_EXCEEDED"|"SNAPSHOT_CHANGED"|"NOT_ELIGIBLE">`; add `finalizeItem({itemId,evidence,actual?,now,actor}): Promise<...>` and `createNextAttempt({previousItemId,bindingId,context,estimate,fingerprint,payloadDigest}): Promise<VideoValidationItem>`. Repository owns run/item lock order and exactly-once ledger transitions; service provides evidence and audit identity.

- [ ] Write PostgreSQL tests for four simultaneous fractional reservations near a `0.7` budget, no overspend, reserve twice idempotency, and reserve rejected after run enters `reconciling`.
- [ ] Run the isolated PostgreSQL file with `VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1`, `DATABASE_URL` pointing to the dedicated test DB, and `--no-file-parallelism`; confirm RED.
- [ ] Implement run-row-then-item-row locking and compare-and-set reservation; use item-stored estimatedCredits/snapshot, never client-supplied estimate. A failed item update must roll back any run increment.
- [ ] Add terminal tests: `0.2268` reserve + `0.31` actual records `0.31`, sets `COST_BOUND_VIOLATION`, enters `reconciling`, and prevents later create; `0.20` actual releases `0.0268` in the same transaction; missing actual settles `0.2268`, keeps actual null, source `ESTIMATED_FALLBACK`.
- [ ] Add duplicate terminal/release tests proving exactly-once accounting and one verification row; inject audit/verification failure and assert full rollback. Cancel before submit releases only with non-creation proof; submitted cancel without no-charge proof settles conservatively.
- [ ] Add new-attempt and binding-switch tests: each has a fresh idempotency key and reservation; the previous reservation remains until separately settled/released. Run focused PostgreSQL tests and typecheck; confirm GREEN.

### Task 5: Preview, fingerprint grouping, changed mode, and API contract

**Files:** Modify `web/src/lib/server/video-validation-service.ts`, `video-validation-service.test.ts`, `web/src/app/api/admin/video-validation/request.ts`, preview/run route tests, `web/src/lib/video-validation.ts`.

**Interfaces:** `buildVideoValidationPreview` consumes current snapshot plus bounded latest-verification map; `previewVideoValidation` and `startVideoValidationRun` load it from repository. `changed_models` resolves each binding/case independently; `family_sample` selects one cheapest candidate per `(fingerprintVersion,fingerprintHash,caseId)`. Start rebuilds preview and rejects changed revision. `VideoValidationPreview` exposes models, bindings, validationCases, plannedFreeChecks, plannedLiveCanaries, skippedCases and separate provider/credit estimates.

- [ ] Write failing service tests: two bindings with same family but different fingerprint create two canaries; same hash/case picks the cheapest; a different case gets its own canary; tie uses priority then ID.
- [ ] Write failing `changed_models` tests: no prior, changed hash, previous FAIL all `LIVE_TEST_REQUIRED`; latest same-hash PASS is `SKIPPED_UNCHANGED`; UNKNOWN stays reconciliation-only; an older PASS does not override a newer FAIL/UNKNOWN; one binding does not inherit another binding's PASS.
- [ ] Write route/parser tests that accept `changed_models`, reject client-supplied rate card/fingerprint/payload, and reject stale preview after binding/pricing/context change. Verify `REFERENCE_FIXTURE_UNAVAILABLE` and HTTPS-only reference behavior.
- [ ] Run service and route tests to confirm RED; implement bounded lookup, grouping and metric semantics; rerun focused tests and typecheck to GREEN.

### Task 6: Provider create/query/cancel, ambiguous submit, and recovery

**Files:** Modify `web/src/lib/server/video-validation-worker.ts`, `video-validation-worker.test.ts`, `web/src/lib/server/database/video-validation-repository.ts`, `web/src/lib/server/video-generation-application.ts`, applicable local TCP fixture tests, and internal proxy authorization if required.

**Interfaces:** `resolveValidationReplayPolicy(config): "IDEMPOTENT_REPLAY"|"QUERY_BY_KEY"|"UNSUPPORTED"` must use verified provider/adapter contract evidence, not header presence. `processVideoValidationItem` checks the stored execution snapshot and reservation before provider create. Submitted task ID is queried, never recreated. `SUBMISSION_UNKNOWN` and `NEEDS_RECONCILIATION` retain reservation until evidence. Provider status/usage parser emits actual cost with provenance or explicit absence.

- [ ] Write failing worker/TCP tests: supported same-key replay uses identical key and payload digest; unsupported replay creates exactly one provider task and stays unknown; key reused with changed payload is rejected; config drift after reserve prevents create.
- [ ] Write failing cancel tests: pre-submit with proof releases; provider-confirmed no-charge cancellation releases; terminal cancellation with unknown cost settles fallback; unsupported cancel keeps reservation and polls until terminal, then settles actual or fallback; no actual cost alone never releases.
- [ ] Write failing recovery tests: crash after provider accepted but before task ID save reconciles by verified key or pauses; crash after saved task ID only queries; lease age merely triggers reconciliation; stale reservation without replay evidence remains reserved for manual review.
- [ ] Run focused worker/TCP tests to confirm RED. Reuse existing video adapters; add only the contract evidence and normalized actual-cost extraction needed for validation. Persist create result/unknown state before clearing lease.
- [ ] Run worker, video runtime, protocol matrix tests and typecheck; confirm GREEN. Confirm no real provider call is made by these tests.

### Task 7: Admin UI, metrics, and audit presentation

**Files:** Modify `web/src/services/api/admin-video-validation.ts`, `web/src/app/admin/generation-operations/components/video-validation-panel.tsx`, `video-validation-run-details.tsx` and their tests; update service run-detail mapping.

**Interfaces:** Show `changed_models`, fingerprint group/counts, `models`, `bindings`, `validationCases`, `freeChecks`, planned/actual `liveCanaries`, `liveSubmissions`, `skippedCases`, grouped raw provider cost, HOTX credit estimate/budget, actual source/provenance, and `COST_BOUND_VIOLATION`/reconciliation reasons. Live confirmation displays paid attempt count and conservative budget amount; `contract_only` remains free.

- [ ] Write failing component tests for correct case-vs-model labels, planned-vs-actual metrics, no misleading mixed-currency sum, missing-actual fallback display, unknown submit, and cost-bound violation.
- [ ] Run component tests and confirm RED; implement Chinese copy and responsive summaries without changing unrelated admin sections.
- [ ] Run component/API tests and typecheck to GREEN. Use browser regression at desktop, 390px, and 430px; inspect actual element rectangles/overflow and buttons, not only class names.

### Task 8: Isolated PostgreSQL gate, full regression, and release evidence

**Files:** Expand `web/src/lib/server/database/video-validation.postgres.test.ts`; modify `.github/workflows/quality.yml`, `.github/workflows/docker-image.yml`; update `docs/content/docs/progress/pending-test.mdx`, `docs/content/docs/progress/todo.mdx`, `CHANGELOG.md` only to reflect actual implemented state, and `VERSION` if project release gate requires it.

**Interfaces:** One integration flag: `VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1`. CI validation test job provisions a database distinct from E2E/other PG suites, runs the validation PG file with `--no-file-parallelism`, and fails if the file has zero executed tests. Each test uses UUID-scoped rows and cleans only its own rows.

- [ ] Add PostgreSQL test cases for create run/items, state transitions, concurrent reserve, over-budget contention, exactly-once settle/release, cancel before/after submit, stable replay, unknown submit, append-only fingerprint history, drift/same PASS/previous FAIL, fallback, crash/recovery, stale reservation, and atomic audit rollback.
- [ ] Run the isolated PG file with the standard flag; confirm all intended tests execute (none skipped). In both CI workflows, create `vozeb_pro_validation` in the PostgreSQL service using `psql -h 127.0.0.1 -U vozeb -d postgres -c 'CREATE DATABASE vozeb_pro_validation'` with the existing test password, then run only the validation suite with `DATABASE_URL=postgres://vozeb:vozeb-e2e-password@127.0.0.1:5432/vozeb_pro_validation`, `VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1`, and `--no-file-parallelism`. Keep E2E and the other PG suites on their current database.
- [ ] Run focused feature tests, `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, `pnpm run test:protocols`, `pnpm run check:release`, and the required Playwright browser regression. Run shared PostgreSQL suites with `--no-file-parallelism` and no live provider generation.
- [ ] Run strict UTF-8 decoding and checks for U+FFFD plus the project's known mojibake marker on touched text files. Record exact pass/skip counts, provider-free fixture evidence, family/fingerprint counts from current registry, cheapest canary per fingerprint, cost totals by provider unit and HOTX credits, and every skip reason. If current registry data is unavailable, report that fact rather than inventing counts.
- [ ] Inspect `git diff` for unrelated changes; leave the workspace uncommitted and do not push or create a PR.

## Spec Coverage and Review Handoff

Tasks 1–2 define the immutable contract and conservative budget bound; Tasks 3–4 enforce append-only history and atomic accounting; Task 5 handles grouping and `changed_models`; Task 6 handles idempotency, cancel, and recovery; Task 7 exposes units/metrics; Task 8 makes PostgreSQL and browser evidence a release gate. Every one of the five final invariants is tested in Tasks 1, 4, or 6.

This plan is ready for user review. Implementation starts only after the user accepts this plan. No implementation code, migration, test suite, live generation, commit, or push is part of the present documentation step.
