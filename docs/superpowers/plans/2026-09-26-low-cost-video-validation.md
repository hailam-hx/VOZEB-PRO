# Low-Cost Video Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator workflow that validates every video binding through free contract/probe checks and spends provider credits only on budgeted family canaries or explicitly requested minimum-parameter model smoke tests.

**Architecture:** A pure domain layer derives protocol-family fingerprints, probe outcomes, minimum executable contexts, and Decimal provider-cost previews from the existing protocol registry and binding capability/pricing profiles. PostgreSQL-backed validation runs and items hold immutable revisions, budget reservations, provider task state, and audit-safe results; a worker reuses the existing video create/query/cancel runtime. Thin admin APIs and a Chinese responsive operations panel expose preview, confirmation, progress, cancellation, history, drift, and reuse.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, PostgreSQL, Ant Design 6, Tailwind CSS, Decimal.js, existing VOZEB-PRO video adapters and local TCP protocol fixture.

**Spec:** `docs/superpowers/specs/2026-09-26-low-cost-video-validation-design.md`

## Global Constraints

- Contract and probe modes must never call a real provider generation endpoint.
- All selectable video parameters come only from the active binding capability profile; never infer them from a model ID or name.
- A live item requires `providerPricingProfile.status === "READY"` and an executable provider-cost estimate for its normalized context.
- The client submits IDs, mode, preview revision, budget, and concurrency only; the server reconstructs all contexts and prices.
- Use Decimal strings for every cost, sum, ordering tie, and budget comparison; do not use JS float for final financial logic.
- Live validation must not debit user wallets or modify hold, settlement, refund, retry, usage snapshot, `saleRateCard`, or existing generation formulas.
- Reuse the current video create/query/cancel adapters and stable idempotency behavior; do not duplicate provider request code.
- Persist no API Key, Authorization header, long-lived signed URL, or unfiltered upstream response.
- Normal test, typecheck, release check, and CI paths must not create a real video or read a production DFLOP API Key.
- UI copy remains Chinese and must work without horizontal overflow at desktop, 390px, and 430px.
- Update `docs/backend-database.md` when the new tables are added.
- Do not commit, push, or create a PR during execution unless the user explicitly authorizes it; commit steps below remain review checkpoints and are deferred by default.

## Review Focus

- A capability profile can advertise several resolutions while only some have executable prices: Task 2 must select the cheapest priced resolution and reject unpriced-only profiles.
- Two bindings can share endpoints but differ in reference or billing contracts: Task 1 must produce different family fingerprints and Task 4 must schedule separate canaries.
- Concurrent workers can reserve several items near the budget boundary: Task 3 must atomically reserve Decimal estimated cost so committed estimates never exceed the run budget.
- A preview can become stale after capability, pricing, channel, or registry sync: Task 4 and Task 6 must reject it with `REVISION_CHANGED` before any submit.
- Provider submit can succeed while the response is lost: Task 5 must recover with the same idempotency key and must not create a second charged task.

---

## File Structure

### New domain and server files

- `web/src/lib/video-validation.ts` — public run/item/preview types, status enums, reason codes, and API payload types.
- `web/src/lib/server/video-validation-contract.ts` — contract descriptors, canonical family fingerprints, case identities, and static contract validation.
- `web/src/lib/server/video-validation-probe.ts` — binding eligibility and probe classification without generation calls.
- `web/src/lib/server/video-validation-context.ts` — minimum executable normalized video context selection.
- `web/src/lib/server/video-validation-cost.ts` — provider-cost estimate, candidate ordering, and Decimal budget helpers.
- `web/src/lib/server/video-validation-service.ts` — preview, run creation, listing, detail, cancellation, revision checks, reuse, and audit orchestration.
- `web/src/lib/server/video-validation-worker.ts` — item claiming, adapter create/query/cancel, recovery, terminal result persistence, and actual-cost capture.
- `web/src/lib/server/database/video-validation-repository.ts` — PostgreSQL run/item persistence and atomic budget reservation.

### New API and UI files

