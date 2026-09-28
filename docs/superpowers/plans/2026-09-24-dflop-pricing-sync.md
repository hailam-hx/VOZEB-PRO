# DFLOP Pricing Sync and HOTX Suggested Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user explicitly requests delegation.

**Goal:** Synchronize DFLOP structured provider pricing, convert it exactly into HOTX credit costs, aggregate safe logical-model suggested prices across eligible bindings, and expose source, drift, audit, and policy controls without changing the existing usage settlement formulas.

**Architecture:** Extend the existing settings JSONB and logical-model price-card model with a system pricing policy, a complete binding-level provider pricing profile, and a logical-model suggested-sale snapshot. Parse and reconcile provider dimensions independently, use `decimal.js` for every financial calculation, project only executable dimensions into the existing `costRateCard`, and keep `saleRateCard` unchanged unless a complete suggestion is explicitly allowed by `autoApplySalePrice`.

**Tech Stack:** Next.js Route Handlers, TypeScript, React, Ant Design, Zustand, PostgreSQL JSONB repositories, `decimal.js`, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-dflop-pricing-sync-design.md`

## Global Constraints

- Do not modify hold, settlement, refund, retry/recovery, usage snapshot, or the existing final sale-charge formula.
- `/v1/models` remains the authority for the current API key's visible model IDs; the public registry only enriches that set.
- Preserve raw DFLOP pricing and all unknown pricing fields. Unknown fields must never become executable prices.
- `missing !== zero`: missing upstream prices retain the last effective value and become stale; explicit valid zero remains zero.
- Treat structured registry prices as already discounted. Preserve `discount` as metadata and never apply it again.
- Use decimal strings and the existing `decimal.js` wrapper. Never use `Number` or `parseFloat` for final financial calculations.
- Default policy: `dflopCreditsPerCny="60"`, `cnyToUsd="0.15"`, `hotxUsdPerCredit="1"`, `markupMultiplier="1"`, `minimumMarginRate=null`, `costBasis="max_active_binding_cost"`, `autoApplySalePrice=false`.
- Prefer `/api/v1/config/currency` over the default 60 value. Preserve the last valid conversion when that endpoint fails.
- `markupMultiplier="1"` means a break-even suggestion. It is not a commercial sale price.
- Never overwrite a manual provider dimension or manual sale price during ordinary model sync.
- Do not commit, push, or create a PR while executing this plan.
- Keep Chinese admin copy and complete the existing `zh-CN`, `en`, and `vi` message sets where the touched UI uses translated copy.
- Update `docs/content/docs/backend/backend-database.mdx` for the new `pricing_policy` column and logical-model pricing fields.
- Run related tests and typecheck after every task. Finish with the full AGENTS.md quality gate, browser regression at desktop/390px/430px, and strict UTF-8 checks.

## Review Focus

- A DFLOP currency response whose numeric value is valid but whose unit direction is CNY-per-credit must not be mistaken for credits-per-CNY; Task 2 pins accepted schema variants and rejects ambiguous payloads.
- Two bindings with the same dimension but different condition keys or units must not be compared; Task 6 pins canonical identity and incomplete-suggestion behavior.
- A manually overridden resolution tier must retain its effective value when the upstream tier disappears, while another upstream-managed tier still updates; Task 5 pins independent dimension reconciliation.
- A public-registry success combined with `/v1/models` authentication failure must not persist models, prices, or currency changes; Task 4 pins the transaction boundary.
- Enabling auto apply with an incomplete suggestion must not alter `saleRateCard`; Task 7 pins server-authoritative validation and atomic behavior.

---

## File Map

### New focused domain modules

- `web/src/lib/billing/provider-pricing.ts`: provider pricing types, canonical dimension IDs, normalization, status, and manual/upstream reconciliation.
- `web/src/lib/billing/provider-pricing.test.ts`: pure reconciliation and missing/zero/unknown tests.
- `web/src/lib/billing/pricing-policy.ts`: policy normalization, version generation, DFLOP credit conversion, and policy snapshot types.
- `web/src/lib/billing/pricing-policy.test.ts`: Decimal conversion and policy-validation tests.
- `web/src/lib/billing/suggested-model-pricing.ts`: eligible-binding filtering, cost-basis aggregation, markup, completeness, margin warnings, and suggested snapshot generation.
- `web/src/lib/billing/suggested-model-pricing.test.ts`: multi-binding aggregation and auto-apply eligibility tests.
- `web/src/lib/dflop-pricing.ts`: structured DFLOP pricing parser and raw snapshot preservation.
- `web/src/lib/dflop-pricing.test.ts`: text/image/video/audio/unknown/discount parser tests.
- `web/src/lib/server/dflop-pricing-sync-service.ts`: orchestrates public pricing, currency config, policy conversion, profile reconciliation, and sync statistics.
- `web/src/lib/server/dflop-pricing-sync-service.test.ts`: service-level failure and statistics tests.

### Existing domain and persistence files

- `web/src/lib/auth/store-types.ts`: add policy, provider profile, suggested pricing, source, status, drift, and snapshot contracts.
- `web/src/lib/auth/store-normalizers.ts`: normalize and expose saved pricing policy and logical-model pricing fields.
- `web/src/lib/auth/store-settings-merge.ts`: preserve server-authoritative pricing fields and manual sources through settings patches.
- `web/src/lib/model-routing-config.ts`: reconcile discovered DFLOP profiles into bindings and recalculate logical-model suggestions after binding synchronization.
- `web/src/lib/dflop-model-metadata.ts`: delegate pricing parsing to `dflop-pricing.ts` and retain complete raw fields.
- `web/src/lib/server/database/schema.ts`: add `app_settings.pricing_policy JSONB` to create and alter definitions.
- `web/src/lib/server/database/repositories.ts`: read/write the new settings field with the current parameterized JSON helper.
- `docs/content/docs/backend/backend-database.mdx`: document the new storage contract.

### Existing API and service files

- `web/src/app/api/admin/models/route.ts`: call the pricing sync service after model visibility succeeds and return pricing policy/profile patches and statistics.
- `web/src/lib/server/admin-model-catalog.ts`: keep catalog classification separate and attach parsed pricing metadata without filtering visible models.
- `web/src/lib/server/admin-model-pricing-service.ts`: dimension manual overrides, restore-upstream, policy-driven recalculation, sale-price source rules, and warnings.
- `web/src/app/api/admin/billing/model-pricing/route.ts`: accept only administrator-editable pricing commands and audit saved changes.
- `web/src/services/api/admin-billing-commerce.ts`: typed pricing and pricing-policy requests.
- `web/src/app/api/admin/settings/route.ts` and settings services: accept and persist normalized pricing policy with fresh read-after-write behavior.

### Existing UI files

- `web/src/app/admin/billing/components/billing-operations.tsx`: pricing policy form and expanded logical-model pricing editor.
- `web/src/components/admin/admin-system-channel-editor.tsx`: consume DFLOP pricing sync results and show summary/warnings.
- `web/src/components/admin/channels/admin-channel-detail-drawer.tsx`: show last pricing sync summary in the channel workflow.
- `web/src/components/admin/admin-generation-settings.dom.test.tsx`: pricing policy, sources, drift, and responsive DOM coverage.
- `web/e2e/core.spec.ts`: desktop and mobile browser regression for model sync/pricing panels.

---

### Task 1: Provider Pricing Domain and DFLOP Structured Parser

**Files:**
- Create: `web/src/lib/billing/provider-pricing.ts`
- Create: `web/src/lib/billing/provider-pricing.test.ts`
- Create: `web/src/lib/dflop-pricing.ts`
- Create: `web/src/lib/dflop-pricing.test.ts`
- Modify: `web/src/lib/auth/store-types.ts:175-245`
- Modify: `web/src/lib/dflop-model-metadata.ts:20-115`

**Interfaces:**
- Produces `ProviderPricingStatus`, `ProviderPricingDimensionKind`, `ProviderPricingDimension`, `ProviderPricingWarning`, `ProviderPricingProfile`, and `parseDflopPricing(metadata, context)`.
- Produces `canonicalProviderPricingDimensionId(dimension)` for reconciliation and logical-model aggregation.
- Consumes no mutable settings or runtime services; all functions are pure.

- [ ] **Step 1: Add failing parser tests for every confirmed structured family**

Create table-driven tests with string amounts and dynamic tier keys:

```ts
it("parses text prices without numeric coercion", () => {
    const parsed = parseDflopPricing({
        input_per_1m: "2022",
        cached_input_per_1m: "202.2",
        output_per_1m: "12132",
        cache_creation_per_1m: "303.3",
        long_context_threshold_tokens: 200000,
        input_per_1m_long: "4044",
        output_per_1m_long: "24264",
        price_per_server_tool_call: "2.022",
    }, { modelId: "grok-4.6", category: "text", syncedAt: "2026-09-24T00:00:00.000Z" });

    expect(parsed.dimensions).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "TOKEN_INPUT", upstreamValue: "2022", effectiveValue: "2022" }),
        expect.objectContaining({ kind: "CACHE_CREATION", upstreamValue: "303.3" }),
        expect.objectContaining({ kind: "SERVER_TOOL_CALL", upstreamValue: "2.022" }),
    ]));
    expect(parsed.raw.long_context_threshold_tokens).toBe(200000);
});

