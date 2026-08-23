# Remove Plans and Introduce Prepaid PAYG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Use strict TDD for every behavior change.

**Goal:** Remove all subscription/entitlement-plan behavior and replace it with a prepaid credit wallet where 1 credit equals 1 USD of user-facing value, while separately tracking actual upstream cost for every routed provider attempt.

**Architecture:** A versioned pricing engine prices normalized usage from the logical model's sale-rate snapshot. Wallet holds reserve the proven maximum charge before upstream work, while immutable usage charges and provider attempts preserve sale, cost, FX, routing, recovery, and audit state. Existing payment infrastructure is retained but commercial products become fiat top-up presets plus custom top-up amounts.

**Tech Stack:** Next.js Route Handlers, TypeScript, PostgreSQL repositories, file-provider fallback, React, Ant Design, Zustand, Vitest, Playwright, `decimal.js`.

**Spec:** The approved plan in the Codex task dated 2026-08-23, including all follow-up invariants.

## Global Constraints

- Work only in `/Users/jake/Desktop/HotXProjects/VOZEB-PRO/.worktrees/remove-plans-payg` on branch `feat/remove-plans-payg`.
- `1 credit = 1 USD`; user charge comes only from normalized usage multiplied by the logical model sale-rate snapshot and never from provider cost.
- Reserve must be a proven request upper bound. If no safe maximum exists, reject before sending upstream.
- Snapshot all sale pricing, cost pricing, FX/conversion versions, normalized reserve inputs, currency exponents, credit amounts, and USD values server-side.
- Use `decimal.js`; credits are PostgreSQL `numeric(30,8)`, rate/cost/FX values are `numeric(30,12)`, numeric SQL parameters use explicit `::numeric`, and credits round only once at final settlement with `ROUND_HALF_UP`.
- `availableBalance = settledBalance - activeHolds`; holds never create point records. A non-zero settlement atomically closes one hold and creates exactly one point record; a zero settlement closes the hold without a zero-value point record.
- `totalUpstreamCostUsd` sums every provider attempt, including failed attempts. Margin is final user charge minus that total.
- TTL only makes an orphan hold eligible for reconciliation; unknown upstream state never auto-releases. Create retries reuse the snapshotted provider idempotency key and are forbidden when the provider does not support idempotency.
- V1 enables fiat VND only and full refunds only. Crypto structures are schema/type-ready but no crypto gateway or UI is enabled. Partial refunds and chargebacks go to manual review.
- Webhooks verify authenticity, provider/event identity, order, amount, currency, and terminal status before credits are granted.
- Do not add arbitrary retries, polling limits, timeouts, output limits, or resource caps. Use request values, administrator configuration, existing provider contracts, and verified model limits only.
- Preserve `{ code, data, msg }` for new/changed business APIs, Chinese page copy plus complete `zh-CN`, `en`, and `vi` translations, UTF-8, and existing project patterns.
- PostgreSQL integration tests that mutate schema, clean tables, or acquire locks run with `--no-file-parallelism`.

---

### Task 1: Decimal pricing, normalized usage, and authoritative domain contracts

**Files:**
- Create focused pricing/money modules under `web/src/lib/billing/` with colocated Vitest tests.
- Modify auth/model-routing contracts and normalizers to attach `saleRateCard` to logical models and `costRateCard` plus `ProviderCostUnit` to bindings.
- Modify `web/package.json` and `web/pnpm-lock.yaml` to add `decimal.js`.

**Interfaces:**
- Produce `PricingRateCardV1`, `PricingComponent`, `NormalizedUsage`, `UsageSource`, `ProviderCostUnit`, `FiatPaymentAmount`, `CryptoPaymentAmount`, and `PaymentAmount`.
- Produce pure functions to validate rate cards, normalize billable request/response usage, calculate a proven reserve, calculate final sale charge, convert native provider cost to USD, and sum attempt cost without intermediate rounding.
- Sale pricing uses credit-denominated component prices. Provider cost pricing uses a separate fiat or provider-native cost unit and a versioned conversion snapshot.

**Required TDD scenarios:**
- Text reserve uses measured input plus configured/request maximum output; missing output maximum rejects.
- Image/video/audio reserves use all price-affecting count, quality, resolution, duration, and format dimensions.
- Final charge selects actual, then derived, then reserve normalized usage; reserve fallback is marked `estimated`.
- Final charge is unchanged when provider cost changes and is capped at reserve on invariant violation.
- Fractional calculations retain precision through component sums and FX conversion, then round credits exactly once to 8 decimals with half-up semantics.
- Provider fiat and provider-native billing units cannot be confused or accepted without a conversion snapshot.

**Verification:** Run the new pricing/money test files and `pnpm run typecheck` before committing.

### Task 2: Wallet holds, usage charges, provider attempts, and reconciliation persistence

**Files:**
- Modify PostgreSQL schema, repository types/mappers/repositories, auth user projection, wallet service, backup/export, and the corresponding tests.
- Remove entitlement-plan, user-plan-assignment, daily-plan-wallet, plan ID, and free-daily-credit structures directly; no legacy migration/compatibility branch.

**Interfaces:**
- Produce repositories/services for `WalletHold`, `UsageCharge`, and `ProviderUsageAttempt` with stable business IDs and request fingerprints.
- Wallet snapshots expose `settledBalance`, `heldBalance`, and `availableBalance` only.
- Reserve atomically locks the user, validates available balance, and creates/reuses a hold.
- Settlement atomically closes the hold, updates settled balance, and creates exactly one non-zero consume point record; zero settlement creates no point record.
- Reconciliation returns ledger balance, settled balance, active holds, available balance, and explicit invariant issues.