- `web/src/app/api/admin/video-validation/preview/route.ts` — preview endpoint.
- `web/src/app/api/admin/video-validation/runs/route.ts` — create/list endpoint.
- `web/src/app/api/admin/video-validation/runs/[runId]/route.ts` — run detail endpoint.
- `web/src/app/api/admin/video-validation/runs/[runId]/cancel/route.ts` — cancellation endpoint.
- `web/src/services/api/admin-video-validation.ts` — typed client calls.
- `web/src/app/admin/generation-operations/components/video-validation-panel.tsx` — complete validation workflow UI.
- `web/src/app/admin/generation-operations/components/video-validation-run-details.tsx` — run progress, items, errors, and cost details.

### Existing files to modify

- `web/src/lib/server/active-protocol-media-matrix.live.test.ts` — consume shared contract cases and retain TCP assertions.
- `web/src/lib/server/active-protocol-media-proxy-matrix.live.test.ts` — consume shared family/case identities through the authenticated proxy path.
- `web/scripts/protocol-fixture-server.mjs` — add only missing video error/cancel/reference cases.
- `web/src/lib/server/database/schema.ts` — add validation run/item tables, constraints, indexes, and updated-at trigger.
- `web/src/lib/server/database/repositories.ts` and `web/src/lib/server/database/index.ts` — expose the repository.
- `web/src/lib/server/database/postgres.ts` — register new tables/indexes in schema inventory checks.
- `web/src/app/admin/generation-operations/components/generation-operations-client.tsx` — add the validation tab/panel.
- `web/package.json` — include the new contract tests in `test:protocols` if they are split into focused files.
- `web/scripts/generation-worker.mjs` — invoke validation work using the existing worker heartbeat loop without a second process.
- `docs/backend-database.md` and `docs/content/docs/backend/backend-database.mdx` — document both tables and retention/security semantics.
- `VERSION` — increment only after all required gates pass.

---

### Task 1: Shared Video Contract Descriptor and TCP Matrix

**Files:**
- Create: `web/src/lib/server/video-validation-contract.ts`
- Create: `web/src/lib/server/video-validation-contract.test.ts`
- Modify: `web/src/lib/server/active-protocol-media-matrix.live.test.ts`
- Modify: `web/src/lib/server/active-protocol-media-proxy-matrix.live.test.ts`
- Modify: `web/scripts/protocol-fixture-server.mjs`
- Test: `web/src/lib/server/video-validation-contract.test.ts`
- Test: `web/src/lib/server/active-protocol-media-matrix.live.test.ts`
- Test: `web/src/lib/server/active-protocol-media-proxy-matrix.live.test.ts`

**Interfaces:**
- Consumes: `registeredChannelProtocolDefinitions`, `protocolModelConfig`, binding `generationParameters`, and current video operation config.
- Produces: `describeVideoContract(input): VideoContractFamilyDescriptor`, `videoContractFamilyFingerprint(descriptor): string`, `buildVideoContractCases(input): VideoContractCase[]`, and `validateStaticVideoContract(input): VideoContractCheckResult`.

- [ ] **Step 1: Write failing family fingerprint tests**

Add tests named `groups identical execution-query-pricing contracts`, `separates reference contracts`, `separates billing bases`, and `is stable across object key order`. Assert that names/model IDs do not change the fingerprint, while path, request-shape revision, parser revision, reference mode, billing basis, or runtime option key changes do.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-contract.test.ts`

Expected: FAIL because the contract module and exported functions do not exist.

- [ ] **Step 3: Implement the descriptor and stable fingerprint**

Implement the four exported functions with canonical JSON hashing. The descriptor must contain protocol, create/image-to-video/query/cancel paths, request/status/result revisions, reference modes, billing bases, and request-shaping runtime option keys; labels and model IDs are excluded from equality.

- [ ] **Step 4: Add failing contract-case tests**

Assert exact cases for text-to-video, image-to-video, first-frame, first/last-frame, audio, watermark, auth, idempotency, cancel, 400/402/429/503, timeout, and submission-uncertain recovery. Unsupported binding capabilities must return `NOT_APPLICABLE`, not `FAILED`.

- [ ] **Step 5: Make existing TCP matrices consume the shared case identities**

Keep socket-level request/response assertions in the current live tests. Add only fixture behavior missing from the shared case matrix; do not move Vitest or the TCP server into production runtime.

- [ ] **Step 6: Run protocol verification**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-contract.test.ts src/lib/server/active-protocol-media-matrix.live.test.ts src/lib/server/active-protocol-media-proxy-matrix.live.test.ts --reporter=verbose`