it("keeps every dynamic video tier", () => {
    const parsed = parseDflopPricing({
        price_per_video_second: "224.532",
        video_price_tiers: { "480p": "40.3515", "720p": "90.72", "future-tier": "333.125" },
        video_token_price_per_1m: { default: "4200", with_video_input: "2520", "default@1080p": "4620" },
        video_second_stage_per_second: { "720p": "2.5", "1080p": "5" },
    }, { modelId: "doubao-seedance-2.5", category: "video", syncedAt: "2026-09-24T00:00:00.000Z" });

    expect(parsed.dimensions.find((item) => item.id.includes("future-tier"))?.effectiveValue).toBe("333.125");
});
```

Also cover image output/input/large, `images_per_request`, `price_per_tts_char`, `price_per_voice_clone`, `price_per_music_generation`, `price_per_avatar`, explicit zero, invalid negative values, unknown fields, and `discount` metadata.

- [ ] **Step 2: Run the new tests and verify they fail because the parser/types do not exist**

Run:

```bash
cd web
npm test -- --run src/lib/dflop-pricing.test.ts src/lib/billing/provider-pricing.test.ts
```

Expected: FAIL on missing modules or exports.

- [ ] **Step 3: Define the provider pricing contracts**

Add discriminated string unions and serializable profiles to `store-types.ts` and/or re-export the focused domain types:

```ts
export type ProviderPricingDimensionKind =
    | "TOKEN_INPUT"
    | "TOKEN_CACHED_INPUT"
    | "TOKEN_OUTPUT"
    | "CACHE_CREATION"
    | "IMAGE_OUTPUT"
    | "IMAGE_INPUT"
    | "IMAGE_LARGE"
    | "VIDEO_SECOND"
    | "VIDEO_INPUT_SECOND"
    | "VIDEO_TOKEN"
    | "VIDEO_SECOND_STAGE"
    | "TTS_CHARACTER"
    | "VOICE_CLONE_CALL"
    | "MUSIC_GENERATION"
    | "SERVER_TOOL_CALL"
    | "REQUEST"
    | "OTHER";
