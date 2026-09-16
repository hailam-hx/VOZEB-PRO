# Dependency Security Audit Report

Date: 2026-09-16

## Scope and toolchain

This audit is limited to dependency advisories and the smallest compatibility work required by dependency upgrades. No Agent, billing, generation, provider-routing, or database behavior was changed.

The repository has two independent pnpm workspaces and lockfiles:

- `web`: Node.js 22.23.2, pnpm 11.9.0, `web/package.json`, `web/pnpm-workspace.yaml`, and `web/pnpm-lock.yaml`.
- `docs`: the same Node.js and pnpm runtime, with its own manifest, workspace policy, and lockfile.

The authoritative before/after command for each workspace was `pnpm audit --audit-level=low --json`. The release command audits Web at the repository policy threshold of `moderate`.

## Audit before remediation

| Workspace | Critical | High | Moderate | Total |
| --- | ---: | ---: | ---: | ---: |
| Web | 2 | 3 | 6 | 11 |
| Docs | 2 | 1 | 0 | 3 |

The Docs findings duplicate the Next.js and Sharp advisories also present in Web. Across the repository there were 11 unique advisories and 14 workspace findings.

## Advisory classification

| Advisory/package | Severity | Vulnerable / patched | Classification and top-level introducer | Remediation | Compatibility risk |
| --- | --- | --- | --- | --- | --- |
| Next.js unauthenticated RCE on Windows-hosted servers (`GHSA-p293-qw3h-jr36`) | Critical | `>=16.0.0 <16.3.3` / `>=16.3.3` | Direct production dependency in Web and Docs. Also appears through `@ant-design/nextjs-registry`, `next-intl`, and Fumadocs peer paths. | Web `16.2.12 -> 16.3.3` (minor); Docs `16.3.0 -> 16.3.3` (patch). | Low to moderate: framework minor for Web. Full builds and browser suite required. |
| Next.js Image Optimization AVIF unauthenticated RCE (`GHSA-2xp9-vwfh-vxw4`) | Critical | `>=16.0.0 <16.3.3` / `>=16.3.3` | Same direct production Next.js paths. The image optimization endpoint is a production runtime path. | Same Next.js upgrades. | Low to moderate. |
| Sharp/libheif vulnerabilities (`GHSA-rgj7-g3m4-5g8c`) | High | `<0.35.4` / `>=0.35.4` | Direct production dependency in Web; optional transitive production dependency in Docs through Next.js. Affects server media decoding/optimization paths. | Sharp and workspace overrides `0.35.3 -> 0.35.4` (patch), including native Sharp/libvips packages. | Low, but native binaries and image operations require build/runtime verification. |
| Tiptap Markdown attribute parsing quadratic ReDoS (`GHSA-j95f-988m-3j2f`) | High | `>=3.7.0 <3.30.5` / `>=3.30.5` | Transitive production `@tiptap/core`, introduced by the direct Tiptap editor package set. Affects rich-text/Markdown parsing in editor paths. | All direct Tiptap packages `3.30.4 -> 3.30.5` (patch); bubble/floating menu overrides align the peer graph at `3.30.5`. | Low: coordinated patch release with no API changes observed. |
| js-yaml merge-key CPU exhaustion (`GHSA-2883-xcg3-v3hh`) | High | `>=4.0.0 <4.3.2` / `>=4.3.2` | Transitive, dev-only through ESLint and Shadcn/Cosmiconfig. Not shipped in the production application bundle. | Workspace override `4.3.1 -> 4.3.2` (patch). | Low; lint/config parsing only. |
| Vitest mock redirect path traversal (`GHSA-82fw-gwwq-j7x9`) — `vitest` finding | Moderate | `>=2.1.0 <4.1.11` / `>=4.1.11` | Direct dev dependency. Test runner only. | `4.1.10 -> 4.1.11` (patch). | Low. |
| Vitest mock redirect path traversal (`GHSA-82fw-gwwq-j7x9`) — `@vitest/mocker` finding | Moderate | `>=2.1.0 <4.1.11` / `>=4.1.11` | Transitive dev dependency through Vitest. | Resolved by Vitest patch; all Vitest internal packages moved to `4.1.11`. | Low. |
| baseline-browser-mapping invalid-input process termination (`GHSA-w5vr-8v7q-w6rv`) | Moderate | `>=2.0.0 <2.11.0` / `>=2.11.0` | Transitive production dependency through Next.js. | Removed vulnerable `2.10.40` through the Next.js `16.3.3` upgrade; the remaining resolved browser mapping version is patched. | Low; build-time/browser targeting data. |
| Hono `toSSG()` output traversal incomplete fix (`GHSA-gqvv-2mrq-wpjv`) | Moderate | `<4.13.5` / `>=4.13.5` | Transitive dev-only dependency through `shadcn -> @modelcontextprotocol/sdk`. | Workspace override `4.12.34 -> 4.13.5` (minor). | Low: CLI/dev dependency, not a production server. |
| Hono `parseBody()` unbounded nesting memory exhaustion (`GHSA-g6gw-c38x-mqfc`) | Moderate | `<4.13.5` / `>=4.13.5` | Same transitive dev-only Hono path. | Same Hono override. | Low. |
| Hono URL-fragment query interpretation differential (`GHSA-crvj-82cr-hjcx`) | Moderate | `<4.13.5` / `>=4.13.5` | Same transitive dev-only Hono path. | Same Hono override. | Low. |