**Required TDD scenarios:**
- Concurrent reservations cannot over-reserve; same identity/fingerprint is idempotent and changed fingerprint returns 409.
- Holds never appear in point records and closed holds no longer reduce available balance.
- Non-zero and zero settlements obey their distinct ledger rules.
- Settled balance equals the signed ledger sum from zero opening balance; available equals settled minus active holds.
- Every non-zero settled usage charge links to exactly one point record.
- Decimal PostgreSQL tests include non-integer values and run serially.

**Verification:** Run wallet/repository tests, serial PostgreSQL integration tests when the configured test database is available, and `pnpm run typecheck` before committing.

### Task 3: Runtime reserve, routing attempts, settlement, and orphan recovery

**Files:**
- Modify the system AI proxy, billing headers/contracts, and text/image/video/audio task runtimes and attempt stores.
- Add bounded recovery/reconciliation service and maintenance/admin route with focused tests.

**Interfaces:**
- Reserve before the first upstream create request using the logical model sale snapshot.
- Create one provider attempt per routed/failover binding and snapshot binding, cost pricing, native unit, conversion, provider idempotency identity, and upstream task identity.
- Stream adapters accumulate usage without buffering the complete response; async tasks settle only from persisted terminal state.
- Success settles actual, derived, or reserve-fallback usage. Provider/system failure voids the user charge while retaining attempt cost. User cancellation after accepted upstream work settles measurable usage or the reserve fallback.
- Recovery uses terminal task evidence or upstream query state; TTL alone never releases. Unknown accepted state becomes `needs_review`. A create retry is allowed only with provider idempotency support and the original key.

**Required TDD scenarios:**
- Failover records and sums successful and failed attempt costs while charging the user once from the logical sale snapshot.
- Admin pricing/FX edits during a running request do not change settlement.
- Response usage missing paths select the correct source marker and final charge.
- Unknown orphan holds remain active; confirmed failure releases; confirmed success settles; idempotent replay does not recreate upstream work.
- Zero-cost success remains auditable through usage charge without a point record.

**Verification:** Run proxy/runtime/recovery tests, existing generation task suites, and `pnpm run typecheck` before committing.

### Task 4: Fiat top-up commerce, verified grant, and full-refund recovery holds

**Files:**
- Replace billing product/order domain and schema with top-up presets, custom amount quoting, server-authoritative money/FX snapshots, and fiat/crypto-ready payment amount contracts.
- Modify checkout providers, webhook service, promotion/coupon/referral logic, refund orchestration/finalization, reconciliation, APIs, and tests.

**Interfaces:**
- Public/admin types are `TopUpPreset`, `TopUpQuote`, `TopUpOrder`, and `PaymentAmount`.
- V1 public checkout accepts a VND custom amount or preset ID; server computes currency exponent, nominal/payable amounts, credits, pricing/FX versions, and USD snapshots.
- Promotions/coupons reduce payment but credits follow nominal value. Fixed coupons require matching currency; referral qualification uses verified USD-equivalent value.
- Webhooks grant exactly once only after signature/event/order/amount/currency/status verification.
- Full refund first creates a recovery hold for the entire granted `creditAmount`. Insufficient available balance or partial refund/chargeback goes to manual review. Provider refund failure releases the recovery hold; success atomically recovers all granted credits and creates one reversal point record.

**Required TDD scenarios:**
- Custom VND and preset quotes, high-precision FX, promotion/coupon snapshots, duplicate/late/out-of-order webhook events, mismatch rejection, and idempotent credit grant.
- Fiat/crypto union validation and unique future crypto transaction identity without enabling crypto checkout.
- Full refund recovers the exact original credit amount; failed provider refund releases recovery hold without changing settled balance.
- Partial refunds and chargebacks cannot mutate the wallet automatically.
- Financial summaries group native currency and aggregate snapshotted USD values.

**Verification:** Run billing/payment/refund/reconciliation tests, serial PostgreSQL commerce tests, and `pnpm run typecheck` before committing.

### Task 5: User/admin UI, API cleanup, i18n, and documentation

**Files:**
- Replace billing plan components and profile/header projections with top-up and settled/held/available balance views.
- Replace admin plan/product/daily-credit controls with preset, customer FX, provider conversion, sale pricing, cost pricing, usage margin/anomaly, and recovery views.
- Update `zh-CN`, `en`, `vi`, help/legal copy, API/database/configuration docs, backup/export documentation, and affected E2E fixtures/screenshots.

**Interfaces and behavior:**
- Changed APIs return `{ code, data, msg }` and expose no server-computable credit, FX, exponent, USD, provider-cost, or margin fields as trusted inputs.
- User top-up supports custom VND and preset shortcuts, shows credits and quote, then retains existing secure checkout/SSE status behavior.
- User surfaces show settled, held, and available balances; provider cost/margin remains admin-only.
- Remove all user/admin plan, renewal, upgrade, entitlement, daily-credit, and plan-product UI and copy.

**Required TDD/E2E scenarios:**
- API contract tests reject forged server-authoritative financial fields.
- UI tests cover custom top-up, preset selection, balance projection, zero/non-zero usage audit, admin pricing/conversion/recovery, and complete translations.
- Playwright covers top-up through paid SSE and wallet ledger, desktop plus 390px and 430px, semantic clicks, light/dark readability, and no horizontal overflow.

**Final verification:** Run targeted suites, `pnpm run check:release`, all PostgreSQL integration tests with `--no-file-parallelism`, `pnpm run e2e`, docs `pnpm run types:check` and `pnpm run build`, strict UTF-8 decoding plus replacement-marker scan, and a source/reference audit for obsolete plan behavior.
