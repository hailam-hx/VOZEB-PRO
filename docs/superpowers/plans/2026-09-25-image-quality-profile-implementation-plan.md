# Image Quality Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement binding-level image quality profiles so every visible quality choice is resolved by the server into one binding-specific, executable, billable context before routing, task creation, wallet hold, or upstream submission.

**Architecture:** Add one shared profile domain module, one DFLOP profile derivation module, and one authoritative server resolver. Preserve the user's symbolic intent separately from each candidate binding's immutable resolved execution/pricing context; resolve every candidate before routing, sign the chosen context into the existing system AI billing request, and let the existing estimator, hold, settlement, refund, retry, and recovery flows consume that context. Continue storing logical models as JSON and retain `generationParameters.qualities` only as a legacy adapter for non-DFLOP bindings.

**Tech Stack:** Next.js App Router, React, TypeScript, Ant Design, Tailwind, Zustand, Decimal pricing helpers, Vitest, Testing Library, Playwright, existing auth settings repository and system AI billing signature.

**Spec:** `docs/superpowers/specs/2026-09-25-image-quality-profile-design.md`

## Global Constraints

- Use binding-level `ImageQualityProfile`; do not extend generic `qualities: string[]` as the DFLOP design.
- Any quality option that changes upstream execution or pricing must resolve completely into an executable and billable normalized context; otherwise reject before task creation.
- Qwen never guesses an exact size, Seedream never infers a pixel tier from generic quality, Midjourney never converts quality into size, and model variants are never merged automatically.
- Resolve quality for every candidate binding before routing; never reuse binding A's interpretation for binding B.
- Client values are intent only. The server rereads the current logical model, bindings, profile, pricing, and revisions.
- `targetBindingId` must resolve inside the same logical model and pass enabled, channel, category, capability, and pricing validation.
- Preserve `userPrompt`; send only the server-produced `effectivePrompt` upstream.
- Manual profiles survive provider sync but still undergo validation and can be blocked as invalid or needing review.
- Keep existing JSON persistence. Do not add a table or migration.
- Keep sale price approval, markup, provider cost conversion, settlement, refund, usage snapshot, retry/recovery boundaries, and DFLOP discovery semantics unchanged.
- No task in this plan includes commit, push, or pull request steps.
- Chinese source and documentation remain UTF-8.

## Review Focus

- A logical model whose eligible bindings expose different option effects must show a safe logical-model union while the server resolves each binding independently; Phase 3 tests the mixed-candidate case.
- An old browser submits a value after a profile revision change; Phase 2 and Phase 5 test semantic preservation, option removal, effect change, and typed errors.
- A fallback or recovered task must never carry the first binding's prompt flag, size, tier, or price into the next binding; Phase 3 and Phase 4 test immutable per-candidate snapshots.
- Seedream threshold metadata and the approved sale rate card can drift; Phase 2 and Phase 8 test that the profile is blocked until pricing validation succeeds.
- A client can forge quality, exact size, target binding, pricing tier, or signed context; Phase 5 tests that server re-resolution and signature verification reject the forged input before hold/upstream.

---

## 1. Scope

This plan covers the approved first production slice:

- Binding-level profile types, normalization, revisioning, validation, public projection, and DFLOP derivation.
- Binding-by-binding candidate resolution for Midjourney, Qwen Image 3 Pro, Seedream 5 Pro, and `none` profiles.
- Immutable task/attempt snapshots that distinguish user intent from candidate-specific execution and pricing.
- Existing image create, Agent run, estimator, system proxy hold, provider request builders, sync, admin UI, and `/create` integration.
- Compatibility for other providers that still use `generationParameters.qualities`.
- Unit, API, protocol fixture, billing, recovery, and responsive browser regression.

Out of scope: changing sale price approval, markup policy, provider cost conversion, settlement/refund formulas, model discovery, or collapsing separate Grok/GPT Image variants.

## 2. Existing Architecture Summary

- `resolveLogicalModelCandidates()` in `web/src/lib/server/logical-model-router.ts` returns ordered enabled/healthy binding candidates.
- `resolveImageGenerationCandidates()` in `web/src/lib/server/capability-constraints.ts` currently applies generic defaults and `generationParameters.qualities` after converting bindings into task configs.
- `createImageTaskApplication()` in `web/src/lib/server/image-task-application.ts` chooses the first compatible config and saves the rest in `candidateConfigs`.
- `createImageTaskUpstreamStep()` in `web/src/lib/server/image-task-runtime.ts` performs safe fallback across the saved configs.
- `refreshImageTaskCandidates()` in `web/src/lib/server/generation-task-recovery-service.ts` currently reuses `task.config` as request input; this must instead reuse task-level user intent and freshly resolve every candidate.
- Image provider builders in `web/src/app/api/image-tasks/` currently read `task.prompt`; they need a common accessor for the candidate's `effectivePrompt`.
- `creative-sale-estimator.ts` is the unified estimate engine. `usage-billing-adapter.ts` already derives exact megapixels and pricing tiers from the official rate card.
- The system proxy creates the authoritative hold after verifying the signed usage context. `system-ai-billing.ts` already signs video billing context and is the correct bounded extension point for image quality context.
- Logical models and bindings are JSON fields in settings repositories; the new profile is a backward-compatible JSON expansion.
- `/create` currently derives image quality from the generic `qualities` array and must instead consume a safe public logical-model profile.

## 3. Confirmed Invariants

1. Candidate order remains the router's current priority/health order after incompatible candidates are removed.
2. `ImageQualityIntent` is task-level user intent; `ResolvedImageQualityContext` is binding-specific and immutable for an attempt.
3. A safe fallback uses the already-saved context for that fallback candidate. A pre-submission recovery may reread settings and rebuild all candidate contexts from the original intent.
4. An accepted/polling upstream attempt is never reinterpreted after a profile change.
5. `profileRevision` hashes executable/pricing semantics, not presentation labels. `optionRevision` hashes one option's semantic effect.
6. A changed aggregate profile can preserve an explicit selection only when the same symbolic option still has the same semantic option revision; derived profiles require an exact current revision.
7. Midjourney explicit UI selection wins over manually typed `--sd`/`--hd`; normalization is exclusive and idempotent.
8. Qwen exact sizes come only from the verified allowlist or an explicit `sizeByAspectRatio` entry. A ratio alone is insufficient.
9. Seedream tier comes from exact dimensions and the current validated pricing threshold using Decimal arithmetic.
10. Midjourney request count and billable output count are separate; the authoritative binding metadata supplies the fixed output count of four.

## 4. File Impact Map

### New files: 6

| File | Responsibility |
| --- | --- |
| `web/src/lib/image-quality-profile.ts` | Shared domain types, parser, semantic revisions, public logical profile projection, prompt flag normalization, and pure helpers. |
| `web/src/lib/image-quality-profile.test.ts` | Domain parsing, revision, public projection, and Midjourney normalization tests. |
| `web/src/lib/dflop-image-quality-profile.ts` | Exact DFLOP structured/preset/description derivation and audited model contracts without fuzzy name matching. |
| `web/src/lib/dflop-image-quality-profile.test.ts` | Midjourney/Qwen/Seedream/none derivation, precedence, and no-hardcoded-name-guess tests. |
| `web/src/lib/server/image-quality-resolver.ts` | Authoritative per-binding resolution, validation, pricing match, revision race handling, and typed domain errors. |
| `web/src/lib/server/image-quality-resolver.test.ts` | Candidate, security, revision, Qwen, Seedream, model variant, and manual validation tests. |

### Existing files modified: 62