Expected: PASS; fixture request logs contain no non-loopback origin.

- [ ] **Step 7: Review checkpoint (commit only if authorized)**

Suggested commit: `test(video): share validation contract matrix`

---

### Task 2: Probe, Minimum Context, and Provider-Cost Preview

**Files:**
- Create: `web/src/lib/video-validation.ts`
- Create: `web/src/lib/server/video-validation-probe.ts`
- Create: `web/src/lib/server/video-validation-probe.test.ts`
- Create: `web/src/lib/server/video-validation-context.ts`
- Create: `web/src/lib/server/video-validation-context.test.ts`
- Create: `web/src/lib/server/video-validation-cost.ts`
- Create: `web/src/lib/server/video-validation-cost.test.ts`

**Interfaces:**
- Consumes: Task 1 contract functions, `LogicalModel`, `LogicalModelBinding`, `SystemModelChannel`, `ProviderPricingProfile`, `PricingRateCardV1`, and current provider pricing conversion helpers.
- Produces: `probeVideoBinding(input): VideoValidationProbeResult`, `resolveMinimumVideoValidationContext(input): MinimumVideoValidationContextResult`, `estimateVideoValidationProviderCost(input): VideoValidationCostResult`, and `selectLowestCostCanaries(items): VideoValidationCandidate[]`.

- [ ] **Step 1: Write failing probe classification tests**

Cover `CONTRACT_READY`, `CAPABILITY_INCOMPLETE`, `PRICING_INCOMPLETE`, `AUTH_UNAVAILABLE`, and `NEEDS_REVIEW`. Assert that disabled/ineligible binding, absent credential, incomplete operation, non-`READY` pricing, and unknown billing basis each return a stable reason code and Chinese admin message without a generation fetch.

- [ ] **Step 2: Run probe tests and verify RED**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-probe.test.ts`

Expected: FAIL because the probe module is missing.

- [ ] **Step 3: Implement probe types and `probeVideoBinding`**

Keep the function pure. Accept already-loaded registry/channel/model/binding inputs and a credential-availability boolean; never accept or expose the API key value.

- [ ] **Step 4: Write failing minimum-context tests**

Assert `count="1"`, declared minimum duration, default/stably ordered aspect ratio, optional audio/watermark disabled, correct reference fixture roles, and rejection when any execution or pricing input cannot be normalized. Add the Review Focus case where 480p is supported but unpriced and 720p is the cheapest executable resolution; expect 720p.

- [ ] **Step 5: Implement `resolveMinimumVideoValidationContext`**

Return a discriminated success/failure result containing binding ID, upstream model ID, immutable capability revision, request fields, reference contract, pricing context, and selection reasons. Reuse existing capability validators instead of copying range or option logic.

- [ ] **Step 6: Write failing Decimal cost and canary tests**

Use fractional values such as `0.2268` and `0.56133`. Assert exact string totals, stable tie ordering, one cheapest candidate per family/case, `COST_NOT_ESTIMATABLE` for missing dimensions, and separate canaries for the same endpoints with different reference/billing contracts.

- [ ] **Step 7: Implement provider-cost preview helpers**

Project `costRateCard` through the existing pricing primitives with the normalized context. Do not call `saleRateCard` and do not convert through `Number`.

- [ ] **Step 8: Run the domain suite**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-probe.test.ts src/lib/server/video-validation-context.test.ts src/lib/server/video-validation-cost.test.ts`

Expected: PASS.

