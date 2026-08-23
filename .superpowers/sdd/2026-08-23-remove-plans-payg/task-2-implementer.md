# Task 2 implementer report

## Status

DONE_WITH_CONCERNS. The Task 2 persistence contract is implemented for PostgreSQL and the file provider. Focused wallet, repository, schema-prefix, session-projection, and backup tests pass. The branch-wide typecheck and full suite remain red because later-task runtime/UI/payment consumers still compile against the removed plan/daily/permanent APIs. The full suite also encountered the repository's unrelated sandboxed live TCP fixture timeouts and was stopped after those failures continued for several minutes, as instructed not to retry unrelated live-provider failures indefinitely.

## Implementation

- Replaced the plan/daily/permanent wallet projection with exact decimal-string `settledBalance`, `heldBalance`, and `availableBalance` fields; new users start with settled balance zero.
- Added PostgreSQL `wallet_holds`, `usage_charges`, and `provider_usage_attempts` tables, constraints, indexes, trigger prefix registration, record types, mappers, and repository operations.
- Reworked `point_records` so it contains only non-zero settled-balance movements using `numeric(30,8)` and no hold/daily/permanent columns.
- Implemented atomic PostgreSQL user-row locking and file-provider serialized mutation for credits, reservation, release, non-zero/zero settlement, provider attempts, idempotent replay, business-identity conflicts, and bounded reconciliation reports.
- Used Task 1 exact decimal, pricing, and money contracts. Credit amounts are limited to 8 decimal places; native/USD cost snapshots use 12 decimal places. SQL placeholders participating in numeric values/expressions are explicitly cast.
- Removed entitlement-plan, user-plan-assignment, daily-plan-wallet, `users.plan_id`, free-daily settings, and plan projection persistence surfaces without legacy migration branches.
- Updated auth backup/export/merge/restore and PostgreSQL backup table locks for holds, charges, and attempts.
- Updated `docs/content/docs/backend/backend-database.mdx` (the repository's actual database documentation path; no `docs/backend-database.md` exists).

## TDD evidence

RED runs, before production implementation:

- Wallet focused test: 5 failures, all beginning with `reserveWalletCredits is not a function`.
- Provider-attempt case: 1 failure, `recordProviderUsageAttempt is not a function`.
- Balance-credit case: 1 failure, `creditWalletBalance is not a function`.
- Repository cases: 2 failures because `createHold` / `getReconciliationAggregate` were absent.
- Hold-release case: 1 failure, `releaseWalletHold is not a function`.
- Backup regression run after changing the backup contract: 2 failures (missing new backup mocks and obsolete query ordering); both were corrected.

GREEN evidence:

- `pnpm test --run src/lib/server/points-wallet-service.test.ts src/lib/server/database/points-wallet-repository.test.ts` -> 2 files passed, 10 tests passed.
- `pnpm test --run src/lib/server/points-wallet-service.test.ts src/lib/server/database/points-wallet-repository.test.ts src/lib/server/admin-backup-auth-restore.test.ts src/lib/server/admin-backup-merge.test.ts src/lib/server/admin-backup-store.test.ts src/lib/auth/store-repository.test.ts src/lib/auth/session.test.ts` -> 7 files passed, 31 tests passed.
- `pnpm test --run src/lib/server/database/postgres.test.ts` -> 1 file passed, 7 tests passed.
- `pnpm test --run src/lib/server/points-wallet-idempotency.postgres.test.ts --no-file-parallelism` -> 1 file skipped, 2 tests skipped because `VOZEB_PRO_RUN_POSTGRES_INTEGRATION` / a configured test database was unavailable.

All commands above used Node 22 through `PATH=/Users/jake/.nvm/versions/node/v22.23.2/bin:...`.

## Required broader gates

- `pnpm run typecheck` was run twice. Final result: exit 2, 224 diagnostic lines. The remaining diagnostics are later-task consumers of deliberately removed plan/daily/permanent projections and old wallet methods (admin/user UI and routes, auth orchestration, billing/refund/referral services, user export, and obsolete tests). A filtered rerun confirmed no diagnostic inside the new wallet service/repository, projection, schema, or backup implementation itself; matches were imports by old consumers.
- `pnpm test` was run once under Node 22. It exposed expected obsolete plan-wallet tests and unrelated live TCP/provider fixture timeouts. Examples: video live 3/3 failed, payment-provider live 2/2 failed, audio runtime 6/12 failed, image live 10/10 failed, protocol fixture server 12/12 failed, plus legacy plan-wallet/auth tests. The run was terminated with exit 130 after repeated fixture timeouts continued for several minutes. It was not retried.

## Files changed

- PostgreSQL schema/prefix/triggers and repositories under `web/src/lib/server/database/`.
- Wallet service and file/serial PostgreSQL tests under `web/src/lib/server/`.
- Auth types, normalization, file/PostgreSQL backup mapping, session/user projections under `web/src/lib/auth/`.
- Backup restore/merge/store implementation and regression tests.
- `docs/content/docs/backend/backend-database.mdx`.

## Self-review

- Confirmed reserve takes the PostgreSQL user row lock before reading active holds; file mutations use the existing serialized mutation queue.
- Confirmed holds never create point rows, closed holds are excluded, zero settlements create no ledger row, non-zero settlement/replay has a single charge and a single linked consume row, and PostgreSQL settlement accounts for other active holds in the returned snapshot.
- Confirmed reconciliation compares normalized exact decimals, sums the signed ledger from zero, subtracts only active holds, and validates charge/ledger linkage.
- Confirmed provider total cost sums every attempt regardless of status and preserves native unit/cost plus USD/rate snapshots.
- Confirmed changed persistence/projection files contain no entitlement, daily-plan, permanent/daily balance, or user plan assignment structures; remaining `plan_id`/`daily_points` fields are Task 4-owned billing product/order schema left intentionally untouched except removal of entitlement foreign keys.
- `git diff --check` passed.

## Concerns

- A real PostgreSQL DSN was unavailable, so the required concurrent test could only be collected and skipped; it must be run serially in the integration environment.
- Branch-wide typecheck/full-suite green depends on the explicitly later-owned Task 3/4/5 migrations of runtime orchestration, billing/refund/referral behavior, routes/UI, exports, and obsolete tests. Compatibility shims were intentionally not added because the brief prohibits plan/daily/permanent compatibility surfaces.