| Area | Files |
| --- | --- |
| Types and serialization | `web/src/lib/auth/store-types.ts`, `web/src/lib/auth/session.ts`, `web/src/lib/auth/session.test.ts`, `web/src/stores/use-config-store.ts`, `web/src/stores/use-config-store.test.ts`, `web/src/lib/creative-runtime-contract.ts`, `web/src/lib/creative-runtime-contract.test.ts` |
| DFLOP sync | `web/src/lib/dflop-model-metadata.ts`, `web/src/lib/dflop-model-metadata.test.ts`, `web/src/lib/model-routing-config.ts`, `web/src/lib/model-routing-config.test.ts`, `web/src/lib/auth/store-settings-capability-persistence.test.ts`, `web/src/app/api/admin/models/route.ts`, `web/src/app/api/admin/models/route.test.ts` |
| Candidate/task/recovery | `web/src/lib/server/capability-constraints.ts`, `web/src/lib/server/capability-constraints.test.ts`, `web/src/lib/server/image-task-store.ts`, `web/src/lib/server/image-task-application.ts`, `web/src/app/api/image-tasks/route.test.ts`, `web/src/lib/server/image-task-runtime.test.ts`, `web/src/lib/server/generation-task-recovery-service.ts`, `web/src/lib/server/generation-task-recovery-service.test.ts`, `web/src/lib/server/agent-run-store.ts`, `web/src/lib/server/agent-run-execution.ts`, `web/src/lib/server/agent-run-execution-direct.test.ts`, `web/src/lib/server/agent-run-executor.test.ts`, `web/src/app/api/agent/runs/route.ts`, `web/src/app/api/agent/runs/route.test.ts` |
| Provider mapping | `web/src/app/api/image-tasks/image-task-support.ts`, `web/src/app/api/image-tasks/image-task-support.test.ts`, `web/src/app/api/image-tasks/image-task-openai.ts`, `web/src/app/api/image-tasks/image-task-openai-live.test.ts`, `web/src/app/api/image-tasks/image-task-custom.ts`, `web/src/app/api/image-tasks/image-task-custom.test.ts`, `web/src/app/api/image-tasks/image-task-gemini.ts` |
| Pricing and hold | `web/src/lib/billing/creative-sale-estimator.ts`, `web/src/lib/billing/creative-sale-estimator.test.ts`, `web/src/lib/server/generation-usage-context.ts`, `web/src/lib/server/generation-usage-context.test.ts`, `web/src/lib/server/system-ai-billing.ts`, `web/src/lib/server/system-ai-billing.test.ts`, `web/src/lib/server/usage-billing-adapter.test.ts`, `web/src/app/api/ai/system/[channelId]/[...path]/route.ts`, `web/src/app/api/ai/system/[channelId]/[...path]/route.test.ts`, `web/src/lib/server/active-protocol-media-proxy-matrix.live.test.ts` |
| Client and `/create` | `web/src/services/api/creative.ts`, `web/src/services/api/image.ts`, `web/src/services/api/image.test.ts`, `web/src/hooks/use-creative-agent-options.ts`, `web/src/hooks/use-creative-agent-options.test.ts`, `web/src/components/creative-generation-preferences.tsx`, `web/src/components/creative-generation-preference-fields.test.tsx`, `web/src/app/(user)/create/components/creative-credit-estimate.ts`, `web/src/app/(user)/create/components/creative-credit-estimate.test.ts`, `web/src/app/(user)/create/components/creative-composer.tsx`, `web/src/app/(user)/create/components/creative-generation-preferences.test.ts` |
| Admin | `web/src/components/admin/admin-logical-model-manager.tsx`, `web/src/components/admin/admin-generation-settings.dom.test.tsx`, `web/src/app/api/admin/settings/route.ts`, `web/src/app/api/admin/settings/route.test.ts` |
| Browser/quality gates | `web/e2e/responsive.spec.ts`, `web/e2e/core.spec.ts` |

Estimated implementation footprint: **68 files total: 6 new and 62 modified**. The count includes all planned tests and excludes this plan document.

## 5. Domain and API Contracts

The exact shared interfaces established in Phase 1 are:

```ts
type ImageQualityControlType =
    | "request_parameter"
    | "model_variant"
    | "prompt_flag"
    | "resolution_tier"
    | "pixel_tier"
    | "none";
type ImageQualitySelectionMode = "explicit" | "derived" | "none";
type ImageQualityProfileSource = "manual" | "structured_upstream" | "provider_preset" | "description" | "none";
type ImageQualityValidationStatus = "VALID" | "DRIFT" | "NEEDS_REVIEW" | "INVALID";

type ImageQualityOptionEffect =
    | { type: "request_parameter"; requestParameter: { name: string; value: string | number | boolean } }
    | { type: "model_variant"; targetBindingId: string }
    | { type: "prompt_flag"; promptSuffix: "--sd" | "--hd"; mutexGroup: "midjourney-quality" }
    | { type: "resolution_tier"; resolutionTier: string; exactSizes: string[]; sizeByAspectRatio?: Record<string, string> }
    | { type: "pixel_tier"; pixelTier: string; minMegapixels?: string; maxMegapixels?: string }
    | { type: "none" };

type ImageQualityOption = {
    value: string;
    label: string;
    optionRevision: string;
    effect: ImageQualityOptionEffect;
};

type ImageQualityProfile = {
    version: 1;
    controlType: ImageQualityControlType;
    selectionMode: ImageQualitySelectionMode;
    source: ImageQualityProfileSource;
    options: ImageQualityOption[];
    defaultValue?: string;
    profileRevision: string;
    validation: {
        status: ImageQualityValidationStatus;
        reasons: Array<{ code: string; message: string; severity: "warning" | "blocking" }>;
        validatedAt: string;
    };
    upstreamCandidate?: Omit<ImageQualityProfile, "upstreamCandidate">;
};

type ImageQualityIntent = {
    value?: string;
    logicalProfileRevision?: string;
    optionRevision?: string;
    requestedSize?: string;
    requestedAspectRatio?: string;
};

type ResolvedImageQualityContext = {
    version: 1;
    logicalModelId: string;
    bindingId: string;
    qualityProfileRevision: string;
    selectedQualityValue?: string;
    optionRevision?: string;
    controlType: ImageQualityControlType;
    selectionMode: ImageQualitySelectionMode;
    resolvedSize?: string;
    resolvedWidth?: number;
    resolvedHeight?: number;
    resolvedResolutionTier?: string;
    resolvedPixelTier?: string;
    resolvedPromptSuffix?: string;
    effectivePrompt: string;
    requestParameters?: Record<string, string | number | boolean>;
    requestCount: number;
    billableOutputCount: number;
    pricingConditions: Record<string, string>;
    saleRateCardRevision?: string;
};
```

Public session data uses `PublicLogicalImageQualityProfile`, an aggregate of eligible binding profiles. It exposes labels, supported exact sizes/ratio mappings, derived boundaries, aggregate revision, and option revisions, but never exposes `targetBindingId`, channel IDs, upstream model IDs, provider prices, or profile drift internals.

Client create requests extend the existing image preference shape with `qualityProfileRevision` and `qualityOptionRevision`; they do not accept effects, target bindings, tiers, or amounts.

Typed failures reuse current response styles:

```ts
type ImageQualityErrorCode =
    | "QUALITY_PROFILE_CHANGED"
    | "QUALITY_OPTION_UNAVAILABLE"
    | "QUALITY_CONTEXT_UNRESOLVABLE"
    | "QUALITY_TARGET_BINDING_INVALID"
    | "QUALITY_PRICING_UNAVAILABLE";
```

Direct image API responses add `errorCode` and `currentProfileRevision` beside the existing `error`. Agent run responses retain `{ code, data, msg }` and add those fields in `data` for `CreativeRuntimeInputError` instances carrying a quality error code.

