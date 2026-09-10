# Task 1 report — HOTX AI identity and empty admin content defaults

## Implementation

- Defined the canonical HOTX AI identity in `web/src/lib/site-brand.ts`:
  `DEFAULT_SITE_TITLE = "HOTX AI"` and logo/icon URLs both `/hx-favicon.png`.
- Replaced populated localized SEO defaults with `EMPTY_LOCALIZED_SEO`.
- Made new site settings content-neutral: empty SEO, footer, Terms/Privacy metadata,
  friend links, social contacts, and mail sender name. SMTP transport defaults remain.
- Removed the VOZEB/QQ friend-link dependency, VOZEB-home normalization special case,
  and title-derived footer normalization. Missing content now remains empty.
- Updated the direct admin SEO constant consumer and all directly affected tests. No
  raster asset behavior was added; `web/public/hx-favicon.png` remains untracked and
  untouched for Task 2.

## Files changed

- `web/src/lib/site-brand.ts`
- `web/src/lib/auth/store-foundation.ts`
- `web/src/lib/auth/store-types.ts`
- `web/src/lib/auth/store-normalizers.ts`
- `web/src/i18n/site-copy.ts`
- `web/src/i18n/site-copy.test.ts`
- `web/src/lib/auth/site-settings.test.ts`
- `web/src/lib/auth/localized-seo-settings.test.ts`
- `web/src/components/admin/admin-configuration-sections.tsx` — direct renamed-export consumer only.
- `web/src/app/site-brand-assets.test.ts`, `web/src/lib/auth/store-first-admin.test.ts`, and
  `web/src/lib/server/site-metadata.test.ts` — direct old-default expectation updates only.

## TDD evidence

RED command (run from `web`):

```bash
PATH=/opt/homebrew/bin:$PATH pnpm exec vitest run src/lib/auth/site-settings.test.ts src/lib/auth/localized-seo-settings.test.ts src/i18n/site-copy.test.ts
```

Relevant RED output:

```text
Test Files  3 failed (3)
Tests  7 failed | 10 passed | 1 skipped (18)
Expected: "HOTX AI"
Received: "VOZEB PRO"
```

GREEN command (run from `web`):

```bash
PATH=/opt/homebrew/bin:$PATH pnpm exec vitest run src/lib/auth/site-settings.test.ts src/lib/auth/localized-seo-settings.test.ts src/i18n/site-copy.test.ts
```

Relevant GREEN output:

```text
Test Files  3 passed (3)
Tests  17 passed | 1 skipped (18)
```

## Verification

```bash
PATH=/opt/homebrew/bin:$PATH node --version
PATH=/opt/homebrew/bin:$PATH pnpm test
PATH=/opt/homebrew/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/bin:$PATH pnpm lint
git diff --check
```

Relevant output:

```text
v26.7.0
Test Files  579 passed | 6 skipped (585)
Tests  2840 passed | 16 skipped (2856)
$ tsc --noEmit --pretty false
$ eslint . --quiet
```

## Self-review

- Confirmed no `DEFAULT_LOCALIZED_SEO`, `normalizeBrandDefault`, QQ default-link import,
  or VOZEB-home special case remains in the Task 1 setting path.
- Confirmed custom localized SEO and friend-link fixtures are explicit, neutral test data
  rather than copies of defaults.
- Confirmed the missing `fromName` normalizer returns the empty default, while SMTP still
  derives a send-time display title without persisting a fallback.
- Confirmed no schema, persistence API, or Task 2 raster file changed.

## Concerns / scope notes

- The Postgres localized-SEO integration test is conditionally skipped unless
  `VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1`; the file-provider round-trip passed.
- Browser E2E was not run: this task changes data defaults and direct test expectations,
  with no layout or browser interaction change. Full Vitest, TypeScript, ESLint, and
  whitespace checks passed.