```

Use `source`, `upstreamValue`, `effectiveValue`, `syncedAt`, `conditions`, and `metadata` on each dimension. Keep raw JSON serializable and bounded by the existing settings payload limits.

- [ ] **Step 4: Implement deterministic structured parsing**

Implement field-specific parsing functions rather than one generic guesser:

```ts
export function parseDflopPricing(
    metadata: Record<string, unknown>,
    context: { modelId: string; category?: string; endpointType?: string | null; syncedAt: string },
): ProviderPricingProfile;
```

Rules:

- Decimal fields accept string or finite JSON number input, immediately convert to canonical decimal text through the existing decimal helper, and reject negative values.
- Tier objects preserve every non-empty key; canonical IDs include kind plus normalized condition key.
- `images_per_request` remains profile metadata and never becomes a price dimension.
- Unknown pricing-shaped fields go to `unknownFields`; all original pricing keys remain in `raw`.
- `discount` is metadata only.
- A callable model with no recognized price basis becomes `NEEDS_REVIEW`; partial recognized data plus unknown basis becomes `PARTIAL`.

- [ ] **Step 5: Replace the limited `PRICING_FIELDS` picker in DFLOP metadata**

Change `parseDflopModelMetadata` to call `parseDflopPricing` and store the result under typed `providerPricingProfile`. Remove the legacy `upstreamMetadata.pricing` field in the same task, then update `admin-logical-model-manager.tsx`, `dflop-model-metadata.test.ts`, `store-settings-capability-persistence.test.ts`, and `admin/models/route.test.ts` to read/assert `providerPricingProfile`. The project is pre-release, so do not add a dual-read compatibility branch.

- [ ] **Step 6: Run parser tests, existing DFLOP metadata tests, and typecheck**

Run:

```bash
cd web
npm test -- --run src/lib/dflop-pricing.test.ts src/lib/billing/provider-pricing.test.ts src/lib/dflop-model-metadata.test.ts src/lib/server/admin-model-catalog.test.ts
npm run typecheck
```

Expected: all selected tests pass and TypeScript reports no errors.

- [ ] **Step 7: Review checkpoint without committing**

Run `git diff --check` and inspect only Task 1 files. Do not commit, push, or create a PR.

---

### Task 2: Pricing Policy, Currency Response Parsing, and Decimal Conversion

**Files:**
- Create: `web/src/lib/billing/pricing-policy.ts`
- Create: `web/src/lib/billing/pricing-policy.test.ts`
- Modify: `web/src/lib/auth/store-types.ts:230-255`
- Modify: `web/src/lib/billing/money.ts:1-55`

**Interfaces:**
- Produces `normalizeSystemPricingPolicy(input)`, `pricingPolicyVersion(policy)`, `parseDflopCurrencyConfig(payload)`, `convertDflopCreditsToHotx(value, policy)`, and `pricingConversionSnapshot(policy, calculatedAt)`.
- Consumes the existing `decimal()` and `decimalText()` helpers.

- [ ] **Step 1: Write failing policy and currency tests**

Pin defaults, manual source preservation, unambiguous currency schemas, ambiguous payload rejection, and exact examples:

```ts
expect(convertDflopCreditsToHotx("224.532", policy)).toBe("0.56133");
expect(convertDflopCreditsToHotx("90.72", policy)).toBe("0.2268");
expect(convertDflopCreditsToHotx("0.000000000001", policy)).toBe("0.0000000000000025");
```

Use the confirmed live response shape as the accepted fixture:

```json
{
  "unit": "points",
  "points_per_cny": 60.0,
  "usd_to_cny_peg": 6.74,
  "points_per_usd": 404.4
}
```

Read `points_per_cny` as DFLOP credits per CNY only when `unit="points"`; convert the JSON number immediately with `decimal(String(value))`. Preserve the full payload only as the version input. Do not substitute `usd_to_cny_peg` or `points_per_usd` for HOTX's configured `cnyToUsd`. Reject a payload that only contains an unlabeled `60`, reverses the unit direction, or has a different `unit`.

- [ ] **Step 2: Run the policy tests and verify the missing exports fail**

```bash
cd web
npm test -- --run src/lib/billing/pricing-policy.test.ts
```

- [ ] **Step 3: Implement normalized policy defaults and stable versioning**

```ts
export const DEFAULT_SYSTEM_PRICING_POLICY: SystemPricingPolicy = {
    version: "",
    dflopCreditsPerCny: "60",
    dflopCreditsPerCnySource: "default",
    cnyToUsd: "0.15",
    hotxUsdPerCredit: "1",
    markupMultiplier: "1",
    minimumMarginRate: null,
    costBasis: "max_active_binding_cost",
    autoApplySalePrice: false,
};
```

Validate every conversion and multiplier as a positive Decimal. Allow `markupMultiplier < 1` to be saved for audit/preview, emit a below-cost warning for the resulting suggestion, and prohibit auto application while the suggestion is below cost. Validate `minimumMarginRate` as null or a decimal in `[0,1)`.

- [ ] **Step 4: Implement currency parsing and conversion**

Return a typed result that carries the upstream value and a stable version derived from the accepted currency payload:

```ts
type DflopCurrencyConfig = {
    creditsPerCny: string;
    version: string;
};
```

Do not round during conversion. Preserve Decimal output as canonical text.

- [ ] **Step 5: Run policy, money, and pricing regression tests**

```bash
cd web
npm test -- --run src/lib/billing/pricing-policy.test.ts src/lib/billing/pricing.test.ts src/lib/billing/money.test.ts
npm run typecheck
```

- [ ] **Step 6: Review checkpoint without committing**

Run `git diff --check`. Confirm no binary floating-point path exists in Task 2 files.

---

### Task 3: Persist Pricing Policy and New Logical-Model Pricing Fields

**Files:**
- Modify: `web/src/lib/server/database/schema.ts:20-55`
- Modify: `web/src/lib/server/database/repositories.ts:85-190`
- Modify: `web/src/lib/auth/store-normalizers.ts`
- Modify: `web/src/lib/auth/store-settings-merge.ts`
- Modify: `web/src/lib/auth/store.ts`
- Modify: `web/src/lib/server/database/repositories.test.ts`
- Modify: `web/src/lib/auth/store-settings-capability-persistence.test.ts`
- Modify: `web/src/lib/server/database/postgres.test.ts`
- Modify: `docs/content/docs/backend/backend-database.mdx:35-50`

**Interfaces:**
- Consumes `normalizeSystemPricingPolicy`, `ProviderPricingProfile`, and `SuggestedSaleRateCard` from Tasks 1-2.
- Produces fresh settings reads containing `pricingPolicy`; preserves dimension sources and suggested calculation snapshots through PostgreSQL and file-provider round trips.

- [ ] **Step 1: Add failing schema and round-trip tests**

Assert both create and alter SQL include:

```sql
pricing_policy jsonb NOT NULL DEFAULT '{}'::jsonb
```

Add a settings round trip containing:

```ts
pricingPolicy: policy,
logicalModels: [{
    ...model,
    suggestedSaleRateCard: suggestion,
    bindings: [{ ...binding, providerPricingProfile: profile }],
}],
```

Verify decimal strings, dimension sources, raw pricing, policy version, `calculatedAt`, and `costBasis` survive unchanged.

- [ ] **Step 2: Run persistence tests and verify they fail**

```bash
cd web
npm test -- --run src/lib/server/database/repositories.test.ts src/lib/server/database/postgres.test.ts src/lib/auth/store-settings-capability-persistence.test.ts
```

- [ ] **Step 3: Add `pricing_policy` directly to the current schema**

Modify the initial table definition and the existing ALTER block. Do not add an old-data migration branch, dual-write behavior, or cleanup SQL.

- [ ] **Step 4: Extend repository mappers and settings normalizers**

Use the existing `jsonParam` and `jsonValue` helpers. Normalize policy and model pricing fields on every server read. Reject invalid source/status/type combinations instead of passing unchecked JSON into billing code.

- [ ] **Step 5: Preserve pricing fields during partial settings patches**

Update settings merge behavior so channel/capability edits do not erase provider profiles or suggested prices, and pricing edits do not erase generation capability provenance.

- [ ] **Step 6: Update database documentation**

Document:

- `pricing_policy` as system conversion/markup/cost-basis configuration;
- provider pricing profile and suggested sale snapshot inside `logical_models`;
- raw values and audit logs;
- no change to usage charge settlement snapshots.

- [ ] **Step 7: Run persistence tests and typecheck**

```bash
cd web
npm test -- --run src/lib/server/database/repositories.test.ts src/lib/server/database/postgres.test.ts src/lib/auth/store-settings-capability-persistence.test.ts src/lib/auth/store-settings-actions.test.ts
npm run typecheck
```

- [ ] **Step 8: Review checkpoint without committing**

Run `git diff --check` and inspect schema documentation consistency.

---

### Task 4: DFLOP Currency Fetch and Pricing Sync Service

**Files:**
- Create: `web/src/lib/server/dflop-pricing-sync-service.ts`
- Create: `web/src/lib/server/dflop-pricing-sync-service.test.ts`
- Modify: `web/src/app/api/admin/models/route.ts:150-285`
- Modify: `web/src/app/api/admin/models/route.test.ts`
- Modify: `web/src/lib/server/admin-model-catalog.ts:75-115`
- Modify: `web/src/lib/server/admin-model-catalog.test.ts`
- Modify: `web/scripts/protocol-fixture-server.mjs`
- Modify: `web/scripts/protocol-fixture-server.test.mjs`

**Interfaces:**
- Consumes visible models, public registry payload, current policy, current logical models, current channels, and a currency fetch result.
- Produces `{ profiles, pricingPolicyPatch, stats, warnings }` without directly writing settings.
- Route returns the result as part of the existing model-sync draft response.

- [ ] **Step 1: Extend the local fixture with the public pricing and currency endpoints**

Add deterministic fixture routes:

```text
GET /api/v1/models/public
GET /api/v1/config/currency
```

Fixture data must include text long-context/tool pricing, image multi-dimensional pricing, Seedance 2.5 video tiers/tokens/second-stage, TTS, voice clone, unknown fields, discount, duplicates, and a key allowlist subset.

- [ ] **Step 2: Add failing service and route tests**

Cover:

- visible subset enrichment only;
- currency success and policy patch;
- public registry failure with discovery success;
- currency failure preserving current policy;
- `/v1/models` 401 with public and currency success still returns failure and no pricing payload;
- mismatched IDs and duplicate IDs;
- exact statistics with counts derived from fixture contents.

Assert no API key appears in log calls.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
cd web
npm test -- --run src/lib/server/dflop-pricing-sync-service.test.ts src/app/api/admin/models/route.test.ts scripts/protocol-fixture-server.test.mjs
```