## 6. Server Resolver Flow

```text
request value + profile/option revision + raw size/ratio + userPrompt
                              ↓
re-read settings and build eligible logical-model candidate bindings
                              ↓
derive current safe aggregate public profile and check revision race
                              ↓
for each candidate binding:
  validate binding profile and official sale pricing
  resolve symbolic selection for that binding
  validate targetBindingId if model_variant
  resolve exact size / prompt flag / request parameter
  derive pricing tier and authoritative billable output count
  return binding-specific ResolvedImageQualityContext
                              ↓
drop only candidates with typed business incompatibility
                              ↓
if none remain: typed 400; create no task and no hold
                              ↓
preserve router order; save first config + remaining candidateConfigs
```

The resolver must be pure with explicit inputs. It may use existing Decimal/pricing validators, but it may not read global settings itself; callers provide the current logical model, binding, channel, rate card, user intent, and prompt.

## 7. Routing, Retry, and Recovery Integration

- Insert resolution after `resolveLogicalModelCandidates()` and before `toSystemGenerationChannel()`/final candidate selection in `image-task-application.ts`.
- Refactor only the image branch of `resolveImageGenerationCandidates()` so each input retains `ResolvedLogicalModel` identity until quality resolution completes.
- Save the raw `ImageQualityIntent` once on the task. Save one distinct `ResolvedImageQualityContext` in every candidate config.
- `image-task-runtime.ts` continues iterating saved configs. It does not copy or transform quality context between candidates.
- `refreshImageTaskCandidates()` uses the saved intent and public prompt to resolve fresh candidates only while no upstream attempt has been accepted. It never feeds `task.config.size`, `quality`, prompt suffix, or tier back as user intent.
- Retrying the same failed task preserves existing business identity/idempotency semantics. A new upstream attempt uses either its saved candidate context or a full pre-submission refresh from the original intent; it never partially recomputes a context.

## 8. Pricing, Estimate, and Hold Integration

- `creative-sale-estimator.ts` remains the single estimator. Add an input path for `ResolvedImageQualityContext` and map `resolvedSize`, resolution/pixel tier, quality value, and `billableOutputCount` into its existing `CreativeSaleRequestContext`.
- Seedream's threshold is read from the validated `megapixelThreshold` pricing component in the current official `saleRateCard`. `ImageQualityProfile` may carry a synchronized display boundary, but validation blocks it when it differs from the rate card.
- Use the project's Decimal helper for width × height ÷ 1,000,000 and boundary comparison; do not use JS floating point for a financial tier decision.
- Midjourney reads `imagesPerRequest` from normalized binding metadata and sets `requestCount=1`, `billableOutputCount=4`. The provider request does not send `n=4` unless the provider contract explicitly requires it.
- Extend the signed `SystemAiUsageContext` with a compact `imageQualityContext` containing binding/profile/option/sale revisions, exact size, tier, and billable count. Include it in the existing HMAC payload.
- The proxy recomputes `requestUsage` from the real payload using `normalizeProxyBillableRequest()` and compares it to the signed context. A mismatch rejects before `reserveUsageBilling()`.
- The hold snapshot keeps its existing `saleRateSnapshot` and `requestUsage`; add the normalized image context as optional audit data. Settlement/refund consume the same snapshot and need no formula changes.

## 9. Data Compatibility and Migration

- `LogicalModelBinding.imageQualityProfile?: ImageQualityProfile` is stored in the existing logical models JSON. Repository and PostgreSQL settings code already round-trip unknown nested JSON after typed normalization, so no table or database migration is required.
- Normalizers must omit malformed profiles rather than partially accepting them; DFLOP sync then regenerates a valid profile or `none` profile.
- Existing saved tasks without `imageQualityIntent`/`imageQualityContext` continue through the current legacy path. New DFLOP tasks always require the new context.
- `generationParameters.qualities` remains in `LogicalModelGenerationParameters`, public serialization, and legacy capability functions for non-DFLOP providers.
- New DFLOP sync never writes generic qualities. When a non-DFLOP binding uses the legacy adapter, emit one structured debug event with provider/binding and no secret data.
- Deletion of `qualities` is a separate future project after every other provider is audited.

## 10. DFLOP Profile Derivation Rules

Evidence precedence is `manual > structured_upstream > provider_preset > description > none`.

- Midjourney V7/V8.1: exact provider preset IDs produce explicit `standard` and `high` options with `--sd` and `--hd`; size remains independent.
- Qwen Image 3 Pro: exact preset produces explicit 1K/2K options with only these allowlists:
  - 1K: `512x512`, `1024x1024`, `1024x1536`, `1536x1024`
  - 2K: `1536x1536`, `2048x2048`, `2560x2560`
  - `sizeByAspectRatio` is empty until official structured metadata provides a verified exact mapping. A ratio-only 16:9 choice therefore disables both tiers with an explanation and the server rejects a forged request.
- Seedream 5 Pro: derived pixel tier profile; no clickable tier. The synchronized boundary is copied from normalized pricing for display and must validate against the current sale rate card at runtime.
- Grok quality variants, GPT Image Flare/Sunburst, and other distinct logical models receive `selectionMode=none`; no automatic merge and no low/medium/high alias conversion.
- A public registry miss preserves the current effective profile and marks evidence drift. It does not infer a new profile from model name substrings.

## 11. Admin Behavior

The existing binding editor gains one compact “图片画质控制” section with supported state, selection mode, control type, source, options/effects, default, revision, validation status, evidence, and drift reasons. Manual editing saves `source=manual`, calculates revisions server-side, and never accepts a client-supplied trusted revision. Removing the manual override reactivates the latest validated upstream candidate. Blocking reasons disable runtime eligibility but do not delete manual data.

## 12. `/create` Behavior

- No profile or `none`: hide quality.
- Explicit profile with fewer than two currently executable options: hide quality.
- Explicit profile with two or more executable options: show actual labels; select the real default directly, with no synthetic “智能”.
- Derived profile: show no clickable tier. The estimate tooltip may show the derived tier after exact size is known.
- Qwen options with no authoritative mapping for the current size/ratio remain visible but disabled so the existing tooltip pattern can explain “当前比例没有上游确认的精确尺寸”; forged submission is still rejected server-side.
- On model change, recompute the aggregate profile, clear an invalid value and any prompt effect, then refresh estimate.
- On profile refresh, preserve only a value whose semantic option revision remains valid. Otherwise clear it, show the Chinese typed-error message, and require resubmission.

## 13. Phase 1 — Domain Schema + Type

**Files:**
- Create: `web/src/lib/image-quality-profile.ts`
- Create: `web/src/lib/image-quality-profile.test.ts`
- Modify: `web/src/lib/auth/store-types.ts`
- Modify: `web/src/lib/auth/session.ts`
- Modify: `web/src/lib/auth/session.test.ts`
- Modify: `web/src/stores/use-config-store.ts`
- Modify: `web/src/stores/use-config-store.test.ts`
- Modify: `web/src/lib/creative-runtime-contract.ts`
- Modify: `web/src/lib/creative-runtime-contract.test.ts`

**Interfaces:**
- Produces: the contracts in Section 5 plus `normalizeImageQualityProfile()`, `imageQualityProfileRevision()`, `imageQualityOptionRevision()`, `publicLogicalImageQualityProfile()`, and `normalizeMidjourneyQualityFlag()`.
- Consumes: existing logical model/binding types, pricing rate card types, and stable hash conventions.

- [ ] **Step 1: Write failing domain tests.** Add named cases for valid prompt flag, explicit resolution tier, derived pixel tier, none, malformed rejection, label-only stable revision, semantic revision change, hidden internal target binding, and the full Midjourney flag matrix.

