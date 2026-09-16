# Agent Stability Final Report

Date: 2026-09-16
Branch: `codex/agent-r1-stability`

## Result

R0-R15 are complete or verified against the current source. No critical recovery invariant remains `FAIL`. The branch is ready for review and merge after the normal deployment owner validates the additive database rollout and deploys App and Worker from the same immutable image.

## Phase record

| Phase | Result | Evidence |
| --- | --- | --- |
| R0 baseline | COMPLETE | Source trace, P0 verification, exact tests and commands in `AGENT_R0_BASELINE_REPORT.md` |
| R1 P0 stability | COMPLETE | Image Responses keeps `image_generation`; recoverable planner settlement; settled parallel dispatch; stable text child identity; worker compatibility fencing |
| R2 remove self-HTTP | COMPLETE | Agent calls `generation-application-service.ts`; task-creation routes are thin re-exports and polling handlers are invoked in-process without a network request |
| R3 first-class persistence | COMPLETE | Additive Agent Run, plan, task, dependency, ToolCall, and context tables; PostgreSQL hydration uses them |
| R4 durable DAG scheduler | COMPLETE | Dependency-aware `SKIP LOCKED` claims, leases, execution fencing, durable retry eligibility |
| R5 settlement hardening | VERIFIED | Existing planner and Generation billing primitives remain separate; recovery/idempotency tests cover repeated and concurrent settlement |
| R6 provider protocols | VERIFIED | Existing explicit protocol registry/adapters and protocol matrix tests already enforce pre/post-acceptance behavior |
| R7 durable events/SSE | VERIFIED | Existing `creative_run_events`, cursor replay, terminal draining, and reconnect tests satisfy the requirement |
| R8 planner cleanup | COMPLETE | Planner produces validated logical tasks and no longer carries internal generation route knowledge |
| R9 review decoupling | COMPLETE | Ordinary runs complete before asynchronous review; explicit strict modes remain blocking |
| R10 observability | COMPLETE | Agent task and ToolCall traces join existing Generation attempts, assets, usage, and settlement data |
| R11 operations UI | COMPLETE | Existing Generation Operations details now show Agent tasks and nested ToolCalls/generation links |
| R12 crash/concurrency tests | COMPLETE | Deterministic unit recovery coverage plus a disposable real-PostgreSQL claim/idempotency race test |
| R13 quality gate | COMPLETE WITH AUDIT EXCEPTION | Tests, protocol suite, lint, formatting, types, builds, PostgreSQL integration, and focused browser regression pass; unrelated dependency advisories remain |
| R14 invariant audit | COMPLETE | See the invariant table below |
| R15 documentation | COMPLETE | Final architecture, database documentation, changelog, deployment and rollback guidance updated |

## Architecture and production code changes

The implementation adds an additive first-class PostgreSQL Agent runtime while retaining the existing Agent `generation_tasks` record as an API/file-provider compatibility projection. Plans are immutable and versioned; tasks and dependency edges are independently persisted; ToolCalls provide the stable boundary between Agent intent and an existing Generation task.

The durable scheduler claims dependency-ready tasks with `FOR UPDATE SKIP LOCKED`, records the lease owner and expiry, and stores retry eligibility. Existing Run mutations retain execution-ID fencing. Agent generation calls prepare the ToolCall before invoking the shared application layer, then compare-and-set the returned Generation identity. Accepted work is reused and ambiguous submission remains `unknown`.

Image, video, audio, and text creation implementations were moved into server application modules. The HTTP creation routes and Agent use the same implementation; Agent polling invokes the existing authenticated GET handlers in-process. This preserves authorization, capability checks, model/provider routing, billing, idempotency, and recovery without an internal network request.

The main production files are:

- `web/src/lib/server/agent-runtime-repository.ts`
- `web/src/lib/server/agent-run-execution.ts`
- `web/src/lib/server/creative-runtime-repository.ts`
- `web/src/lib/server/generation-application-service.ts`
- `web/src/lib/server/image-task-application.ts`
- `web/src/lib/server/video-generation-application.ts`
- `web/src/lib/server/audio-task-application.ts`
- `web/src/lib/server/text-task-application.ts`
- `web/src/lib/server/database/schema.ts`
- `web/src/lib/server/generation-worker-compatibility.ts`
- `web/src/lib/server/generation-operations-service.ts`
- `web/src/app/(admin)/admin/generation-operations/generation-operation-task-details.tsx`
- the four generation task creation route modules, which now delegate to the shared application modules
- `web/scripts/generation-worker.mjs`, `Dockerfile`, and `.github/workflows/docker-image.yml`