- [ ] **Step 4: Implement the pure orchestration service**

```ts
export function buildDflopPricingSync(input: {
    visibleModelIds: string[];
    publicPayload: unknown;
    currencyPayload?: unknown;
    currentPolicy: SystemPricingPolicy;
    currentProfiles: Record<string, ProviderPricingProfile | undefined>;
    syncedAt: string;
}): DflopPricingSyncResult;
```

Only visible canonical IDs receive profiles. Currency failure adds a warning and retains current policy. Public failure returns no new profiles and marks prior DFLOP profiles stale through the later reconciliation step.

- [ ] **Step 5: Integrate the route sequentially after authenticated discovery succeeds**

Fetch public registry and currency independently after `/v1/models` succeeds. A public failure must not make model discovery fail; a currency failure must not discard public pricing. Keep safe outbound validation, timeout, and sanitized logging.

- [ ] **Step 6: Add required sync statistics and logs**

Return and log:

```ts
type DflopPricingSyncStats = {
    models: number;
    pricingProfiles: number;
    created: number;
    updated: number;
    unchanged: number;
    priceIncreases: number;
    priceDecreases: number;
    missingPricing: number;
    unknownPricingFields: number;
    manualOverridesPreserved: number;
    belowCostWarnings: number;
};
```

At this stage `belowCostWarnings` may be finalized after Task 6 aggregation; pass the domain result through rather than hard-code a value.