```ts
expect(normalizeMidjourneyQualityFlag("a cat --sd", "--hd")).toBe("a cat --hd");
expect(normalizeMidjourneyQualityFlag("a cat --hd --hd", "--hd")).toBe("a cat --hd");
expect(normalizeMidjourneyQualityFlag("the text --sdf file", "--sd")).toBe("the text --sdf file --sd");
```

- [ ] **Step 2: Run the domain tests and verify they fail because the new module/types do not exist.**

Run: `cd web && pnpm vitest run src/lib/image-quality-profile.test.ts src/lib/auth/session.test.ts src/stores/use-config-store.test.ts src/lib/creative-runtime-contract.test.ts`

- [ ] **Step 3: Implement the discriminated unions, strict parser, revisions, public projection, and prompt normalizer.** Use a canonical JSON hash that excludes labels/evidence timestamps and includes selection mode, control type, option value, and the full effect.
- [ ] **Step 4: Add `imageQualityProfile` to binding metadata and add intent revisions to the existing image preference contract.** Keep `qualities` with a deprecation comment that names the non-DFLOP compatibility use.
- [ ] **Step 5: Serialize only the safe aggregate public profile and update Zustand public types.** Assert that `targetBindingId`, provider prices, channel IDs, and drift internals are absent.
- [ ] **Step 6: Run Phase 1 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/image-quality-profile.test.ts src/lib/auth/session.test.ts src/stores/use-config-store.test.ts src/lib/creative-runtime-contract.test.ts && pnpm typecheck`

## 14. Phase 2 — QualityProfile Resolver

**Files:**
- Create: `web/src/lib/server/image-quality-resolver.ts`
- Create: `web/src/lib/server/image-quality-resolver.test.ts`
- Modify: `web/src/lib/billing/creative-sale-estimator.ts`
- Modify: `web/src/lib/billing/creative-sale-estimator.test.ts`

**Interfaces:**
- Consumes: Phase 1 types and existing `validatePricingRateCard()`/Decimal helpers.
- Produces: `resolveImageQualityForBinding(input): ResolvedImageQualityContext`, `validateImageQualityProfileForBinding(input)`, `ImageQualityResolutionError`, and `imageQualityEstimateRequest(context)`.

- [ ] **Step 1: Write failing resolver tests for explicit, derived, none, malformed, revision, and security behavior.** Include `QUALITY_PROFILE_CHANGED` for derived revision changes, `QUALITY_OPTION_UNAVAILABLE` for removed options, preservation for identical option revision, and rejection of client tier/effect fields.
- [ ] **Step 2: Write failing Qwen tests.** Assert accepted allowlist sizes, missing ratio mapping rejection, no `2048x1152`/`2560x1440` synthesis, tier-size mismatch rejection, and forged size rejection.
- [ ] **Step 3: Write failing Seedream tests.** Use the rate-card threshold as a decimal string and test below, exactly at, and above the boundary; no exact size; ignored client pixel tier; profile/rate-card threshold drift.
- [ ] **Step 4: Run the resolver tests and verify the new imports/functions fail.**

Run: `cd web && pnpm vitest run src/lib/server/image-quality-resolver.test.ts src/lib/billing/creative-sale-estimator.test.ts`

- [ ] **Step 5: Implement strict profile validation and authoritative resolution.** Blocking validation includes missing sale dimension, invalid/disabled binding, unsupported exact size, stale model variant target, and threshold mismatch. Warning-only drift may execute only when execution and pricing remain complete.
- [ ] **Step 6: Implement revision race rules.** Compare the current aggregate revision first; explicit selections may survive only with the same current option revision, while derived selections require the current aggregate/profile revision.
- [ ] **Step 7: Implement Qwen and Seedream resolution using exact sizes and Decimal.** Do not add model-name branches to the resolver; behavior comes solely from profile control/effect.
- [ ] **Step 8: Extend the existing estimator input path to consume the resolved context.** Preserve all non-image estimator branches.
- [ ] **Step 9: Run Phase 2 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/server/image-quality-resolver.test.ts src/lib/billing/creative-sale-estimator.test.ts && pnpm typecheck`

## 15. Phase 3 — Candidate Binding Quality Resolution

**Files:**
- Modify: `web/src/lib/server/capability-constraints.ts`
- Modify: `web/src/lib/server/capability-constraints.test.ts`
- Modify: `web/src/lib/server/image-task-application.ts`
- Modify: `web/src/app/api/image-tasks/route.test.ts`

**Interfaces:**
- Consumes: `ResolvedLogicalModel[]`, `ImageQualityIntent`, and `resolveImageQualityForBinding()`.
- Produces: ordered `ResolvedImageCandidate[]` where every candidate contains its own task config and resolved quality context.

- [ ] **Step 1: Add failing tests for candidate A success, candidate B unsupported, only complete candidates retained, all candidates rejected, and a model variant target crossing logical models.**
- [ ] **Step 2: Add an API test proving all candidates rejected means no task write, no hold, and no upstream call.**
- [ ] **Step 3: Run the focused tests and confirm current post-conversion quality handling fails the binding-specific assertions.**

Run: `cd web && pnpm vitest run src/lib/server/capability-constraints.test.ts src/app/api/image-tasks/route.test.ts`

- [ ] **Step 4: Change the image-only candidate path to keep `ResolvedLogicalModel` identity until after quality resolution.** Leave audio/video generic resolution unchanged.
- [ ] **Step 5: Preserve router order after filtering and map each successful result through the existing system generation channel conversion.** For `model_variant`, replace the candidate only with the validated same-logical-model target binding.
- [ ] **Step 6: Map typed resolver failures into the current direct image API error response with `errorCode` and `currentProfileRevision`.**
- [ ] **Step 7: Run Phase 3 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/server/capability-constraints.test.ts src/app/api/image-tasks/route.test.ts && pnpm typecheck`

## 16. Phase 4 — Normalized Execution Context

**Files:**
- Modify: `web/src/lib/server/image-task-store.ts`
- Modify: `web/src/lib/server/image-task-runtime.test.ts`
- Modify: `web/src/lib/server/generation-task-recovery-service.ts`
- Modify: `web/src/lib/server/generation-task-recovery-service.test.ts`
- Modify: `web/src/lib/server/agent-run-store.ts`

**Interfaces:**
- Consumes: Phase 3 resolved candidates.
- Produces: `ImageTask.imageQualityIntent`, `ImageTaskConfig.imageQualityContext`, and `imageTaskEffectivePrompt(task)`.

- [ ] **Step 1: Write failing snapshot tests.** Assert one task-level raw intent, different A/B candidate contexts, unchanged `userPrompt`, and an effective prompt only inside the selected candidate config.
- [ ] **Step 2: Write failing fallback/recovery tests.** Safe fallback A→B must use B's context. Pre-submission recovery must reconstruct candidates from intent. Accepted/polling attempts must keep the stored context.
- [ ] **Step 3: Run the task/recovery tests and verify current reuse of `task.config` exposes the failure.**

Run: `cd web && pnpm vitest run src/lib/server/image-task-runtime.test.ts src/lib/server/generation-task-recovery-service.test.ts`

- [ ] **Step 4: Extend JSON task types with optional intent/context fields and one effective prompt accessor.** Keep fields optional for old saved tasks.
- [ ] **Step 5: Update recovery to pass raw intent and public prompt through the authoritative resolver.** Never seed the request with a prior candidate's resolved size, tier, suffix, or target binding.
- [ ] **Step 6: Persist image preference revisions in Agent run task selection so retries can reproduce the original intent.**
- [ ] **Step 7: Run Phase 4 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/server/image-task-runtime.test.ts src/lib/server/generation-task-recovery-service.test.ts src/lib/server/agent-run-store.test.ts && pnpm typecheck`