- [ ] **Step 9: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(video): derive validation probes and minimum costs`

---

### Task 3: PostgreSQL Validation Runs, Items, and Atomic Budget Reservation

**Files:**
- Create: `web/src/lib/server/database/video-validation-repository.ts`
- Create: `web/src/lib/server/database/video-validation-repository.test.ts`
- Create: `web/src/lib/server/database/video-validation.postgres.test.ts`
- Modify: `web/src/lib/server/database/schema.ts`
- Modify: `web/src/lib/server/database/repositories.ts`
- Modify: `web/src/lib/server/database/index.ts`
- Modify: `web/src/lib/server/database/postgres.ts`
- Test: `web/src/lib/server/database/video-validation-repository.test.ts`
- Test: `web/src/lib/server/database/video-validation.postgres.test.ts`

**Interfaces:**
- Consumes: Task 2 run/item domain types.
- Produces: `VideoValidationRepository` methods `createRun`, `listRuns`, `getRunWithItems`, `claimNextItems`, `reserveItemBudget`, `saveSubmittedTask`, `saveItemTerminal`, `requestCancellation`, and `aggregateRunStatus`.

- [ ] **Step 1: Write failing schema assertions**

Assert both tables, foreign keys, status checks, `NUMERIC` cost columns, unique run/binding/test/case identity, due-work indexes, lease fields, and updated-at trigger exist in `POSTGRESQL_SCHEMA_SQL`.

- [ ] **Step 2: Run schema/repository tests and verify RED**

Run: `cd web && pnpm vitest run src/lib/server/database/video-validation-repository.test.ts`

Expected: FAIL because the tables and repository do not exist.

- [ ] **Step 3: Add schema and record mappers**

Add direct new-schema definitions without legacy migrations. Store normalized context/result summary as JSONB and costs as `numeric(30, 8)` or the project’s established financial precision.

- [ ] **Step 4: Write failing repository behavior tests**

Assert bounded pagination, run+item creation transaction, `FOR UPDATE SKIP LOCKED` claiming, stable idempotency persistence, cancellation, terminal aggregation, and redaction-friendly result fields.

- [ ] **Step 5: Implement `VideoValidationRepository` and expose it**

Use parameterized SQL and targeted queries only. Do not load all runs/items for filtering in Node.js.

- [ ] **Step 6: Write the concurrent Decimal budget regression**

Create a run budget `0.7` and concurrent items `0.2268`, `0.2268`, `0.2268`, `0.2268`. Assert exactly three reservations succeed, the fourth is `SKIPPED_BUDGET_EXHAUSTED`, and committed estimate equals `0.6804`. Include explicit `$n::numeric` casts for placeholders used in both assignment and comparison.

- [ ] **Step 7: Run the real PostgreSQL test serially**

Run: `cd web && pnpm vitest run src/lib/server/database/video-validation.postgres.test.ts --no-file-parallelism`

Expected: PASS when the configured PostgreSQL test database is available; otherwise report the environment skip separately and keep the mocked repository test passing.

- [ ] **Step 8: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(video): persist validation runs with hard budgets`

---

### Task 4: Preview, Revision, Reuse, and Run Creation Service

**Files:**
- Create: `web/src/lib/server/video-validation-service.ts`
- Create: `web/src/lib/server/video-validation-service.test.ts`
- Modify: `web/src/lib/server/audit-log-store.ts` only if a typed helper is required; otherwise use its current interface.

**Interfaces:**
- Consumes: Tasks 1–3 functions/repository and `getFreshAuthSettings()`.
- Produces: `previewVideoValidation(input, actor): Promise<VideoValidationPreview>`, `startVideoValidationRun(input, actor): Promise<VideoValidationRunDetail>`, `listVideoValidationRuns(query)`, `getVideoValidationRun(runId)`, and `cancelVideoValidationRun(runId, actor)`.

- [ ] **Step 1: Write failing preview tests**

Assert server-derived counts/costs, `family_sample` one candidate per family/case, `all_models_minimum` every eligible binding, skip reasons for mixed statuses, and `contract_only` zero live cost. Spy on generation functions and assert zero calls.

- [ ] **Step 2: Run service tests and verify RED**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-service.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement the preview pipeline**

Read fresh settings, build candidates, probe, normalize, estimate, select, and return a stable revision over registry, pricing policy, channel config, capability, pricing, selection, budget, and concurrency inputs.