- [ ] **Step 7: Run route, fixture, catalog, and type tests**

```bash
cd web
npm test -- --run src/lib/server/dflop-pricing-sync-service.test.ts src/app/api/admin/models/route.test.ts src/lib/server/admin-model-catalog.test.ts scripts/protocol-fixture-server.test.mjs
npm run typecheck
```

- [ ] **Step 8: Review checkpoint without committing**

Inspect network failure paths and confirm public/currency data cannot bypass API-key visibility.

---

### Task 5: Dimension-Level Reconciliation and Binding Cost Projection

**Files:**
- Modify: `web/src/lib/billing/provider-pricing.ts`
- Modify: `web/src/lib/billing/provider-pricing.test.ts`
- Modify: `web/src/lib/model-routing-config.ts:275-380`
- Modify: `web/src/lib/model-routing-config.test.ts`
- Modify: `web/src/lib/auth/store-settings-merge.ts`
- Modify: `web/src/lib/billing/pricing.ts:1-260` only if an already-supported usage dimension needs a safe alias; do not add settlement basis behavior.

**Interfaces:**
- Produces `reconcileProviderPricingProfile(previous, incoming)` and `providerPricingProfileToCostRateCard(profile)`.
- Binding synchronization consumes discovered profiles and preserves independent manual dimensions.

- [ ] **Step 1: Write failing reconciliation tests**

Use a previous profile with manual 720p and upstream 1080p, then an incoming profile with changed 720p/1080p and missing 480p:

```ts
expect(result.dimension("video-second:resolution=720p")).toMatchObject({
    source: "manual",
    upstreamValue: "100",
    effectiveValue: "95",
});
expect(result.dimension("video-second:resolution=1080p")).toMatchObject({
    source: "upstream",
    upstreamValue: "230",
    effectiveValue: "230",
});
expect(result.warnings).toContainEqual(expect.objectContaining({ code: "PRICING_DRIFT" }));
```

Also pin price decrease, explicit zero, missing price retention/stale status, unknown basis, and manual restoration to upstream.

- [ ] **Step 2: Run tests and verify current whole-profile behavior fails**

```bash
cd web
npm test -- --run src/lib/billing/provider-pricing.test.ts src/lib/model-routing-config.test.ts
```

- [ ] **Step 3: Implement canonical dimension reconciliation**

Compare dimensions by canonical `kind + normalized conditions + unit`, never by array index. Preserve manual `effectiveValue`; refresh its `upstreamValue` and drift. For upstream-managed missing dimensions, retain the prior dimension, attach `MISSING_UPSTREAM_PRICE`, and mark stale.

- [ ] **Step 4: Convert effective DFLOP dimensions into HOTX credits**

Keep raw DFLOP values in the profile. Store converted HOTX values in a distinct normalized projection or metadata field, then build `costRateCard` from converted executable dimensions only.

Map safe existing dimensions:

```text
TOKEN_INPUT          → inputTokens per 1,000,000
TOKEN_CACHED_INPUT   → cachedInputTokens per 1,000,000
TOKEN_OUTPUT         → outputTokens per 1,000,000
IMAGE_OUTPUT         → count per 1
VIDEO_SECOND + tier  → durationSeconds per 1, when.resolution=<tier>
TTS_CHARACTER        → characters per 1
VOICE_CLONE_CALL     → request per 1
```

Set `providerCostUnit` to `{ kind: "fiat", currency: "USD" }` only if `costRateCard` is USD-denominated. Because this design stores converted HOTX credits and 1 HOTX credit = 1 USD, document that identity in the conversion snapshot and keep the existing provider attempt USD semantics intact.

- [ ] **Step 5: Preserve non-executable dimensions without projecting them**

Long-context, cache creation, tool calls, video token, input-video duration, and second-stage dimensions remain in the full profile until runtime usage contracts are explicitly extended in a separate task. They must cause `PARTIAL` or `NEEDS_REVIEW` when required for the model's actual basis.

- [ ] **Step 6: Integrate profile reconciliation into binding synchronization**

Extend `normalizedCatalogBinding` and DFLOP resync functions so model discovery refreshes provider pricing alongside capability metadata. Non-DFLOP bindings retain existing behavior.

- [ ] **Step 7: Run domain, routing, pricing, and type tests**

```bash
cd web
npm test -- --run src/lib/billing/provider-pricing.test.ts src/lib/model-routing-config.test.ts src/lib/model-routing-pricing.test.ts src/lib/billing/pricing.test.ts
npm run typecheck
```

- [ ] **Step 8: Review checkpoint without committing**

Confirm the diff does not modify final sale charging or task settlement logic.