## 17. Phase 5 — Server Create, Validation, and Hold

**Files:**
- Modify: `web/src/lib/server/generation-usage-context.ts`
- Modify: `web/src/lib/server/generation-usage-context.test.ts`
- Modify: `web/src/lib/server/system-ai-billing.ts`
- Modify: `web/src/lib/server/system-ai-billing.test.ts`
- Modify: `web/src/app/api/ai/system/[channelId]/[...path]/route.ts`
- Modify: `web/src/app/api/ai/system/[channelId]/[...path]/route.test.ts`
- Modify: `web/src/lib/server/usage-billing-adapter.test.ts`
- Modify: `web/src/lib/server/agent-run-execution.ts`
- Modify: `web/src/lib/server/agent-run-execution-direct.test.ts`
- Modify: `web/src/lib/server/agent-run-executor.test.ts`
- Modify: `web/src/app/api/agent/runs/route.ts`
- Modify: `web/src/app/api/agent/runs/route.test.ts`

**Interfaces:**
- Consumes: trusted resolved context and existing rate-card snapshot.
- Produces: signed `SystemAiImageQualityContext`, hold snapshot audit context, and typed Agent run errors.

- [ ] **Step 1: Add failing signature tests.** Mutation of binding, profile revision, exact size, pixel/resolution tier, billable count, or sale rate revision must invalidate the HMAC.
- [ ] **Step 2: Add failing proxy tests for forged quality, target binding, size, pricing tier, stale revision, and Midjourney billable count.** Assert `reserveUsageBilling` is not called for mismatch.
- [ ] **Step 3: Add Agent run API tests for current revision success and stale/removed/changed option errors in the existing `{code,data,msg}` envelope.**
- [ ] **Step 4: Run the tests and verify they fail before adding the image context.**

Run: `cd web && pnpm vitest run src/lib/server/generation-usage-context.test.ts src/lib/server/system-ai-billing.test.ts 'src/app/api/ai/system/[channelId]/[...path]/route.test.ts' src/app/api/agent/runs/route.test.ts src/lib/server/usage-billing-adapter.test.ts`

- [ ] **Step 5: Add the compact image context to signed usage headers and the existing hold snapshot type.** Include it in normalization, signature input, parse, and equality checks.
- [ ] **Step 6: Recompute actual request usage in the proxy and compare it with the signed normalized context before hold.** Use current `saleRateCard`; never trust the client estimate.
- [ ] **Step 7: Resolve manually selected image models before Agent run creation.** Smart planning uses the latest server profile; it never accepts a client-selected binding/effect.
- [ ] **Step 8: Extend `CreativeRuntimeInputError` with optional quality error metadata and preserve current behavior for every other error.**
- [ ] **Step 9: Run Phase 5 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/server/generation-usage-context.test.ts src/lib/server/system-ai-billing.test.ts 'src/app/api/ai/system/[channelId]/[...path]/route.test.ts' src/app/api/agent/runs/route.test.ts src/lib/server/agent-run-execution-direct.test.ts src/lib/server/agent-run-executor.test.ts src/lib/server/usage-billing-adapter.test.ts && pnpm typecheck`

## 18. Phase 6 — Provider Adapter Mapping

**Files:**
- Modify: `web/src/app/api/image-tasks/image-task-support.ts`
- Modify: `web/src/app/api/image-tasks/image-task-support.test.ts`
- Modify: `web/src/app/api/image-tasks/image-task-openai.ts`
- Modify: `web/src/app/api/image-tasks/image-task-openai-live.test.ts`
- Modify: `web/src/app/api/image-tasks/image-task-custom.ts`
- Modify: `web/src/app/api/image-tasks/image-task-custom.test.ts`
- Modify: `web/src/app/api/image-tasks/image-task-gemini.ts`

**Interfaces:**
- Consumes: `ImageTaskConfig.imageQualityContext` and `imageTaskEffectivePrompt()`.
- Produces: exact upstream body/multipart fields without changing public prompt or generic legacy behavior.

- [ ] **Step 1: Add failing request-builder tests for request parameter, exact Qwen size, Midjourney effective prompt, and no automatic size mutation.**
- [ ] **Step 2: Add the full Midjourney matrix:** standard→only `--sd`, high→only `--hd`, typed `--sd` + high→only `--hd`, typed `--hd` + standard→only `--sd`, duplicates collapse, other flags/text remain, and repeated normalization is identical.
- [ ] **Step 3: Add a live fixture assertion that a multi-image Midjourney response still saves every result while the request/hold uses the fixed four-output contract.**
- [ ] **Step 4: Run provider tests and verify builders still read `task.prompt`/generic quality.**

Run: `cd web && pnpm vitest run src/app/api/image-tasks/image-task-support.test.ts src/app/api/image-tasks/image-task-custom.test.ts src/app/api/image-tasks/image-task-openai-live.test.ts`

- [ ] **Step 5: Update all body and multipart builders to read normalized request parameters, exact size, and effective prompt from the selected candidate context.** Legacy tasks without context continue through current paths.
- [ ] **Step 6: Keep `task.prompt` for titles, public messages, logs, and retry identity.** Never persist the suffix into the public prompt.
- [ ] **Step 7: Run Phase 6 tests and protocol fixture tests.**

Run: `cd web && pnpm vitest run src/app/api/image-tasks/image-task-support.test.ts src/app/api/image-tasks/image-task-custom.test.ts src/app/api/image-tasks/image-task-openai-live.test.ts src/lib/server/active-protocol-media-proxy-matrix.live.test.ts`

## 19. Phase 7 — Unified Estimator Integration

**Files:**
- Modify: `web/src/app/(user)/create/components/creative-credit-estimate.ts`
- Modify: `web/src/app/(user)/create/components/creative-credit-estimate.test.ts`
- Modify: `web/src/lib/billing/creative-sale-estimator.ts`
- Modify: `web/src/lib/billing/creative-sale-estimator.test.ts`

**Interfaces:**
- Consumes: safe public profile preview and the same normalized pricing dimensions as the server resolver.
- Produces: client-only preview status and estimate; no trusted amount.

- [ ] **Step 1: Add failing estimate tests for Qwen 1K/2K exact sizes, Seedream normal/large/boundary, Midjourney fixed four outputs, unavailable mapping, and estimate refresh after quality changes.**
- [ ] **Step 2: Assert estimate and hold fixture inputs contain the same normalized tier, exact size, billable count, and sale revision.**
- [ ] **Step 3: Run estimate tests and confirm the existing raw `preferences.image.quality` path fails.**

Run: `cd web && pnpm vitest run src/lib/billing/creative-sale-estimator.test.ts 'src/app/(user)/create/components/creative-credit-estimate.test.ts'`

- [ ] **Step 4: Route preview through shared public profile helpers and the existing estimator.** If preview cannot fully resolve, return the existing unpriced state with a specific reason rather than guessing.
- [ ] **Step 5: Keep the server resolver authoritative and label the browser result as an estimate.** Do not send the calculated rate/amount back as trusted input.
- [ ] **Step 6: Run Phase 7 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/billing/creative-sale-estimator.test.ts 'src/app/(user)/create/components/creative-credit-estimate.test.ts' && pnpm typecheck`

## 20. Phase 8 — DFLOP Sync, Manual Override, and Drift Validation