## Database migration

Schema marker `20260916_agent_runtime_v2` adds:

- `vozeb_pro_agent_runs`
- `vozeb_pro_agent_plans`
- `vozeb_pro_agent_tasks`
- `vozeb_pro_agent_task_dependencies`
- `vozeb_pro_agent_tool_calls`
- `vozeb_pro_agent_context_snapshots`

The migration is additive. Foreign keys reference the existing creative conversation and Generation task records; unique constraints enforce plan version, task key, and ToolCall identity. Partial indexes support due task claims. The DDL is ordered after `creative_conversations`, and a disposable PostgreSQL 16 database executed the actual schema and concurrency test successfully.

## Tests added or strengthened

- `agent-runtime-repository.test.ts`: immutable plan/task projection, stable ToolCall preparation and binding, dependency-aware lease SQL.
- `agent-runtime-repository.postgres.test.ts`: two workers race for one task claim and two callers race for one ToolCall identity on real PostgreSQL.
- `generation-application-service.test.ts`: identity before side effect, accepted Generation reuse, and explicit unknown outcome.
- `agent-run-executor.test.ts`: planner settlement recovery, permanent identity failure, sibling preservation, stable children, no self-HTTP, and blocking/non-blocking review behavior.
- Worker heartbeat/run/usage tests and Docker/render contract tests: build/Git/schema/protocol compatibility.
- Generation Operations tests: Agent task/ToolCall trace rendering.
- Existing protocol, billing, event replay, asset, scheduler, and route tests were retained and exercised by the full suite.

## Quality gate

Commands use Node.js `22.23.2`.

| Check | Result |
| --- | --- |
| `pnpm --dir web test -- --no-file-parallelism` | PASS: 596 files passed, 8 skipped; 3,148 tests passed, 20 skipped (3,168 total) |
| `pnpm --dir web run test:protocols -- --no-file-parallelism` | PASS: 7 files, 123 tests |
| `pnpm --dir web run lint` | PASS |
| `pnpm --dir web run format:check` | PASS |
| `pnpm --dir web run typecheck` | PASS |
| `pnpm --dir web run build` | PASS: Next.js 16.2.12 production build, 62 static pages |
| `pnpm --dir docs run types:check` | PASS |
| `pnpm --dir docs run build` | PASS: 36 documentation pages |
| Real PostgreSQL Agent concurrency test | PASS: 1 test on disposable PostgreSQL 16 |
| Playwright `core.spec.ts` + `planner-failover.spec.ts`, Chromium, dedicated ports | PASS: 21 passed, 1 PostgreSQL-only payment case skipped |

The real PostgreSQL command was:

```bash
VOZEB_PRO_DATABASE_PROVIDER=postgres \
VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1 \
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/vozeb_agent_test \
pnpm --dir web exec vitest run src/lib/server/agent-runtime-repository.postgres.test.ts --no-file-parallelism
```

The browser command was:

```bash
VOZEB_PRO_E2E_PORT=3191 \
VOZEB_PRO_DOCS_E2E_PORT=3192 \
VOZEB_PRO_PROTOCOL_FIXTURE_PORT=4191 \
VOZEB_PRO_PAYMENT_FIXTURE_PORT=4192 \
pnpm --dir web exec playwright test e2e/core.spec.ts e2e/planner-failover.spec.ts \
  --project=chromium --workers=1
```

The first browser invocation found stale local `.e2e-data` and correctly failed its fresh-install precondition at `/en`. After deleting only that disposable E2E directory, the isolated rerun result shown above is authoritative.

## Dependency audit

`check:release` is not reported as fully passed. `pnpm --dir web audit --audit-level=high` reports 11 pre-existing, non-Agent advisories: 2 critical, 3 high, and 6 moderate. The high/critical findings include Next.js 16.2.12, Sharp below 0.35.4, `js-yaml` below 4.3.2 through the lint toolchain, and Tiptap core below 3.30.5. They were recorded separately and were not upgraded in this stability refactor, as required by scope. No application behavior or authentication boundary was weakened to bypass them.

## Recovery invariant audit

