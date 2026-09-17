# Planner Provider Health / Circuit Breaker Implementation Plan

## Goal

Add persistent, workload-scoped provider health to Agent Planner routing while preserving TextTask behavior and Agent lifecycle/billing contracts.

## Work sequence

1. Add failing core tests for `workloadScope`, scoped binding/channel keys, isolation, HALF_OPEN lease expiry/release, and stable ranking.
2. Extend provider-health types, keys, safe logs, records, and explicit acquired-route release.
3. Add failing store/schema tests for the new column, deterministic channel model, transactional re-keying, collision protection, and scoped upsert metadata.
4. Implement the PostgreSQL schema migration and update database documentation.
5. Add failing runtime tests for TextTask identity preservation and Planner helper behavior, then add scoped runtime helpers and events.
6. Add failing Agent executor tests for OPEN skip without attempt/billing/provider dispatch, provider failures, terminal success plus invalid plan, cancellation/business/internal errors, all-open recovery probe, and one observation per dispatch.
7. Integrate persistent ranking/acquire/observation into the Planner loop and remove process-local ranking from Agent Planner eligibility.
8. Add failing Generation Operations tests for separate Planner/TextTask status, then update the backend DTO and compact UI.
9. Run targeted provider-health, store, PostgreSQL, planner, Agent executor, logical-router, TextTask, billing, and stream-protocol tests.
10. Run typecheck, lint, format check, production build, release check, full Vitest with file parallelism disabled where required, docs checks, and relevant browser regression.
11. Perform the real P1/P2/P3 runtime verification without changing routing priority; collect run/attempt timing and scoped database evidence.

## Files expected to change

- `web/src/lib/server/provider-health.ts` and tests
- `web/src/lib/server/provider-health-store.ts` and tests
- `web/src/lib/server/provider-health-runtime.ts` and tests
- `web/src/lib/server/agent-run-executor.ts` and tests
- PostgreSQL schema/bootstrap and integration tests under `web/src/lib/server/database/`
- `web/src/lib/server/generation-operations-service.ts` and tests
- `web/src/lib/admin-generation-operations.ts`
- the existing Generation Operations channel-status component and tests
- `docs/backend-database.md`

No commit will be created unless explicitly requested.
