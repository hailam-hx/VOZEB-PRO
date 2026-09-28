# DFLOP Capability Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable, operation-scoped DFLOP capability probes for GPT-6, GPT-6 Astra, and Qwen Image 3.0 Pro without changing formal sale prices.

**Architecture:** A server-only probe service owns provider requests, response parsing, idempotency keys, and evidence classification. Probe evidence is stored inside the existing provider pricing profile metadata, then a pure reconciliation function derives operation status and executable cost components. An admin route and existing pricing drawer expose a manual “重新验证能力” action; ordinary sync preserves valid evidence and invalidates it when the channel, endpoint, binding, or registry revision changes.

**Tech Stack:** Next.js Route Handlers, TypeScript, Vitest, Ant Design, existing auth/settings repositories and safe outbound fetch.

**Spec:** `/Users/jake/.codex/attachments/d2b7a771-77e3-4c0b-97a0-778894db68ec/Pasted text.txt`

## Global Constraints

- Do not commit, push, create a PR, modify `saleRateCard`, or enable `autoApplySalePrice`.
- Real probes are serial, one submit intent per case, use deterministic idempotency keys, and never create user wallet holds.
- A successful request is not billing proof. Unsupported operations become `UNSUPPORTED`; unresolved routable operations remain `PARTIAL`.
- No model-name prefix rule may share GPT-6 and Astra results or infer Qwen tiers.

## Review Focus

- Provider returns HTTP 200 with an embedded error body: classify the error, never treat it as support.
- Registry or channel changes after a probe: invalidate evidence and return to PARTIAL.
- Qwen output dimensions without task cost/tier evidence: keep PARTIAL.
- Probe replay: reuse the same idempotency key and do not create a second billed task.
- UNSUPPORTED built-in image operation: keep raw `price_per_image`, exclude it from cost cards and public capabilities.

---

### Task 1: Probe evidence domain and operation status

**Files:**
- Create: `web/src/lib/billing/provider-capability-probe.ts`
- Create: `web/src/lib/billing/provider-capability-probe.test.ts`
- Modify: `web/src/lib/billing/provider-pricing.ts`
- Test: `web/src/lib/billing/provider-pricing.test.ts`

**Interfaces:**
- Produces: `CapabilityProbeResult`, `applyCapabilityProbeToPricingProfile(profile, probe)`, operation status `UNSUPPORTED`.

- [ ] Write failing tests for `tool_not_supported`, supported-but-unresolved, token-only, token-plus-image, independent model evidence, raw metadata retention, and invalidation fingerprints.
- [ ] Run the tests and confirm failures are caused by the missing domain API.
- [ ] Implement normalization, evidence application, profile status derivation, and cost-card exclusion for unsupported operations.
- [ ] Run the focused tests and confirm all pass.

### Task 2: Controlled DFLOP provider client

**Files:**
- Create: `web/src/lib/server/dflop-capability-probe-service.ts`
- Create: `web/src/lib/server/dflop-capability-probe-service.test.ts`
- Modify: `web/scripts/protocol-fixture-server.mjs`

**Interfaces:**
- Consumes: `CapabilityProbeResult` from Task 1.
- Produces: `probeDflopBinding({ modelId, channel, operationScope, ... })`.

- [ ] Write failing fixture tests for GPT Responses `tool_not_supported`, supported response usage/image output, Qwen accepted/rejected sizes, task-list cost evidence, missing cost evidence, and idempotency replay.
- [ ] Run the tests and confirm the provider client is absent.
- [ ] Implement serial requests through `fetchSafeOutbound`, sanitized evidence, response/header parsing, Qwen exact-size probe cases, and task-list reconciliation.
- [ ] Run the focused tests and confirm all pass.

### Task 3: Admin mutation API and persistence

**Files:**
- Create: `web/src/app/api/admin/billing/model-pricing/probe/route.ts`
- Create: `web/src/app/api/admin/billing/model-pricing/probe/route.test.ts`
- Modify: `web/src/lib/server/admin-model-pricing-service.ts`

**Interfaces:**
- Produces: `POST { modelId, bindingId, operationScope } -> { model, probe, actualCost }` using server-side channel credentials only.

- [ ] Write failing tests for admin authorization, server-side credential lookup, binding/provider validation, partial business success, atomic profile update, audit logging, and unchanged sale pricing.
- [ ] Run the tests and confirm failures match the missing route/service.
- [ ] Implement the route and atomic logical-model mutation while preserving `saleRateCard`, `suggestedSaleRateCard`, and `autoApplySalePrice`.
- [ ] Run the focused tests and confirm all pass.

### Task 4: Admin UI and capability exposure

**Files:**
- Modify: `web/src/services/api/admin-billing-commerce.ts`
- Modify: `web/src/app/admin/billing/components/billing-operations.tsx`
- Test: `web/src/app/admin/billing/components/billing-operations.test.ts`
- Test: `web/src/lib/server/agent-run-executor.test.ts`

**Interfaces:**
- Consumes: Task 3 probe API and Task 1 persisted evidence.

- [ ] Write failing tests for probe status, last verification, mapping source, raw-only price display, manual revalidation, and exclusion of unsupported built-in image generation from planner-visible operations.
- [ ] Run tests and confirm they fail for missing UI/exposure behavior.
- [ ] Add the compact probe section and API action; keep ordinary vision input unchanged.
- [ ] Run focused component and planner tests.

### Task 5: Controlled live probes, sync, and verification

**Files:**
- Modify only persisted settings through the authenticated admin probe API and normal DFLOP sync.

**Interfaces:**
- Consumes all earlier tasks and produces final DB/UI evidence.

- [ ] Run GPT-6 and GPT-6 Astra `/v1/responses` probes once each and record trace/error/usage evidence.
- [ ] Run the seven Qwen exact-size cases serially once each; poll/list tasks and record actual size and settled cost/tier evidence.
- [ ] Apply evidence, run normal DFLOP sync, and re-read the three profiles without changing formal sale prices.
- [ ] Run focused tests, full Vitest, typecheck, lint, production build, strict UTF-8 checks, and desktop/390px/430px browser regression.