---

### Task 6: Multi-Binding Suggested Sale Pricing and Margin Warnings

**Files:**
- Create: `web/src/lib/billing/suggested-model-pricing.ts`
- Create: `web/src/lib/billing/suggested-model-pricing.test.ts`
- Modify: `web/src/lib/model-routing-config.ts`
- Modify: `web/src/lib/model-routing-config.test.ts`
- Modify: `web/src/lib/auth/store-types.ts`

**Interfaces:**
- Consumes a normalized logical model, channels, pricing policy, binding cost cards, and provider pricing profiles.
- Produces `calculateSuggestedSaleRateCard(input): SuggestedSalePricingResult` and `applySuggestedPricingToLogicalModels(models, channels, policy)`.

- [ ] **Step 1: Write failing max-active-binding tests**

Construct three bindings:

- enabled DFLOP 720p cost `0.2268`;
- enabled second provider 720p cost `0.25`;
- disabled provider 720p cost `0.8`.

Assert `max_active_binding_cost` selects `0.25`, ignores disabled/ineligible bindings, and records both eligible input revisions.

Add tests for:

- highest cost differs by dimension;
- same kind but mismatched conditions are not compared;
- same dimension with incomparable units makes the suggestion incomplete;
- one missing eligible binding dimension makes that dimension incomplete rather than zero;
- `primary_binding_cost` selects the first eligible routed binding;
- markup `1` preserves break-even values;
- Decimal markup multiplication;
- below-cost and minimum-margin warnings;
- policy/conversion/binding snapshot fields.

- [ ] **Step 2: Run tests and verify the module is missing**

```bash
cd web
npm test -- --run src/lib/billing/suggested-model-pricing.test.ts
```

- [ ] **Step 3: Implement eligible-binding filtering**

Reuse existing channel readiness and capability compatibility helpers. Do not call live provider-health state from a pure settings calculation; treat static enabled/ready/routable bindings as eligible and include a clear reason when excluded.

- [ ] **Step 4: Implement both cost-basis strategies**

```ts
export function calculateSuggestedSaleRateCard(input: {
    model: LogicalModel;
    channels: SystemModelChannel[];
    policy: SystemPricingPolicy;
    calculatedAt: string;
}): SuggestedSalePricingResult;
```

For max basis, group by canonical rate-card component identity including `dimension`, `per`, `match`, and sorted `when`. Choose the maximum Decimal unit price only among comparable groups.

- [ ] **Step 5: Implement completeness and margin diagnostics**

Return:

```ts
type SuggestedSalePricingResult = {
    suggestion?: SuggestedSaleRateCard;
    complete: boolean;
    warnings: ModelPricingWarning[];
};
```

Compare the existing formal `saleRateCard` against the selected cost basis without modifying it. Missing or incomparable components produce warnings and block auto application.

- [ ] **Step 6: Recalculate suggestions after logical-model synchronization**

Call aggregation only after all bindings are normalized, so suggestions see the complete logical model rather than one channel at a time.

- [ ] **Step 7: Run suggested pricing, routing, and billing tests**

```bash
cd web
npm test -- --run src/lib/billing/suggested-model-pricing.test.ts src/lib/model-routing-config.test.ts src/lib/model-routing-pricing.test.ts src/lib/billing/pricing.test.ts
npm run typecheck
```

- [ ] **Step 8: Review checkpoint without committing**

Verify no suggested price becomes a `saleRateCard` while `autoApplySalePrice=false`.

---

### Task 7: Server-Authoritative Admin Pricing and Policy APIs

**Files:**
- Modify: `web/src/lib/server/admin-model-pricing-service.ts`
- Modify: `web/src/lib/server/admin-model-pricing-service.test.ts`
- Modify: `web/src/app/api/admin/billing/model-pricing/route.ts`
- Modify: `web/src/app/api/admin/billing/model-pricing/route.test.ts`
- Modify: `web/src/app/api/admin/settings/route.ts`
- Modify: `web/src/app/api/admin/settings/route.test.ts`
- Modify or create focused service: `web/src/lib/server/admin-pricing-policy-service.ts`
- Create test: `web/src/lib/server/admin-pricing-policy-service.test.ts`
- Modify: `web/src/services/api/admin-billing-commerce.ts`

**Interfaces:**
- Consumes Tasks 2, 5, and 6 domain functions.
- Produces commands for dimension override/restore, policy update, suggestion recalculation, and optional complete auto application.

- [ ] **Step 1: Add failing input-security and behavior tests**

Reject client-supplied:

- converted provider costs;
- suggested rate cards;
- pricing policy versions;
- calculated/synced timestamps;
- upstream values;
- raw pricing snapshots.

Accept only commands such as:

```ts
type ProviderDimensionCommand =
    | { action: "set_manual"; bindingId: string; dimensionId: string; effectiveValue: string }
    | { action: "restore_upstream"; bindingId: string; dimensionId: string };
```

Pin that auto apply rejects incomplete suggestions and that default false never alters `saleRateCard`.

- [ ] **Step 2: Run route/service tests and verify they fail**

```bash
cd web
npm test -- --run src/lib/server/admin-model-pricing-service.test.ts src/app/api/admin/billing/model-pricing/route.test.ts src/lib/server/admin-pricing-policy-service.test.ts src/app/api/admin/settings/route.test.ts
```

- [ ] **Step 3: Implement dimension commands atomically inside settings mutation**

Resolve model and binding server-side, validate the dimension ID, apply the command, regenerate `costRateCard`, regenerate the logical-model suggestion, and return a fresh persisted model. A restore command requires a present `upstreamValue`.

- [ ] **Step 4: Implement policy update and whole-catalog recalculation**