**Files:**
- Create: `web/src/lib/dflop-image-quality-profile.ts`
- Create: `web/src/lib/dflop-image-quality-profile.test.ts`
- Modify: `web/src/lib/dflop-model-metadata.ts`
- Modify: `web/src/lib/dflop-model-metadata.test.ts`
- Modify: `web/src/lib/model-routing-config.ts`
- Modify: `web/src/lib/model-routing-config.test.ts`
- Modify: `web/src/lib/auth/store-settings-capability-persistence.test.ts`
- Modify: `web/src/app/api/admin/models/route.ts`
- Modify: `web/src/app/api/admin/models/route.test.ts`

**Interfaces:**
- Consumes: public registry structured metadata, normalized provider pricing, current binding, and current manual profile.
- Produces: effective profile, upstream candidate, validation status/reasons, revision, evidence, and sync counts.

- [ ] **Step 1: Add failing derivation tests for exact Midjourney/Qwen/Seedream contracts, all none variants, precedence, duplicated IDs, missing registry metadata, and a model name containing `qwen`/`seedream` that must not trigger a profile.**
- [ ] **Step 2: Add failing sync tests proving manual survives, upstream candidate updates, drift is recorded, invalid manual is blocked at runtime, and DFLOP `generationParameters.qualities` remains empty.**
- [ ] **Step 3: Add failing persistence tests for JSON round trip and reload of profile revisions/effects/validation.**
- [ ] **Step 4: Run sync tests and verify no profile is currently produced.**

Run: `cd web && pnpm vitest run src/lib/dflop-image-quality-profile.test.ts src/lib/dflop-model-metadata.test.ts src/lib/model-routing-config.test.ts src/lib/auth/store-settings-capability-persistence.test.ts src/app/api/admin/models/route.test.ts`

- [ ] **Step 5: Implement exact provider presets and structured evidence parsing.** Keep all model-specific contracts in this DFLOP module; the generic resolver remains model-agnostic.
- [ ] **Step 6: Integrate precedence and manual preservation into `resynchronizeDflopBindingFromUpstream()`.** Run validation after every sync and keep the manual profile data even when status is blocking.
- [ ] **Step 7: Add non-hardcoded profile sync statistics to the existing model pull response and debug log.** Do not change `/v1/models` + public registry allowed-model merge semantics.
- [ ] **Step 8: Run Phase 8 tests and typecheck.**

Run: `cd web && pnpm vitest run src/lib/dflop-image-quality-profile.test.ts src/lib/dflop-model-metadata.test.ts src/lib/model-routing-config.test.ts src/lib/auth/store-settings-capability-persistence.test.ts src/app/api/admin/models/route.test.ts && pnpm typecheck`

## 21. Phase 9 — Admin UI

**Files:**
- Modify: `web/src/components/admin/admin-logical-model-manager.tsx`
- Modify: `web/src/components/admin/admin-generation-settings.dom.test.tsx`
- Modify: `web/src/app/api/admin/settings/route.ts`
- Modify: `web/src/app/api/admin/settings/route.test.ts`

**Interfaces:**
- Consumes: Phase 1 parser/revision and Phase 2 validator.
- Produces: server-normalized manual profile updates and admin-visible drift/status.

- [ ] **Step 1: Add failing route tests for a valid manual profile, malformed effect, cross-model target binding, unsupported exact size, missing pricing dimension, and server-generated revisions.**
- [ ] **Step 2: Add failing DOM tests for Supported, Selection Mode, Control Type, Source, Options, Effect, Revision, Validation, drift reason, manual save, and removing manual override.**
- [ ] **Step 3: Run admin tests and verify the section is absent.**

Run: `cd web && pnpm vitest run src/app/api/admin/settings/route.test.ts src/components/admin/admin-generation-settings.dom.test.tsx`

- [ ] **Step 4: Validate and normalize profile updates in the existing settings route before persistence.** The client submits editable fields; the server computes revisions and validation.
- [ ] **Step 5: Add the compact binding-level editor to the existing logical model manager.** Reuse existing manual/upstream drift presentation and responsive Drawer conventions.
- [ ] **Step 6: Run Phase 9 tests, typecheck, and lint the changed files.**

Run: `cd web && pnpm vitest run src/app/api/admin/settings/route.test.ts src/components/admin/admin-generation-settings.dom.test.tsx && pnpm typecheck && pnpm lint`

## 22. Phase 10 — `/create` Dynamic Quality UI

**Files:**
- Modify: `web/src/services/api/creative.ts`
- Modify: `web/src/services/api/image.ts`
- Modify: `web/src/services/api/image.test.ts`
- Modify: `web/src/hooks/use-creative-agent-options.ts`
- Modify: `web/src/hooks/use-creative-agent-options.test.ts`
- Modify: `web/src/components/creative-generation-preferences.tsx`
- Modify: `web/src/components/creative-generation-preference-fields.test.tsx`
- Modify: `web/src/app/(user)/create/components/creative-composer.tsx`
- Modify: `web/src/app/(user)/create/components/creative-generation-preferences.test.ts`

**Interfaces:**
- Consumes: `PublicLogicalImageQualityProfile`, typed API failures, and public session force refresh.
- Produces: dynamic controls and request intent containing only value/revisions.

- [ ] **Step 1: Add failing hook/component tests for none hidden, explicit one option hidden, explicit two options visible, derived no clickable tier, Qwen unmapped option disabled with reason, and no synthetic high/medium/low.**
- [ ] **Step 2: Add failing state tests for Midjourney high → GPT Image model switch, stale flag/value removal, valid option preservation on revision refresh, invalid option clearing, and estimate refresh.**
- [ ] **Step 3: Add failing API client tests proving `errorCode` and current revision survive response parsing.**
- [ ] **Step 4: Run UI tests and verify current generic qualities UI fails.**

Run: `cd web && pnpm vitest run src/hooks/use-creative-agent-options.test.ts src/components/creative-generation-preference-fields.test.tsx 'src/app/(user)/create/components/creative-generation-preferences.test.ts' src/services/api/image.test.ts`

- [ ] **Step 5: Derive the logical-model profile in the existing options hook.** Single models expose the eligible binding union; explicit multi-model selection exposes only semantically compatible option intersections.
- [ ] **Step 6: Replace fixed quality rendering with the profile rules in Section 12.** Keep popover layout and disabled explanation conventions.
- [ ] **Step 7: Submit only symbolic value and revisions.** On a typed race error, call `loadPublicSession({ force: true })`, reapply configuration, clear invalid state/estimate, show Chinese guidance, and require another explicit submit.
- [ ] **Step 8: Run Phase 10 tests and typecheck.**

Run: `cd web && pnpm vitest run src/hooks/use-creative-agent-options.test.ts src/components/creative-generation-preference-fields.test.tsx 'src/app/(user)/create/components/creative-generation-preferences.test.ts' src/services/api/image.test.ts && pnpm typecheck`

## 23. Phase 11 — Legacy Compatibility

**Files:**
- Modify: `web/src/lib/server/capability-constraints.ts`
- Modify: `web/src/lib/server/capability-constraints.test.ts`
- Modify: `web/src/lib/model-routing-config.ts`
- Modify: `web/src/lib/model-routing-config.test.ts`
- Modify: `web/src/components/admin/admin-logical-model-manager.tsx`
- Modify: `web/src/components/admin/admin-generation-settings.dom.test.tsx`

**Interfaces:**
- Consumes: bindings without a new profile and existing `generationParameters.qualities`.
- Produces: a clearly isolated non-DFLOP legacy adapter and debug telemetry.

- [ ] **Step 1: Add failing tests proving a non-DFLOP provider still reads old qualities and a DFLOP binding never falls back to or writes generic qualities.**
- [ ] **Step 2: Add an admin regression assertion that legacy qualities remain editable only for bindings without an authoritative profile and are labeled as legacy compatibility.**
- [ ] **Step 3: Run compatibility tests before implementation.**