- [ ] **Step 4: Write failing stale-preview and reuse tests**

Change capability, pricing, channel config, credential availability, and registry revision after preview. Each must produce `REVISION_CHANGED` before repository run creation. Assert unchanged prior `PASSED` results become `REUSED_UNCHANGED`; changed execution contract does not reuse. Pricing-only drift must rerun selection/preview without reporting adapter failure.

- [ ] **Step 5: Implement run creation and reuse**

Recompute preview from server state, compare revisions, create run/items transactionally, and write audit metadata without secrets. Business validation skips individual items; database failure rolls back the whole creation transaction.

- [ ] **Step 6: Write and pass list/detail/cancel tests**

Assert bounded pagination, ownership-independent admin access under permission checks handled by routes, cancellation of unsubmitted items, and cancellation request state for already submitted items.

- [ ] **Step 7: Run service and audit tests**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-service.test.ts src/lib/server/audit-log-store.test.ts`

Expected: PASS.

- [ ] **Step 8: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(video): orchestrate validation previews and runs`

---

### Task 5: Validation Worker, Idempotent Runtime, Recovery, and Cancellation

**Files:**
- Create: `web/src/lib/server/video-validation-worker.ts`
- Create: `web/src/lib/server/video-validation-worker.test.ts`
- Modify: `web/scripts/generation-worker.mjs`
- Test: `web/src/lib/server/video-validation-worker.test.ts`

**Interfaces:**
- Consumes: Task 3 repository, Task 4 run/item state, existing `createUpstream`/video query/cancel adapters, and existing provider usage evidence parsers.
- Produces: `processVideoValidationBatch(input): Promise<VideoValidationWorkerSummary>` and `recoverVideoValidationItem(item, now): Promise<VideoValidationItem>`.

- [ ] **Step 1: Write failing worker happy-path tests**

Assert a claimed canary reserves budget, submits exactly once with stable `video-validation:<itemId>` idempotency identity, persists provider task ID before polling, reaches `PASSED`, records safe result metadata, and captures authoritative actual cost only when present.

- [ ] **Step 2: Run worker tests and verify RED**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-worker.test.ts`

Expected: FAIL because the worker is missing.

- [ ] **Step 3: Implement create/query terminal flow by reusing current adapters**

Do not create user conversation, work, wallet hold, usage charge, or `saleRateCard` update. Use the validation item snapshot and current channel secret resolved server-side.

- [ ] **Step 4: Write failing submission-uncertain recovery tests**

Simulate provider task creation followed by response loss. On recovery assert the identical idempotency key is used, no second fixture task exists, and the item resumes query/poll state. Also cover 402, 429, 503, terminal provider failure, and query failure without fixed retry-count constants.

- [ ] **Step 5: Implement recovery, retry scheduling, and error mapping**

Use existing retry/backoff/provider semantics and stored task state. Sanitize HTML gateway bodies and secrets before persistence.

- [ ] **Step 6: Write failing cancellation tests**

Assert unsubmitted items cancel locally, submitted items call the current cancel adapter when supported, unsupported cancel yields `CANCEL_UNSUPPORTED`, and the original task continues to a recorded terminal state without re-submit.

- [ ] **Step 7: Integrate with the existing generation worker loop**

Call `processVideoValidationBatch` as another bounded work source under existing heartbeat/lifecycle behavior. Do not add a second daemon or fixed polling interval.

- [ ] **Step 8: Run worker and protocol recovery tests**

Run: `cd web && pnpm vitest run src/lib/server/video-validation-worker.test.ts src/lib/server/active-protocol-media-matrix.live.test.ts`

Expected: PASS, including one fixture task for submission-uncertain retry.

- [ ] **Step 9: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(video): run recoverable validation canaries`

---

### Task 6: Admin API Contracts and Permission Boundaries