Normalize administrator-editable fields, preserve server-managed currency sync fields, generate the new policy version, then recalculate every provider cost projection and logical-model suggestion in one settings mutation.

- [ ] **Step 5: Implement guarded auto application**

Only write suggestion `rateCard` into `saleRateCard` when all are true:

- `autoApplySalePrice=true`;
- suggestion is complete;
- every contributing dimension is executable;
- no stale/needs-review/incomparable warning;
- minimum margin validation passes;
- model sale source is not manual.

Manual sale prices remain unchanged and receive drift/below-cost warnings.

- [ ] **Step 6: Add audit metadata without API keys**

For saved changes, pass compact metadata to the existing audit service: model/binding/dimension IDs, old/new values, sources, policy version, and warning codes. Never include raw API responses or secrets.

- [ ] **Step 7: Run API, concurrency, settings-cache, and type tests**

```bash
cd web
npm test -- --run src/lib/server/admin-model-pricing-service.test.ts src/lib/server/admin-model-pricing-concurrency.test.ts src/app/api/admin/billing/model-pricing/route.test.ts src/lib/server/admin-pricing-policy-service.test.ts src/app/api/admin/settings/route.test.ts
npm run typecheck
```

If PostgreSQL is configured, run the existing admin pricing concurrency integration test serially:

```bash
npm test -- --run --no-file-parallelism src/lib/server/admin-model-pricing-concurrency.postgres.test.ts
```

- [ ] **Step 8: Review checkpoint without committing**

Confirm read-after-write uses fresh settings and no client-derived financial fields are trusted.

---

### Task 8: Admin UI for Policy, Provider Dimensions, Suggestions, and Sync Summary

**Files:**
- Modify: `web/src/app/admin/billing/components/billing-operations.tsx:430-560` and its pricing editor section
- Modify: `web/src/components/admin/admin-system-channel-editor.tsx`
- Modify: `web/src/components/admin/channels/admin-channel-detail-drawer.tsx`
- Modify: `web/src/components/admin/admin-generation-settings.dom.test.tsx`
- Modify: `web/src/services/api/admin-billing-commerce.ts`
- Modify: `web/src/i18n/messages/zh-CN.json`
- Modify: `web/src/i18n/messages/en.json`
- Modify: `web/src/i18n/messages/vi.json`

**Interfaces:**
- Consumes typed admin pricing models, policy, warnings, and sync stats from Task 7.
- Emits only manual-dimension commands, formal sale-rate edits, and allowed policy fields.

- [ ] **Step 1: Add failing DOM tests for pricing policy and model pricing**

Assert the rendered UI displays:

- DFLOP credits/CNY value, source, last sync;
- CNY/USD, HOTX USD/credit, markup, minimum margin, cost basis;
- auto apply default off and explanatory break-even copy for markup 1;
- provider raw/effective values by dimension;
- upstream/manual badges;
- restore-upstream action;
- suggested/formal sale prices and policy version;
- stale, needs review, drift, and below-cost alerts.

Use a mixed profile with manual 720p and upstream 1080p.

- [ ] **Step 2: Run the DOM tests and verify the new controls are absent**

```bash
cd web
npm test -- --run src/components/admin/admin-generation-settings.dom.test.tsx
```

- [ ] **Step 3: Implement the compact pricing policy form**

Use the existing billing settings workflow and compact grid conventions. Keep secret-free read models. Show `minimumMarginRate=null` as “未设置” and `markupMultiplier=1` as “成本基准建议价”.

- [ ] **Step 4: Expand the logical-model pricing editor**

Render dimension rows with original DFLOP credits, converted HOTX cost, source, timestamps, manual edit, and restore. Keep formal sale-price editing visually separate from provider cost and suggestion.

- [ ] **Step 5: Add channel sync statistics**

After “拉取模型”, show live counts returned by the API. Do not hard-code any model or pricing counts. Preserve existing model/capability sync summaries.

- [ ] **Step 6: Add Chinese copy and complete touched translations**

Add matching keys to all three locale files. Keep terminology consistent:

```text
上游成本 / 建议售价 / 正式售价 / 上游 / 手动 / 价格漂移 / 价格已过期 / 售价低于成本
```

- [ ] **Step 7: Run DOM tests, API client tests, translation checks, and typecheck**