Run: `cd web && pnpm vitest run src/lib/server/capability-constraints.test.ts src/lib/model-routing-config.test.ts src/components/admin/admin-generation-settings.dom.test.tsx`

- [ ] **Step 4: Add the bounded legacy adapter and one structured debug log.** Never translate legacy low/medium/high into DFLOP profile options.
- [ ] **Step 5: Run compatibility tests and the existing generation parameter suite.**

Run: `cd web && pnpm vitest run src/lib/server/capability-constraints.test.ts src/lib/model-routing-config.test.ts src/lib/generation-parameters.test.ts src/components/admin/admin-generation-settings.dom.test.tsx`

## 24. Phase 12 — Unit, Integration, Browser, and Regression

**Files:**
- Modify: `web/src/lib/server/active-protocol-media-proxy-matrix.live.test.ts`
- Modify: `web/e2e/responsive.spec.ts`
- Modify: `web/e2e/core.spec.ts`
- Test all files listed in the impact map.

**Interfaces:**
- Consumes: the complete implementation.
- Produces: release evidence only; no product semantics.

- [ ] **Step 1: Add one protocol fixture matrix covering successful DFLOP image generation/edit, Qwen exact size, Seedream tier, Midjourney prompt flag/four results, safe fallback, and upstream failure.**
- [ ] **Step 2: Add browser race coverage.** Open revision A, mutate fixture/settings to revision B, submit old selection, assert typed refresh and required reconfirmation; also test semantic preservation when only presentation changes.
- [ ] **Step 3: Add parameterized responsive tests at desktop, 390px, and 430px.** Use semantic clicks, read final bounds/display, assert no horizontal overflow, visible disabled explanation, and no forced clicks or fixed waits.
- [ ] **Step 4: Run all focused image quality tests.**

Run: `cd web && pnpm vitest run src/lib/image-quality-profile.test.ts src/lib/dflop-image-quality-profile.test.ts src/lib/server/image-quality-resolver.test.ts src/lib/server/capability-constraints.test.ts src/lib/model-routing-config.test.ts src/app/api/image-tasks/route.test.ts src/lib/server/image-task-runtime.test.ts src/lib/server/generation-task-recovery-service.test.ts src/lib/billing/creative-sale-estimator.test.ts src/lib/server/system-ai-billing.test.ts 'src/app/api/ai/system/[channelId]/[...path]/route.test.ts' src/app/api/agent/runs/route.test.ts src/components/creative-generation-preference-fields.test.tsx src/components/admin/admin-generation-settings.dom.test.tsx`

- [ ] **Step 5: Run protocol integrations.**

Run: `cd web && pnpm test:protocols`

- [ ] **Step 6: Run the full unit suite without file parallelism if shared PostgreSQL integration tests are enabled.**

Run: `cd web && pnpm vitest run --no-file-parallelism`

- [ ] **Step 7: Run typecheck, lint, formatting check, production build, and release/UTF-8 check.**

Run: `cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm check:release`

- [ ] **Step 8: Run targeted browser regression.**

Run: `cd web && pnpm playwright test e2e/core.spec.ts e2e/responsive.spec.ts --project=chromium`

- [ ] **Step 9: Inspect the final working tree and verify only planned files changed.**

Run: `git status --short && git diff --check`

## 25. Per-Test Coverage Matrix

| # | Required case | Owning test file / phase |
| ---: | --- | --- |
| 1 | parse valid prompt_flag | `image-quality-profile.test.ts`, P1 |
| 2 | parse explicit resolution tier | `image-quality-profile.test.ts`, P1 |
| 3 | parse derived pixel tier | `image-quality-profile.test.ts`, P1 |
| 4 | none profile | `image-quality-profile.test.ts`, P1 |
| 5 | malformed profile reject | `image-quality-profile.test.ts`, P1 |
| 6 | candidate A resolve success | `image-quality-resolver.test.ts`, P2 |
| 7 | candidate B quality unsupported | `capability-constraints.test.ts`, P3 |
| 8 | retain only fully resolved candidates | `capability-constraints.test.ts`, P3 |
| 9 | targetBindingId cannot cross logical model | `image-quality-resolver.test.ts`, P2 |
| 10 | revision A → B | `image-quality-resolver.test.ts`, P2 |
| 11 | old option removed | `image-quality-resolver.test.ts`, P2 |
| 12 | option semantic changed | `image-quality-resolver.test.ts`, P2 |
| 13 | valid option preserved | `image-quality-resolver.test.ts`, P2 |
| 14 | standard → --sd | `image-quality-profile.test.ts`, P1 |
| 15 | high → --hd | `image-quality-profile.test.ts`, P1 |
| 16 | --sd → high → only --hd | `image-task-openai-live.test.ts`, P6 |
| 17 | --hd → standard → only --sd | `image-task-openai-live.test.ts`, P6 |
| 18 | duplicate flag normalize | `image-quality-profile.test.ts`, P1 |
| 19 | effectivePrompt does not mutate userPrompt | `image-task-runtime.test.ts`, P4 |
| 20 | fixed 4 output estimate | `creative-sale-estimator.test.ts`, P7 |
| 21 | fixed 4 output hold | system proxy route test, P5 |
| 22 | supported 1K exact mapping | `image-quality-resolver.test.ts`, P2 |
| 23 | supported 2K exact mapping | `image-quality-resolver.test.ts`, P2 |
| 24 | unsupported ratio+tier reject | `image-quality-resolver.test.ts`, P2 |
| 25 | no guessed size | `dflop-image-quality-profile.test.ts`, P8 |
| 26 | forged size rejected | system proxy route test, P5 |
| 27 | exact WxH → normal tier | `image-quality-resolver.test.ts`, P2 |
| 28 | exact WxH → large tier | `image-quality-resolver.test.ts`, P2 |
| 29 | threshold boundary | `image-quality-resolver.test.ts`, P2 |
| 30 | no exact size cannot derive | `image-quality-resolver.test.ts`, P2 |
| 31 | client pixelTier ignored | `image-quality-resolver.test.ts`, P2 |
| 32 | estimate/hold same tier | estimator + proxy route tests, P5/P7 |
| 33 | sync does not overwrite manual | `model-routing-config.test.ts`, P8 |
| 34 | manual drift detected | `model-routing-config.test.ts`, P8 |
| 35 | invalid manual runtime reject | `image-quality-resolver.test.ts`, P2 |
| 36 | old qualities other-provider compatibility | `capability-constraints.test.ts`, P11 |
| 37 | DFLOP stops writing generic qualities | `model-routing-config.test.ts`, P8/P11 |
| 38 | none hidden | preference fields test, P10 |
| 39 | explicit <2 hidden | preference fields test, P10 |
| 40 | explicit >=2 visible | preference fields test, P10 |
| 41 | derived has no clickable quality | preference fields test, P10 |
| 42 | model switch clears stale selection | create preferences test, P10 |
| 43 | profile revision refresh | create preferences + `core.spec.ts`, P10/P12 |
| 44 | estimate refresh | credit estimate test, P7 |
| 45 | desktop | `responsive.spec.ts`, P12 |
| 46 | 390px | `responsive.spec.ts`, P12 |
| 47 | 430px | `responsive.spec.ts`, P12 |
| 48 | forged quality | image API + proxy tests, P3/P5 |
| 49 | forged target binding | resolver + proxy tests, P2/P5 |
| 50 | forged size | resolver + proxy tests, P2/P5 |
| 51 | forged pricing tier | proxy route test, P5 |
| 52 | stale revision | Agent/image route + browser tests, P3/P5/P12 |
| 53 | existing image generation | protocol matrix, P12 |
| 54 | image editing | protocol matrix, P12 |
| 55 | multi-image result | OpenAI live + protocol matrix, P6/P12 |
| 56 | hold | system proxy route test, P5 |
| 57 | settlement | full billing regression, P12 |
| 58 | refund | image runtime/full regression, P12 |
| 59 | retry | image runtime test, P4 |
| 60 | recovery | generation recovery test, P4 |
| 61 | usage snapshot | generation usage context + proxy tests, P5 |
| 62 | pricing approval | existing suggested sale approval tests in full suite, P12 |
| 63 | unified estimator | estimator test, P7 |
| 64 | DFLOP discovery/sync | admin models + routing config tests, P8 |