**Files:**
- Create: `web/src/app/api/admin/video-validation/preview/route.ts`
- Create: `web/src/app/api/admin/video-validation/preview/route.test.ts`
- Create: `web/src/app/api/admin/video-validation/runs/route.ts`
- Create: `web/src/app/api/admin/video-validation/runs/route.test.ts`
- Create: `web/src/app/api/admin/video-validation/runs/[runId]/route.ts`
- Create: `web/src/app/api/admin/video-validation/runs/[runId]/route.test.ts`
- Create: `web/src/app/api/admin/video-validation/runs/[runId]/cancel/route.ts`
- Create: `web/src/app/api/admin/video-validation/runs/[runId]/cancel/route.test.ts`

**Interfaces:**
- Consumes: Task 4 service functions.
- Produces: the five `{ code, data, msg }` HTTP contracts in the approved spec.

- [ ] **Step 1: Write failing auth and input tests for all routes**

Assert 401 for anonymous, 403 without required permissions, preview/detail/list access rules, create/cancel `generation.manage + upstream.manage`, Decimal budget validation, positive concurrency, enum validation, bounded pagination, and rejection of client-supplied context/price/payload/task fields.

- [ ] **Step 2: Run route tests and verify RED**

Run: `cd web && pnpm vitest run src/app/api/admin/video-validation/**/*.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement thin Route Handlers**

Handlers perform session/permission checks, parse the exact request DTO, call the service, and map typed service errors. Keep business rules and database access out of route files.

- [ ] **Step 4: Add revision-race and secret-redaction route tests**

Assert stale preview returns HTTP 409 with `REVISION_CHANGED`, creates no run and makes no provider call. Serialize responses and assert no `apiKey`, `authorization`, raw signed URL, or upstream HTML body appears.

- [ ] **Step 5: Run all route tests**

Run: `cd web && pnpm vitest run src/app/api/admin/video-validation/**/*.test.ts`

Expected: PASS.

- [ ] **Step 6: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(admin): expose video validation APIs`

---

### Task 7: Admin Low-Cost Video Validation UI

**Files:**
- Create: `web/src/services/api/admin-video-validation.ts`
- Create: `web/src/app/admin/generation-operations/components/video-validation-panel.tsx`
- Create: `web/src/app/admin/generation-operations/components/video-validation-panel.test.tsx`
- Create: `web/src/app/admin/generation-operations/components/video-validation-run-details.tsx`
- Create: `web/src/app/admin/generation-operations/components/video-validation-run-details.test.tsx`
- Modify: `web/src/app/admin/generation-operations/components/generation-operations-client.tsx`
- Modify: `web/src/app/admin/generation-operations/components/generation-operations-client.test.tsx`

**Interfaces:**
- Consumes: Task 6 HTTP DTOs through the typed API service.
- Produces: a Chinese `低成本视频验收` panel with preview, confirmation, progress, cancellation, history, drift, reuse, skip reasons, and responsive detail views.

- [ ] **Step 1: Write failing interaction tests**

Assert the default mode is `按协议族抽样`; modes include `仅合同检查` and `全部模型最小参数`; preview displays selected/runnable/skipped counts and exact Decimal estimate; live modes require confirmation; contract-only does not show a provider-fee confirmation; stale preview asks for a new preview.

- [ ] **Step 2: Run component tests and verify RED**

Run: `cd web && pnpm vitest run src/app/admin/generation-operations/components/video-validation-panel.test.tsx`

Expected: FAIL because components and service do not exist.

- [ ] **Step 3: Implement the typed API service and panel state**

Use the existing admin request pattern. Keep server results authoritative; do not construct rate cards, contexts, or totals in React.

- [ ] **Step 4: Implement preview and confirmation UI**

Show model/binding filters, budget, concurrency, READY-only explanation, counts, estimated provider cost, normalized parameter summaries, per-item skip reason, and the exact live items that will incur cost.

- [ ] **Step 5: Write failing run-details tests**

Cover queued/submitted/polling/passed/failed/skipped/cancelled/reused states, expected versus actual cost, safe task/request IDs, friendly Chinese error messages, cancellation behavior, and absence of raw secret/signed URL fields.

- [ ] **Step 6: Implement run progress, history, and responsive details**

Add the panel to generation operations/upstream workflow without importing billing edit modules. Use responsive cards or condensed rows below the desktop breakpoint and keep actions visible.

- [ ] **Step 7: Run component regression tests**