```bash
cd web
npm test -- --run src/components/admin/admin-generation-settings.dom.test.tsx src/services/api/admin-billing-commerce.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 8: Review checkpoint without committing**

Run `git diff --check` and inspect responsive classes against AGENTS.md drawer/form constraints.

---

### Task 9: Audit History and Sync Statistics Integration

**Files:**
- Modify: `web/src/lib/server/audit-log-store.ts`
- Modify: `web/src/lib/server/database/audit-log-repository.ts`
- Modify: `web/src/app/api/admin/models/route.ts`
- Modify: `web/src/lib/server/admin-model-pricing-service.ts`
- Modify: relevant audit repository/service tests

**Interfaces:**
- Consumes domain change sets from Tasks 4-7.
- Produces price-change audit records and final `DflopPricingSyncStats` without adding a new database table.

- [ ] **Step 1: Add failing audit tests**

Pin one increase, one decrease, one unchanged dimension, one missing price, one unknown field, one manual override, and one below-cost warning. Assert audit metadata contains old/new/source/policy version and excludes API keys and complete raw payloads.

- [ ] **Step 2: Run audit tests and verify missing pricing actions fail**

```bash
cd web
npm test -- --run src/lib/server/database/audit-log-repository.test.ts src/lib/server/admin-model-pricing-service.test.ts src/app/api/admin/models/route.test.ts
```

- [ ] **Step 3: Add pricing audit actions through the existing generic audit API**

Use action names:

```text
admin.billing.dflop_pricing.sync
admin.billing.provider_price.override
admin.billing.provider_price.restore
admin.billing.pricing_policy.update
admin.billing.sale_price.auto_apply
```

Keep one sync summary audit plus bounded per-dimension change metadata. Do not create an unbounded row for unchanged dimensions.

- [ ] **Step 4: Finalize sync statistics from actual change sets**

Calculate increases/decreases with Decimal comparison after matching canonical dimensions. `belowCostWarnings` comes from Task 6 diagnostics.

- [ ] **Step 5: Run audit, route, and type tests**

```bash
cd web
npm test -- --run src/lib/server/database/audit-log-repository.test.ts src/lib/server/admin-model-pricing-service.test.ts src/app/api/admin/models/route.test.ts
npm run typecheck
```

- [ ] **Step 6: Review checkpoint without committing**

Inspect logs and audit metadata for secrets, excessive payload size, and deterministic counts.

---

### Task 10: Full Regression, Browser Acceptance, Release Checks, and Final Report

**Files:**
- Modify only when a concrete regression requires it: existing focused test/fixture files
- Modify: `web/e2e/core.spec.ts` for DFLOP pricing browser acceptance
- Modify: `CHANGELOG.md`, `VERSION`, and progress documents only if required by the repository release gate and consistent with the current uncommitted DFLOP work

**Interfaces:**
- Consumes the completed feature.
- Produces verified acceptance evidence and the user-requested final audit report.

- [ ] **Step 1: Add browser acceptance coverage**

Use normal semantic clicks to verify:

- DFLOP sync shows dynamic model/pricing counts;
- Seedance 2.5 shows raw DFLOP tiers and converted HOTX costs;
- 720p can be manual while 1080p remains upstream;
- restore-upstream changes only the selected dimension;
- suggested price shows `max_active_binding_cost` and policy version;
- markup 1 displays break-even semantics;
- auto apply is off by default;
- below-cost and stale warnings are readable;
- desktop, 390px, and 430px have no horizontal overflow.

- [ ] **Step 2: Run focused DFLOP and pricing suites**

```bash
cd web
npm test -- --run \
  src/lib/dflop-pricing.test.ts \
  src/lib/billing/provider-pricing.test.ts \
  src/lib/billing/pricing-policy.test.ts \
  src/lib/billing/suggested-model-pricing.test.ts \
  src/lib/dflop-model-metadata.test.ts \
  src/lib/server/dflop-pricing-sync-service.test.ts \
  src/lib/server/admin-model-catalog.test.ts \
  src/lib/server/admin-model-pricing-service.test.ts \
  src/app/api/admin/models/route.test.ts \
  src/app/api/admin/billing/model-pricing/route.test.ts
```

- [ ] **Step 3: Run billing regression suites**

```bash
cd web
npm test -- --run \
  src/lib/billing/pricing.test.ts \
  src/lib/server/usage-billing-runtime.test.ts \
  src/lib/server/points-wallet-service.test.ts \
  src/lib/server/generation-task-recovery-service.test.ts \
  src/lib/server/admin-usage-audit-service.test.ts \
  src/app/api/ai/system/\[channelId\]/\[...path\]/route.test.ts
```

Verify hold, settlement, refund, retry/recovery, and usage snapshot expectations are unchanged.

- [ ] **Step 4: Run DFLOP media protocol regressions**

```bash
cd web
npm run test:protocols
```

Confirm existing image/video/TTS/voice clone generation behavior and Seedance request payloads remain unchanged.

- [ ] **Step 5: Run the complete unit suite, typecheck, lint, and production build**

```bash
cd web
npm test -- --run
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 6: Run serial PostgreSQL integration tests when the configured test database is available**

```bash
cd web
npm test -- --run --no-file-parallelism \
  src/lib/server/admin-model-pricing-concurrency.postgres.test.ts \
  src/lib/server/database/postgres.test.ts
```

- [ ] **Step 7: Run Playwright regression**

```bash
cd web
npm run e2e
```

Additionally inspect final element bounds and `scrollWidth` through the browser at desktop, 390px, and 430px.

- [ ] **Step 8: Run release and UTF-8 checks**

```bash
cd web
npm run check:release
```

Strictly decode changed text files as UTF-8 and search for Unicode replacement character `U+FFFD` plus the common three-character mojibake sequence produced by decoding replacement bytes as Chinese text. Resolve only failures caused by this implementation; report unrelated pre-existing release failures separately with exact file names.

- [ ] **Step 9: Produce the requested final report**

Report:

1. Existing price-system structure.
2. Every recognized DFLOP pricing field.
3. Provider-cost storage and conversion.
4. Suggested and formal HOTX sale-price behavior.
5. Auto/manual rules at dimension and sale levels.
6. Long-context rules.
7. Image pricing rules.
8. Video pricing and billing-basis rules.
9. Audio/voice/music/avatar rules.
10. Missing, zero, stale, and unknown behavior.
11. Discount handling.
12. Drift and audit behavior.
13. Below-cost protection.
14. Database changes.
15. Changed files.
16. Test, typecheck, lint, build, release, PostgreSQL, and browser results.
17. Actual Seedance 2.5 sync example, including `224.532 → 0.56133` and the live tiers returned by the fixture/current registry.
18. Confirmation that usage hold, settlement, refund, retry/recovery, and generation payloads were not changed.
19. Remaining unrecognized or non-executable DFLOP pricing dimensions.

- [ ] **Step 10: Final workspace review without committing**

Run:

```bash
git diff --check
git status --short
```

Do not commit, push, or create a PR. Leave the complete diff available for user review.