| Invariant | Classification | Evidence or limitation |
| --- | --- | --- |
| No blind replay after accepted/unknown provider outcome | PASS | ToolCall `unknown` is persisted; existing Generation protocol boundary prevents generic failover |
| One logical operation does not duplicate provider submission | PASS | Stable ToolCall idempotency plus bound Generation identity; concurrent PostgreSQL identity test |
| No duplicate Generation task | PASS | Compare-and-set ToolCall binding and existing Generation client request identity |
| No duplicate asset | PASS | Existing stable Run/task/ordinal asset upsert; completed siblings retained |
| No duplicate usage/settlement/wallet debit | PASS | Existing idempotent billing ledger, planner settlement recovery, and concurrent wallet/usage tests |
| Planner executes at most once after a persisted successful outcome | PASS | Persisted planner attempt/plan/settlement state resumes without a second request |
| Transient planner settlement is recoverable | PASS | Run remains recoverable and settles before child dispatch on resume |
| Permanent billing identity conflict terminates | PASS | Explicit terminal test for incomplete/conflicting identity |
| Parallel branch failure preserves successful siblings | PASS | Settled parallel dispatch and per-child persistence tests |
| Retry/backoff is durable and cannot hot-loop | PASS | `waiting_retry` plus persisted `next_attempt_at` claim predicate |
| Dependency scheduling is durable and concurrency-safe | PASS | Persisted edges, dependency query, `SKIP LOCKED`, real two-worker test |
| Stale executor cannot overwrite a newer lease | PASS | Existing Run execution-ID fencing, task row locks/lease ownership, and stale-executor tests |
| App/worker restart resumes progress | PASS | First-class task hydration plus existing Generation recovery and lease semantics |
| Browser disconnect cannot stop execution | PASS | Execution is server/worker owned; durable event replay reconstructs UI state |
| SSE replay is monotonic and avoids duplicate terminal delivery | PASS | Existing cursor and terminal-drain tests over `creative_run_events` |
| Worker compatibility is fenced before batch processing | PASS | Build, Git SHA, schema, and protocol checks on maintenance endpoints/readiness |
| Agent/Generation ownership is separated | PASS | Agent owns ToolCall linkage; Generation owns provider, assets, usage, and settlement |
| File-provider multi-instance recovery | NOT_APPLICABLE | File mode is documented as serialized local fallback; production recovery requires PostgreSQL |
| Complete typed separation from HTTP request objects | PARTIAL | Self-HTTP is removed, but shared creation handlers retain Web Request/Response types and polling reuses authenticated GET handlers in-process |

## Corrections to earlier design documents

- `creative_run_events` already provided durable monotonic SSE replay before this refactor. R7 reused and verified it rather than replacing it.
- Generation already owned provider attempts, leases, result persistence, assets, usage, and settlement. The refactor linked Agent ToolCalls to that runtime rather than duplicating those concepts.
- Before R3, `generation_tasks.payload` was the Agent task source. PostgreSQL now hydrates task execution from first-class rows, while the payload remains a compatibility projection.
- Worker image mismatch was previously a deployment risk rather than a verifiable runtime guarantee. The current build embeds the Git SHA and endpoints enforce build/schema/protocol compatibility.
- The prior internal HTTP dependency was real. It is now removed from Agent generation dispatch; direct Canvas text-node handling remains local by design.

## Remaining risks

- A deployment that starts the new worker before applying the additive schema will be rejected or fail readiness. Apply schema first.
- App and worker built from different commits will deliberately remain unhealthy until versions match.
- File-provider development mode cannot prove cross-process scheduling guarantees.
- The real PostgreSQL test proves the highest-risk task-claim and ToolCall races. Other crash boundaries are deterministic unit/integration tests rather than process-kill tests against PostgreSQL.
- The shared application layer retains Request/Response transport shapes; this is a maintainability limitation, not an execution dependency on HTTP.
- Pre-existing dependency advisories remain a separate release-management issue.

## Production deployment checklist

1. Back up PostgreSQL and apply the additive schema, including marker `20260916_agent_runtime_v2`.
2. Build one immutable image with `VOZEB_PRO_GIT_SHA` set to the deployment commit.
3. Deploy App and generation-worker from that same image digest.
4. Confirm readiness reports a compatible recent worker before enabling Agent traffic.
5. Run a canary Agent request with parallel branches and verify AgentTask, ToolCall, Generation, asset, and settlement linkage in Generation Operations.
6. Monitor `waiting_retry`, `waiting_external`, unknown ToolCalls, worker incompatibility, billing errors, and lease expiry rates.
7. Confirm SSE reconnect restores the canary Run after a browser refresh.

## Rollback

Roll back App and worker together to the same prior image. The new tables and migration marker are additive and should remain in place; do not drop them during an application rollback. A prior App ignores the tables, while mixing a prior worker with the new App is intentionally rejected by compatibility fencing. Any accepted or unknown provider work must remain in the database for reconciliation and must not be resubmitted during rollback.