Run: `cd web && pnpm vitest run src/app/admin/generation-operations/components/video-validation-*.test.tsx src/app/admin/generation-operations/components/generation-operations-client.test.tsx`

Expected: PASS.

- [ ] **Step 8: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(admin): add low-cost video validation workflow`

---

### Task 8: Database Documentation, Release Metadata, and Full Verification

**Files:**
- Modify: `docs/backend-database.md`
- Modify: `docs/content/docs/backend/backend-database.mdx`
- Modify: `web/package.json` if protocol test files changed
- Modify: `VERSION`
- Test: all files added or modified in Tasks 1–7

**Interfaces:**
- Consumes: completed feature from Tasks 1–7.
- Produces: release-ready documentation and verified build state; no new runtime interface.

- [ ] **Step 1: Update database and operator documentation**

Document table purpose, status lifecycle, JSONB snapshots, numeric costs, lease/budget transaction, sensitive-data exclusions, reuse/drift revisions, and that validation tasks do not affect user settlement.

- [ ] **Step 2: Run focused validation suites**

Run:

```bash
cd web
pnpm vitest run \
  src/lib/server/video-validation-contract.test.ts \
  src/lib/server/video-validation-probe.test.ts \
  src/lib/server/video-validation-context.test.ts \
  src/lib/server/video-validation-cost.test.ts \
  src/lib/server/database/video-validation-repository.test.ts \
  src/lib/server/video-validation-service.test.ts \
  src/lib/server/video-validation-worker.test.ts \
  src/app/api/admin/video-validation/**/*.test.ts \
  src/app/admin/generation-operations/components/video-validation-*.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run protocol and non-DFLOP regression tests**

Run: `cd web && pnpm test:protocols`

Expected: PASS with no real provider generation request.

- [ ] **Step 4: Run PostgreSQL validation serially**

Run: `cd web && pnpm vitest run src/lib/server/database/video-validation.postgres.test.ts --no-file-parallelism`

Expected: PASS or a clearly reported environment skip; do not represent a skip as a pass.

- [ ] **Step 5: Run type, lint, format, and full test gates**

Run:

```bash
cd web
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Expected: all commands PASS. If a known unrelated baseline failure remains, record its exact file/error separately and do not claim a clean gate.

- [ ] **Step 6: Execute browser regression without a live provider run**

At desktop, 390px, and 430px verify mode controls, preview results, skip reasons, confirmation modal, mocked run progress/history, visible cancellation, final element bounds, and no horizontal overflow. Confirm that contract-only browser/network traces contain no `/videos/generations` request.

- [ ] **Step 7: Increment VERSION and run release check**

Only after Steps 2–6 pass, increment the project patch version and run: `cd web && pnpm check:release`.

Expected: release check PASS, including strict UTF-8 decoding and no common replacement-character or mojibake markers.

- [ ] **Step 8: Optional explicitly authorized live family canary**

Only when an administrator supplies a budget and confirms the live preview, run `按协议族抽样`. Record selected families, expected cost, actual cost when authoritative, task IDs, terminal status, and skipped items. Never include this step in normal CI or release check.

- [ ] **Step 9: Review checkpoint (commit only if authorized)**

Suggested commit: `feat(video): complete low-cost validation release gate`

---

## Completion Report

The implementer must report:

1. Modified files grouped by domain, database, API, worker, UI, docs, and tests.
2. Final API contracts and permission rules.
3. Contract family fields and observed family count from current configured video bindings.
4. Probe totals by `CONTRACT_READY`, `CAPABILITY_INCOMPLETE`, `PRICING_INCOMPLETE`, `AUTH_UNAVAILABLE`, and `NEEDS_REVIEW`.
5. Preview selection, skipped reasons, Decimal estimated cost, and hard budget behavior.
6. Evidence that contract/probe modes made zero provider generation calls.
7. Submission-uncertain/idempotency recovery result.
8. PostgreSQL budget concurrency result.
9. Focused, protocol, full test, typecheck, lint, format, release-check, UTF-8, and browser regression results.
10. Whether a live family canary was explicitly authorized and run; if not, state that no provider credits were spent.