## 26. Midjourney Prompt Test Matrix

| userPrompt | Explicit selection | Expected effectivePrompt | Public prompt |
| --- | --- | --- | --- |
| `a cat` | standard | `a cat --sd` | `a cat` |
| `a cat` | high | `a cat --hd` | `a cat` |
| `a cat --sd` | high | `a cat --hd` | `a cat --sd` |
| `a cat --hd` | standard | `a cat --sd` | `a cat --hd` |
| `a cat --sd --sd` | standard | `a cat --sd` | unchanged |
| `a cat --sd --hd` | high | `a cat --hd` | unchanged |
| `a --style raw cat` | high | `a --style raw cat --hd` | unchanged |
| `the --sdf file` | standard | `the --sdf file --sd` | unchanged |
| first normalized result | same selection again | byte-identical result | unchanged |
| `a cat --hd` | no explicit selection, default standard | `a cat --sd` | unchanged |

## 27. Transaction and Trust Boundaries

1. Profile parsing/sync is settings mutation; it does not create billing records.
2. Task create rereads settings and resolves candidates before task persistence or any hold.
3. The selected candidate context is signed with the existing system AI usage request and verified at the proxy.
4. Hold creation and its sale rate/request snapshot retain their current transaction semantics.
5. A quality business validation failure removes a candidate or rejects the request; it cannot leave a partial task/hold.
6. A database failure follows the existing task/hold rollback/reconciliation path; this feature adds no second transaction.

## 28. Error and Client Recovery Contract

| Code | Server condition | HTTP | Client action |
| --- | --- | ---: | --- |
| `QUALITY_PROFILE_CHANGED` | Aggregate/derived profile semantics changed | 409 | Force-refresh public session, clear incompatible state/estimate, show “画质配置已更新，请重新确认后提交”. |
| `QUALITY_OPTION_UNAVAILABLE` | Option removed, disabled, unmapped ratio, or unsupported exact size | 400 | Refresh, clear option, keep prompt/attachments, require new choice. |
| `QUALITY_CONTEXT_UNRESOLVABLE` | Execution effect cannot be completed | 400 | Show resolver reason; do not create task. |
| `QUALITY_TARGET_BINDING_INVALID` | Variant target is cross-model/inactive/ineligible | 400 | Refresh model capabilities; do not expose the binding ID. |
| `QUALITY_PRICING_UNAVAILABLE` | No matching approved sale dimension or threshold drift | 400 | Display “当前画质暂不可计价”; do not estimate/hold/submit. |

## 29. Risk Matrix

| Risk | Impact | Mitigation | Required test |
| --- | --- | --- | --- |
| Binding profiles differ under one logical model | UI exposes an option no candidate can execute | Build a safe aggregate for display, resolve each binding independently, route only successful candidates | mixed A/B candidate test P3 |
| Fallback reuses binding A context | Wrong model, prompt, size, or price on B | Store independent context in every candidate config | A→B runtime test P4 |
| Midjourney prompt mutation | Public prompt polluted or conflicting flags billed/executed | Separate user/effective prompt and normalize one mutex group | prompt matrix P1/P6 |
| Qwen exact mapping incomplete | Guessed upstream size | Empty ratio map until verified; disabled UI plus server reject | ratio/tier and no-guess tests P2/P8 |
| Seedream threshold drift | Estimate/hold tier mismatch | Single rate-card threshold, Decimal comparison, validation block | boundary/drift/estimate-hold tests P2/P5/P7 |
| Legacy qualities break other providers | Existing image flows lose controls | Isolated non-DFLOP compatibility adapter and full suite | legacy provider test P11 |
| Manual override becomes stale | Invalid request remains executable | Preserve data but validate after sync/runtime and block severe status | manual drift/runtime tests P8/P2 |
| Pricing/profile revision race | Old choice charged under new semantics | Semantic option revision plus sale/profile revision in signed context | revision race tests P2/P5/P12 |
| Saved tasks/recovery mix schemas | Recovery changes accepted work or crashes | Optional fields, legacy path, refresh only before acceptance | old task and recovery tests P4 |
| Client/server schema mismatch | Old client submits incomplete/forged fields | Strict parser, typed errors, forced capability refresh | contract/API/browser tests P1/P5/P12 |

## 30. No-Change Guarantees

- Separate Grok and GPT Image logical models remain separate.
- Existing saleRateCard approval/source/revision rules remain unchanged.
- Provider cost conversion and suggested price logic remain unchanged.
- Settlement, refund, retry identity, and usage snapshots keep existing formulas and transaction boundaries.
- DFLOP model discovery still starts with the API-key-visible `/v1/models` set and only enriches it with public registry metadata.
- Image editing and multi-result persistence retain their current APIs.

## 31. Verification Evidence to Capture During Implementation

For every phase, record the exact command, exit code, and failing/passing test names. At Phase 12, retain:

- Focused Vitest result count.
- Full Vitest result count and any explicitly skipped external tests.
- Typecheck, lint, format, build, release/UTF-8 results.
- Protocol fixture result for create/edit/multi-result/fallback.
- Browser screenshots or trace references for desktop, 390px, 430px, and the revision race.
- A sanitized example task snapshot showing intent and two distinct candidate contexts.
- A sanitized system proxy hold snapshot proving exact size/tier/count/revisions match the selected context.

## 32. Plan Self-Review

- Spec coverage: all design sections and all five newly locked boundaries map to Phases 1–12.
- Required order: domain → resolver → candidates → normalized context → server/hold → provider → estimator → sync → admin → `/create` → legacy → regression.
- Placeholder scan: every implementation and test step names its behavior, file, and verification command; no unfinished markers remain.
- Type consistency: `ImageQualityIntent`, `ResolvedImageQualityContext`, profile/option revisions, `targetBindingId`, and typed error codes are defined once and used consistently.
- Review focus: each of the five high-risk conditions has a named test in its owning phase.
- Data migration: JSON expansion is sufficient; no schema migration is planned.
- Product code: this document is the only file created in the planning turn.

## 33. Completion Report Format

After executing this plan, report these exact items:

1. Root cause replaced by the binding-level profile.
2. Final modified and new file list.
3. Final domain schema and public redaction.
4. Resolver and candidate routing flow.
5. User intent versus binding-resolved snapshot fields.
6. Revision race behavior and typed errors.
7. Midjourney prompt normalization results.
8. Qwen supported mappings and intentionally unsupported ratios.
9. Seedream authoritative threshold source and boundary results.
10. Midjourney four-output estimate/hold result.
11. Manual sync preservation and drift validation result.
12. Legacy qualities compatibility result.
13. Admin UI result.
14. `/create` dynamic UI and model-switch result.
15. Estimate versus authoritative hold consistency.
16. Retry/fallback/recovery result.
17. Security/forgery test result.
18. All 64 required test cases and quality gate results.
19. Remaining unclassifiable or blocked profiles with exact reasons.
20. Confirmation that image editing, multi-image results, sale approval, settlement, refund, usage snapshot, and DFLOP discovery were not regressed.