`eslint-config-next` was aligned from `16.3.0` to `16.3.3` with the patched Next.js runtime. It was not itself an advisory finding. No major dependency upgrades were required.

## Audit after remediation

| Workspace | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Web | 0 | 0 | 0 | 0 | 0 |
| Docs | 0 | 0 | 0 | 0 | 0 |

`pnpm peers check` also reports no peer-dependency issues. No advisory was suppressed or ignored.

## Files changed

- `web/package.json`, `web/pnpm-workspace.yaml`, and `web/pnpm-lock.yaml`
- `docs/package.json`, `docs/pnpm-workspace.yaml`, and `docs/pnpm-lock.yaml`
- this report

There were no application-code compatibility changes. Lockfile changes are limited to the patched dependency families and their native/peer packages: Next.js/SWC, Sharp/libvips, Tiptap, Vitest, Hono, js-yaml, and the browser mapping resolved by Next.js.

## Verification

| Check | Result |
| --- | --- |
| Web audit at `low` | PASS: 0 advisories |
| Docs audit at `low` | PASS: 0 advisories |
| `pnpm peers check` | PASS |
| Web unit/integration tests | PASS: 596 files passed, 8 skipped; 3,148 tests passed, 20 skipped |
| Protocol suite | PASS: 7 files, 123 tests |
| Web lint | PASS |
| Web format check | PASS |
| Web typecheck | PASS |
| Web production build | PASS: Next.js 16.3.3, 62 static pages |
| Docs typecheck | PASS |
| Docs production build | PASS: Next.js 16.3.3, 36 pages |
| Full Playwright suite | PASS: 218 passed, 25 conditionally skipped across Chromium desktop, 390px, and 430px projects |
| `pnpm --dir web run check:release` | PASS: audit, deployment contracts, protected-path check, lint, format, 3,148 tests, typecheck, isolated build, and standalone artifact validation |

## Production impact

The critical Next.js fixes protect the application and documentation servers, including the image optimization runtime. Sharp updates the server-side image/native codec stack. Tiptap fixes user-controlled rich-text/Markdown parsing. The remaining fixes affect build, lint, CLI, or test tooling. No request contract, persisted data, billing rule, provider protocol, or schema changed.

## Unresolved advisories

None in either pnpm workspace at the `low` audit threshold.

## Rollback

Rollback is limited to reverting the dependency manifests, workspace overrides, and lockfiles together. No database or data migration is involved. Because the previous versions contain critical/high advisories, rollback should only be used to diagnose a concrete incompatibility and should not be deployed to production without an equivalent security patch.
