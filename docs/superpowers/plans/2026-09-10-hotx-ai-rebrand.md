# HOTX AI Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every user-visible VOZEB PRO/VOZEB brand reference with HOTX AI, use `hx-favicon.png` as the built-in logo everywhere, and remove the three bundled friend links without changing compatibility-sensitive technical namespaces.

**Architecture:** Establish one code-owned brand contract in `web/src/lib/site-brand.ts`, route every web fallback through it, and keep the existing admin overrides intact. Update content-producing runtime code, multilingual SEO, docs and operational output at their sources; remove obsolete VOZEB community defaults/assets; then update the currently running settings through the existing admin persistence path rather than adding migration code.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, next-intl, Ant Design, Vitest, Playwright, Fumadocs, Node.js scripts, PostgreSQL/file settings providers.

**Spec:** `docs/superpowers/specs/2026-09-10-hotx-ai-rebrand-design.md`

## Global Constraints

- The product display name is exactly `HOTX AI`.
- The built-in logo and browser icon are exactly `/hx-favicon.png`.
- Preserve environment variables with `VOZEB_PRO_*`, database/storage/cookie namespaces with `vozeb_pro` or `VOZEB_PRO`, Docker/package/repository slugs, and real repository URLs containing `csyqlz/VOZEB-PRO`.
- Preserve the protocol ID `vozeb-recommended` and generation constant identifiers such as `VOZEB_IMAGE_ASPECT_RATIOS`; only their user-visible labels become HOTX AI.
- Keep admin customization for title, logo, icon and friend links; remove only the three bundled/current friend-link records.
- Do not add a schema migration, compatibility branch or dependency upgrade.
- Treat `web/public/hx-favicon.png` and the user-owned working-tree removal of `web/public/hotx-favicon0.png` as input; never regenerate or alter the supplied pixels.
- Source, configuration and documentation containing Chinese must remain strict UTF-8.

---

### Task 1: Define the HOTX AI brand contract and empty friend-link defaults

**Files:**
- Modify: `web/src/lib/site-brand.ts`
- Modify: `web/src/lib/auth/store-foundation.ts`
- Modify: `web/src/lib/auth/store-types.ts`
- Modify: `web/src/lib/auth/store-normalizers.ts`
- Modify: `web/src/lib/auth/site-settings.test.ts`

**Interfaces:**
- Produces: `DEFAULT_SITE_TITLE: "HOTX AI"`, `DEFAULT_SITE_LOGO_URL: "/hx-favicon.png"`, and `DEFAULT_SITE_ICON_URL: "/hx-favicon.png"` from `@/lib/site-brand`.
- Produces: `DEFAULT_SITE_SETTINGS.friendLinks` as `[]` while retaining `SiteFriendLink[]` and `normalizeSiteFriendLinks()` for future admin entries.
- Consumes: existing `SiteSettings`, `LocalizedSeoSettings`, `normalizeSiteSettings()` and settings persistence contracts unchanged.

- [ ] **Step 1: Write failing default-brand tests**

Add assertions that express the new contract and remove assertions that require the old VOZEB links:

```ts
import { DEFAULT_SITE_ICON_URL, DEFAULT_SITE_LOGO_URL, DEFAULT_SITE_TITLE } from "@/lib/site-brand";

expect(DEFAULT_SITE_TITLE).toBe("HOTX AI");
expect(DEFAULT_SITE_LOGO_URL).toBe("/hx-favicon.png");
expect(DEFAULT_SITE_ICON_URL).toBe("/hx-favicon.png");
expect(DEFAULT_SITE_SETTINGS).toMatchObject({
    title: "HOTX AI",
    logoUrl: "/hx-favicon.png",
    iconUrl: "/hx-favicon.png",
    footerCopyright: "© 2026 HOTX AI. All rights reserved.",
});
expect(normalizeSiteSettings({}).friendLinks).toEqual([]);
```

Keep the customized friend-link round-trip coverage by using a neutral record:

```ts
const customLink = { id: "partner", label: "合作伙伴", url: "https://example.com/", enabled: true };
expect(normalizeSiteSettings({ friendLinks: [customLink] }).friendLinks).toEqual([customLink]);
```

- [ ] **Step 2: Run the tests to verify the old defaults fail**

Run:

```bash
cd web
pnpm exec vitest run src/lib/auth/site-settings.test.ts
```

Expected: FAIL because the current title is `VOZEB PRO`, the logo/icon use SVG files, and three default friend links are still installed.

- [ ] **Step 3: Implement the shared constants and new defaults**

Change `site-brand.ts` to:

```ts
export const DEFAULT_SITE_TITLE = "HOTX AI";
export const DEFAULT_SITE_LOGO_URL = "/hx-favicon.png";
export const DEFAULT_SITE_ICON_URL = DEFAULT_SITE_LOGO_URL;

export function resolveSiteTitle(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SITE_TITLE;
}
```

Use these constants in `DEFAULT_SITE_SETTINGS`, set `DEFAULT_MAIL_SETTINGS.fromName` to `HOTX AI`, and set the footer copyright to `© 2026 HOTX AI. All rights reserved.`. Define:

```ts
export const DEFAULT_SITE_FRIEND_LINKS: SiteFriendLink[] = [];
```

Remove the QQ constant import and delete the VOZEB-home special case from `normalizeSiteFriendLinks()` so it remains a generic normalizer:

```ts
export function normalizeSiteFriendLinks(settings: unknown): SiteFriendLink[] {
    const links = Array.isArray(settings) ? settings : DEFAULT_SITE_FRIEND_LINKS;
    return links
        .map((link, index) => {
            const value = link as Partial<SiteFriendLink>;
            return {
                id: normalizeText(value.id, `friend-${index + 1}`, 80),
                label: normalizeText(value.label, "友情链接", 32),
                url: normalizeLinkUrl(value.url, ""),
                enabled: value.enabled !== false,
            };
        })
        .filter((link) => link.url)
        .slice(0, 12);
}
```

Change the footer repair literal to HOTX AI; do not retain a VOZEB compatibility branch.

- [ ] **Step 4: Run the focused settings tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add web/src/lib/site-brand.ts web/src/lib/auth/store-foundation.ts web/src/lib/auth/store-types.ts web/src/lib/auth/store-normalizers.ts web/src/lib/auth/site-settings.test.ts
git commit -m "feat(brand): define HOTX AI defaults"
```

---

### Task 2: Use the supplied PNG across web logo, favicon and metadata fallbacks

**Files:**
- Add: `web/public/hx-favicon.png`
- Add: `docs/public/hx-favicon.png`
- Delete: `web/public/hotx-favicon0.png`
- Modify: `web/src/components/layout/site-logo.tsx`
- Modify: `web/src/components/layout/site-logo.test.tsx`
- Modify: `web/src/app/site-brand-assets.test.ts`
- Modify: `web/src/app/api/site-icon/route.ts`
- Modify: `web/src/lib/server/site-metadata.ts`
- Modify: `web/src/app/site-metadata-routes.test.ts`
- Modify: `web/scripts/standalone-assets.mjs`
- Modify: `web/scripts/release-check.test.mjs`
- Modify: `web/src/stores/use-public-session-store.ts`
- Modify: `web/src/components/media/lazy-media-image.tsx`
- Modify: `web/src/app/[locale]/layout.tsx`
- Modify: `web/src/app/share/[slug]/page.tsx`
- Modify: `web/src/app/u/[username]/page.tsx`
- Modify: `web/src/app/gallery/page.tsx`
- Modify: `web/src/app/home/home-actions.tsx`
- Modify: `web/src/components/admin/admin-configuration-sections.tsx`
- Modify: `web/src/components/admin/admin-site-preview.tsx`
- Modify: `web/src/components/admin/admin-help-guidance.ts`
- Modify: `web/src/components/admin/admin-help-content.ts`
- Modify: `web/src/components/admin/admin-section-nav.tsx`
- Modify: `web/src/components/layout/app-workspace-shell.tsx`
- Modify: `web/src/components/layout/mobile-nav-drawer.tsx`
- Modify: `web/src/components/layout/app-sidebar.tsx`
- Modify: `web/src/components/auth/auth-form.tsx`
- Modify: `web/src/app/(user)/create/components/creative-messages.tsx`
- Modify: `web/src/app/(user)/drama/[id]/drama-agent-panel.tsx`
- Modify: `web/src/app/(user)/me/page.tsx`
- Modify: `web/src/app/admin/works/components/admin-works-section.tsx`
- Modify: `web/e2e/canvas.spec.ts`
- Modify: `web/e2e/installation.spec.ts`
- Modify: `web/src/app/api/auth/session/route.test.ts`
- Modify: `web/src/app/home-metadata.test.ts`
- Modify: `web/src/app/install-routing.test.tsx`
- Modify: `web/src/components/auth/auth-legal-links.test.tsx`
- Modify: `web/src/lib/server/install-status.test.ts`
- Modify: `web/src/lib/server/site-metadata.test.ts`
- Modify: `web/src/lib/structured-data.test.ts`
- Modify: `web/src/app/home/home-brand-links.test.tsx`

**Interfaces:**
- Consumes: the three constants from Task 1.
- Produces: `SiteLogo` always renders a raster `<img>` and falls back from a failed custom URL to `DEFAULT_SITE_LOGO_URL`.
- Produces: `browserIconHref()` and `/api/site-icon` return the configured icon when valid and `/hx-favicon.png` for the built-in fallback.

- [ ] **Step 1: Write failing component, asset and metadata tests**

Replace the mask-based test with:

```tsx
const markup = renderToStaticMarkup(<SiteLogo logoUrl="/hx-favicon.png" className="size-8" />);
expect(markup).toContain('src="/hx-favicon.png"');
expect(markup).toContain('class="shrink-0 object-contain size-8"');
expect(markup).not.toContain("mask:");
```

In `site-brand-assets.test.ts`, read both PNG files as buffers and assert byte equality and the PNG signature:

```ts
const [webLogo, docsLogo] = await Promise.all([
    readFile(resolve(process.cwd(), "public/hx-favicon.png")),
    readFile(resolve(process.cwd(), "../docs/public/hx-favicon.png")),
]);
expect(webLogo.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
expect(docsLogo.equals(webLogo)).toBe(true);
```

Update favicon-route expectations to `/hx-favicon.png`, including the loop fallback case.

In `home-brand-links.test.tsx`, compare the published/unpublished brand using `img[src="/hx-favicon.png"]` and its class name instead of querying the removed `aria-hidden` mask span.

- [ ] **Step 2: Run focused tests and observe failure**

```bash
cd web
pnpm exec vitest run src/components/layout/site-logo.test.tsx src/app/home/home-brand-links.test.tsx src/app/site-brand-assets.test.ts src/app/site-metadata-routes.test.ts src/lib/server/site-metadata.test.ts
```

Expected: FAIL because `SiteLogo` still emits an SVG mask and metadata still falls back to `/icon.svg`.

- [ ] **Step 3: Implement the raster logo and central fallbacks**

Use this behavior in `SiteLogo`:

```tsx
const configuredLogoUrl = logoUrl.trim() || DEFAULT_SITE_LOGO_URL;
const source = failedLogoUrl === configuredLogoUrl ? DEFAULT_SITE_LOGO_URL : configuredLogoUrl;

return (
    <img
        src={source}
        alt=""
        className={cn("shrink-0 object-contain", className)}
        referrerPolicy="no-referrer"
        onError={() => setFailedLogoUrl(configuredLogoUrl)}
    />
);
```

Copy the supplied PNG byte-for-byte into `docs/public/hx-favicon.png`. Replace runtime `/logo.svg` and `/icon.svg` fallbacks with the constants from Task 1. Keep `/favicon.ico` as the standards-compatible public route that rewrites to `/api/site-icon`; change the final route fallback to `DEFAULT_SITE_ICON_URL`.

Change standalone asset validation from `logo.svg`/`icon.svg` to `hx-favicon.png`, and update the standalone-copy test accordingly.

- [ ] **Step 4: Prove the web runtime has no old asset consumer**

Run:

```bash
git grep -n -E '/logo\.svg|/icon\.svg|public/logo\.svg|public/icon\.svg' -- web/src web/scripts
```

Expected: no output. The three old SVG files remain until Task 6 updates repository/docs references and proves the whole repository is clean. Preserve and include the user's existing deletion of `web/public/hotx-favicon0.png`.

- [ ] **Step 5: Run focused tests and static checks**

```bash
cd web
pnpm exec vitest run src/components/layout/site-logo.test.tsx src/app/home/home-brand-links.test.tsx src/app/site-brand-assets.test.ts src/app/site-metadata-routes.test.ts src/lib/server/site-metadata.test.ts scripts/release-check.test.mjs
pnpm run typecheck
```

Expected: all tests and typecheck PASS.

- [ ] **Step 6: Commit the asset migration**

```bash
git add web/public docs/public web/src web/scripts/standalone-assets.mjs web/scripts/release-check.test.mjs
git commit -m "feat(brand): adopt HOTX AI logo assets"
```

---

### Task 3: Rebrand multilingual SEO, authentication and public copy

**Files:**
- Modify: `web/src/i18n/site-copy.ts`
- Modify: `web/src/i18n/messages/vi.json`
- Modify: `web/src/i18n/messages/en.json`
- Modify: `web/src/i18n/messages/zh-CN.json`
- Modify: `web/src/app/home-metadata.test.ts`
- Modify: `web/src/app/api/auth/session/route.test.ts`
- Modify: `web/src/app/install-routing.test.tsx`
- Modify: `web/src/lib/auth/session.test.ts`
- Modify: `web/src/lib/auth/consume-email-code.test.ts`
- Modify: `web/src/lib/auth/postgres-auth-settings-service.test.ts`
- Modify: `web/src/app/api/admin/settings/route.test.ts`
- Modify: `web/src/lib/server/zalopay-payment-provider.test.ts`
- Modify: `web/e2e/all-pages.spec.ts`
- Modify: `web/e2e/core.spec.ts`

**Interfaces:**
- Consumes: existing `DEFAULT_LOCALIZED_SEO`, message catalog keys, localized route metadata and `DEFAULT_SITE_TITLE`.
- Produces: locale-native HOTX AI title, description and keywords for `vi`, `en` and `zh-CN`, without cross-locale fallback.

- [ ] **Step 1: Add failing localized-copy assertions**

Extend the existing localized SEO test with:

```ts
expect(DEFAULT_LOCALIZED_SEO.vi.title).toContain("HOTX AI");
expect(DEFAULT_LOCALIZED_SEO.en.description).toContain("HOTX AI");
expect(DEFAULT_LOCALIZED_SEO["zh-CN"].keywords).toContain("HOTX AI");
expect(JSON.stringify(DEFAULT_LOCALIZED_SEO)).not.toContain("VOZEB");
```

Update the existing home metadata and auth/install fixtures to expect `HOTX AI` headings and titles. Replace social-normalization fixtures such as `vozeb_group`, `@vozeb_pro` and `vozeb.pro` with neutral `hotx_ai`, `@hotx_ai` and `hotx.ai` test values while preserving the same normalization assertions.

- [ ] **Step 2: Run the public-copy tests to confirm failure**

```bash
cd web
pnpm exec vitest run src/lib/auth/localized-seo-settings.test.ts src/app/home-metadata.test.ts src/app/api/auth/session/route.test.ts src/app/install-routing.test.tsx src/lib/auth/session.test.ts src/lib/auth/consume-email-code.test.ts src/lib/auth/postgres-auth-settings-service.test.ts src/app/api/admin/settings/route.test.ts
```

Expected: FAIL on the old product name.

- [ ] **Step 3: Replace the locale-native brand copy**

Use these exact defaults:

```ts
vi: {
    title: "HOTX AI - Nền tảng tạo ảnh, video và giọng nói bằng AI",
    description: "HOTX AI là nền tảng sáng tạo AI giúp bạn tạo ảnh, video, giọng nói, nhân bản giọng nói và sử dụng AI Agent trong một quy trình thống nhất.",
    keywords: "HOTX AI,AI Agent,hình ảnh AI,video AI,Canvas,phim ngắn,thư viện prompt,quản lý tài nguyên",
},
en: {
    title: "HOTX AI - AI image, video and voice creation",
    description: "HOTX AI is a unified AI creation platform for images, video, voice, voice cloning, and AI Agent workflows.",
    keywords: "HOTX AI,AI Agent,AI image,AI video,Canvas,short drama,prompt library,asset management",
},
"zh-CN": {
    title: "HOTX AI - AI 图片、视频与语音创作",
    description: "HOTX AI 是统一的 AI 创作平台，支持图片、视频、语音、声音克隆与 AI Agent 工作流。",
    keywords: "HOTX AI,AI Agent,AI 绘图,AI 视频,画布,短剧,提示词库,素材管理",
},
```

Update `footerDefaultKeywords` in all three catalogs. Task 5 owns removal of the obsolete QQ localization key and special footer branch. Update exact default-name fixtures and Playwright headings to HOTX AI; leave tests intentionally exercising arbitrary custom brands unchanged.

- [ ] **Step 4: Run localized and metadata tests**

```bash
cd web
pnpm exec vitest run src/lib/auth/localized-seo-settings.test.ts src/app/home-metadata.test.ts src/app/api/auth/session/route.test.ts src/app/install-routing.test.tsx src/lib/auth/session.test.ts src/lib/auth/consume-email-code.test.ts src/lib/auth/postgres-auth-settings-service.test.ts src/app/api/admin/settings/route.test.ts src/app/seo-landings/seo-landing-metadata.test.ts
```

Expected: PASS, including catalog completeness and localized metadata assertions.

- [ ] **Step 5: Commit public copy**

```bash
git add web/src/i18n web/src/app web/src/lib/auth web/src/lib/server/zalopay-payment-provider.test.ts web/e2e/all-pages.spec.ts web/e2e/core.spec.ts
git commit -m "feat(brand): publish HOTX AI localized copy"
```

---

### Task 4: Rebrand content-producing agents, protocol labels, backups and CLI output

**Files:**
- Modify: `web/src/lib/server/agent-run-surface-policy.ts`
- Modify: `web/src/lib/server/agent-run-executor.test.ts`
- Modify: `web/src/lib/server/agent-skill-import-refiner.ts`
- Modify: `web/src/lib/server/agent-skills/ecommerce-image.ts`
- Modify: `web/src/lib/server/agent-skills/yanai-beauty.ts`
- Modify: `web/src/lib/server/creative-review-service.ts`
- Modify: `web/src/lib/server/prompt-optimization-service.ts`
- Modify: `web/src/components/admin/admin-logical-model-manager.tsx`
- Modify: `web/src/components/admin/admin-generation-settings.dom.test.tsx`
- Modify: `web/src/lib/channel-example-parser.ts`
- Modify: `web/src/lib/channel-protocol-registry.ts`
- Modify: `web/src/lib/channel-protocol-registry.test.ts`
- Modify: `web/src/lib/vozeb-recommended-video.test.ts`
- Modify: `web/scripts/protocol-fixture-server.mjs`
- Modify: `web/scripts/protocol-fixture-server.test.mjs`
- Modify: `web/src/app/api/admin/backup/export/route.ts`
- Modify: `web/scripts/disaster-backup.mjs`
- Modify: `web/scripts/disaster-restore.mjs`
- Modify: `web/scripts/disaster-recovery-core.mjs`
- Modify: `web/scripts/disaster-recovery-core.test.mjs`
- Modify: `web/scripts/release-check.mjs`
- Modify: `web/scripts/reset-admin-mfa.mjs`
- Modify: `web/scripts/reset-admin-password.mjs`

**Interfaces:**
- Preserves: protocol value `vozeb-recommended`, `VOZEB_*` generation constants and `VOZEB_PRO_*` environment variables.
- Produces: display label `HOTX AI 推荐`; agent/system text identifies itself as HOTX AI; new disaster manifests require `app: "HOTX AI"`.

- [ ] **Step 1: Update tests first to require HOTX AI output**

Use exact assertions in the existing suites:

```ts
expect(registryEntry).toMatchObject({ value: "vozeb-recommended", label: "HOTX AI 推荐" });
expect(backupManifest.app).toBe("HOTX AI");
expect(systemPrompt).toContain("HOTX AI");
expect(systemPrompt).not.toContain("VOZEB PRO");
```

Rename test descriptions from “VOZEB recommended” to “HOTX AI recommended” without renaming the technical protocol file or protocol ID.

- [ ] **Step 2: Run focused tests to verify failure**

```bash
cd web
pnpm exec vitest run src/lib/channel-protocol-registry.test.ts src/lib/vozeb-recommended-video.test.ts src/lib/server/agent-run-executor.test.ts src/components/admin/admin-generation-settings.dom.test.tsx scripts/protocol-fixture-server.test.mjs scripts/disaster-recovery-core.test.mjs
```

Expected: FAIL on old display labels, prompt content and disaster manifest value.

- [ ] **Step 3: Replace product-facing literals without renaming contracts**

Change agent role strings to forms such as:

```ts
"你是 HOTX AI 画布创作 Agent，也能进行普通对话。"
"你是 HOTX AI 短剧项目创作 Agent，负责围绕当前项目规划文本、图片、视频和音频产物，也能进行普通对话。"
"你是 HOTX AI 统一创作 Agent，负责通过一个对话入口规划并生成文本、图片、视频和音频产物，也能进行普通对话。"
```

Change admin/protocol copy to `HOTX AI 当前选项`, `HOTX AI 推荐` and `HOTX AI 推荐的 JSON 异步视频协议`. Change disaster manifest writers and validators to `app: "HOTX AI"`. Change CLI headings to `HOTX AI 发布前检查通过`, `HOTX AI 管理员 MFA 恢复` and `HOTX AI 管理员密码重置`.

Do not rename `vozeb-recommended`, `VOZEB_VIDEO_RESOLUTIONS`, `__VOZEB_TASK_PARAMETER__`, environment variables or file names representing those technical contracts.

- [ ] **Step 4: Run focused tests and typecheck**

Run the command from Step 2, then:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit runtime output changes**

```bash
git add web/src/lib/server web/src/lib/channel-example-parser.ts web/src/lib/channel-protocol-registry.ts web/src/lib/channel-protocol-registry.test.ts web/src/lib/vozeb-recommended-video.test.ts web/src/components/admin web/src/app/api/admin/backup/export/route.ts web/scripts
git commit -m "feat(brand): rebrand runtime and operations output"
```

---

### Task 5: Remove the bundled VOZEB friend links and community entry points

**Files:**
- Delete: `web/src/constant/community.ts`
- Modify: `web/src/components/admin/admin-update-center.tsx`
- Modify: `web/src/lib/auth/site-settings.test.ts`
- Modify: `web/e2e/core.spec.ts`
- Modify: `web/src/app/home/home-footer.tsx`
- Modify: `web/src/i18n/site-copy.ts`
- Modify: `web/src/i18n/messages/vi.json`
- Modify: `web/src/i18n/messages/en.json`
- Modify: `web/src/i18n/messages/zh-CN.json`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/src/lib/layout.shared.tsx`
- Modify: `docs/content/docs/support/community.mdx`
- Delete: `docs/public/community/qq-vozeb-group-1049777515.webp`
- Rename: `docs/public/community/sponsor-vozeb.webp` → `docs/public/community/sponsor.webp`
- Modify: `docs/content/docs/support/donate.mdx`

**Interfaces:**
- Consumes: empty defaults from Task 1.
- Preserves: admin add/edit/delete APIs and footer conditional rendering for administrator-created links.
- Produces: no bundled demo-site, QQ-group or Linux.do link; no QQ-group entry in admin update center or docs navigation.

- [ ] **Step 1: Add failing regression assertions for empty defaults and generic custom links**

In `site-settings.test.ts` assert:

```ts
expect(DEFAULT_SITE_SETTINGS.friendLinks).toEqual([]);
expect(normalizeSiteSettings({}).friendLinks).toEqual([]);
```

Keep the existing E2E save/delete/refresh scenario, but initialize it from `friendLinks: []` and add only its temporary `https://example.com` test link. It must still prove that deleting a custom link persists.

- [ ] **Step 2: Remove community-only UI and content**

Delete the QQ import, `UsersRound` icon and “加入 QQ 群” action from `admin-update-center.tsx`. Delete `community.ts` after this leaves no imports.

Delete the `qq-vozeb-open-source` conditional from `home-footer.tsx`, remove `builtInSiteCopy.qqGroupLabel`, and remove `footerQqGroupLabel` from all three message catalogs. Keep generic friend-link labels unchanged.

Remove the `www.vozeb.com` demo link and QQ group table/copy from README, and remove the QQ invitation paragraph from CONTRIBUTING. Remove `qqGroupUrl` and its menu link from `docs/src/lib/layout.shared.tsx`.

Rewrite `community.mdx` to retain only neutral acknowledgements and participation guidance under HOTX AI; remove the entire QQ section and personal QQ-group sponsorship sentence. Delete the QR asset. Rename the donation image to `sponsor.webp` and update its only `src` reference.

- [ ] **Step 3: Verify no removed community endpoint remains**

```bash
git grep -n -E 'qm\.qq\.com/q/9MVLTxuRd6|1049777515|www\.vozeb\.com|qq-vozeb-group|VOZEB_QQ_GROUP_URL|sponsor-vozeb' -- . ':!docs/superpowers/specs/2026-09-10-hotx-ai-rebrand-design.md'
```

Expected: no output. Repository URLs under `github.com/csyqlz/VOZEB-PRO` are not part of this removal.

- [ ] **Step 4: Run friend-link tests**

```bash
cd web
pnpm exec vitest run src/lib/auth/site-settings.test.ts src/components/admin/admin-generation-settings.dom.test.tsx
pnpm exec playwright test e2e/core.spec.ts --grep "friend links"
```

Expected: PASS; the admin remains capable of adding and deleting a new link, and deleted defaults do not return.

- [ ] **Step 5: Commit community cleanup**

```bash
git add README.md CONTRIBUTING.md docs web/src/constant/community.ts web/src/components/admin/admin-update-center.tsx web/src/lib/auth/site-settings.test.ts web/e2e/core.spec.ts
git commit -m "feat(brand): remove legacy friend links"
```

---

### Task 6: Rebrand the documentation site and repository-facing prose

**Files:**
- Modify: `.env.example`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/workflows/README.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `CLA.md`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `web/README.md`
- Modify: `docs/README.md`
- Modify: `docs/index.md`
- Modify: `docs/src/lib/shared.ts`
- Modify: `docs/src/app/layout.tsx`
- Modify: `docs/src/app/robots.ts`
- Modify: `docs/src/app/sitemap.ts`
- Modify: `docs/src/app/api/site-icon/route.ts`
- Modify: `docs/src/app/(home)/page.tsx`
- Modify: `docs/src/app/docs/page.tsx`
- Modify: `docs/content/docs/backend/backend-database.mdx`
- Modify: `docs/content/docs/backend/local-development.mdx`
- Modify: `docs/content/docs/business/business.mdx`
- Modify: `docs/content/docs/business/commercial-launch.mdx`
- Modify: `docs/content/docs/business/license.mdx`
- Modify: `docs/content/docs/overview/configuration.mdx`
- Modify: `docs/content/docs/overview/docker.mdx`
- Modify: `docs/content/docs/overview/features.mdx`
- Modify: `docs/content/docs/overview/low-memory.mdx`
- Modify: `docs/content/docs/overview/page-gallery.mdx`
- Modify: `docs/content/docs/overview/production-readiness.mdx`
- Modify: `docs/content/docs/overview/project-structure.mdx`
- Modify: `docs/content/docs/overview/quick-start.mdx`
- Modify: `docs/content/docs/overview/render.mdx`
- Modify: `docs/content/docs/overview/third-party-prompt-repositories.mdx`
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `docs/content/docs/support/community.mdx`
- Modify: `docs/content/docs/support/donate.mdx`
- Modify: `docs/progress/page-api-evidence.md`
- Modify: `docs/progress/release-checklist.md`
- Modify: `docs/VOICE_CLONING_INTEGRATION_DESIGN_DFLOP_V2.0.md`
- Rename: `docs/ZaloPay_Integration_Design_VOZEB-PRO_v1.0.md` → `docs/ZaloPay_Integration_Design_HOTX-AI_v1.0.md`
- Delete: `web/public/logo.svg`
- Delete: `web/public/icon.svg`
- Delete: `docs/public/logo.svg`

**Interfaces:**
- Consumes: `docs/public/hx-favicon.png` from Task 2.
- Preserves: real repository URL, tag pattern, image name and environment variable contracts containing `VOZEB-PRO`, `vozeb-pro` or `VOZEB_PRO`.
- Produces: docs metadata, navigation, prose, legal names and alt text consistently identify HOTX AI.

- [ ] **Step 1: Capture failing docs metadata and brand-scan evidence**

The docs package has no test script, so use its production type/build checks plus the repository scan as the executable contract. Before editing, run Task 6 Step 4 and confirm it reports the old product name in docs code and prose. The target metadata values are:

```ts
title: { default: "HOTX AI 文档", template: "%s | HOTX AI 文档" }
authors: [{ name: "HOTX AI Team" }]
creator: "HOTX AI Team"
publisher: "HOTX AI"
openGraph: { siteName: "HOTX AI 文档", images: ["/hx-favicon.png"] }
twitter: { images: ["/hx-favicon.png"] }
```

Before editing, run the brand scan in Step 4 and retain its output as the RED evidence.

- [ ] **Step 2: Rebrand docs application code**

Set:

```ts
export const appName = "HOTX AI";
```

Change docs navigation image and the site-icon fallback to `/hx-favicon.png`. Update layout metadata to the exact HOTX AI values above. Keep `NEXT_PUBLIC_SITE_URL` as the production source of truth and replace the legacy `https://docs.vozeb.pro` fallback in layout, robots and sitemap with `http://localhost:3001`; do not invent an unconfirmed HOTX AI production domain.

- [ ] **Step 3: Rebrand prose and historical records deliberately**

For every product-name occurrence in the listed docs and root governance files, replace the product subject with HOTX AI. In database/deployment prose, produce sentences such as:

```md
HOTX AI 的 PostgreSQL 真实表名继续使用兼容前缀 `vozeb_pro_`。
```

This makes the display brand current while documenting why the old technical prefix remains. Update the AGENTS brand rule to require the HOTX AI logo from `/hx-favicon.png`, and add a CHANGELOG item describing the rebrand and friend-link removal.

Rename the ZaloPay design filename because it is a document title, while retaining any real repository/package identifiers inside code spans. Reword standalone `VOZEB` references in the voice-cloning design to `HOTX AI` without changing field names or environment variables.

- [ ] **Step 4: Run the display-brand audit**

Run:

```bash
git grep -n -I -E 'VOZEB PRO|VOZEB' -- . \
  ':!web/pnpm-lock.yaml' ':!docs/pnpm-lock.yaml' \
  ':!docs/superpowers/specs/2026-09-10-hotx-ai-rebrand-design.md' \
  ':!docs/superpowers/plans/2026-09-10-hotx-ai-rebrand.md'
```

Review every remaining line. Accept only:

- `VOZEB_PRO_*` environment variable or placeholder names.
- `vozeb_pro_*` database/storage/cookie namespaces.
- `VOZEB_*` generation constants and `__VOZEB_TASK_PARAMETER__`.
- `vozeb-recommended` protocol identifiers and technical filenames.
- `VOZEB-PRO` repository/image/tag slugs and real GitHub URLs.

No prose label, title, metadata, email, prompt, footer, alt text or community link may remain on the whitelist.

After the brand scan, run:

```bash
git grep -n -E '/logo\.svg|/icon\.svg|public/logo\.svg|public/icon\.svg' -- web docs README.md AGENTS.md
```

Expected: no output. Delete the three old SVG assets only after this check passes.

- [ ] **Step 5: Validate docs and UTF-8**

```bash
cd docs
pnpm run types:check
pnpm run build
cd ../web
pnpm run format:check
```

Then strictly decode changed text files and fail on replacement/mojibake markers:

```bash
git diff --name-only --diff-filter=ACM | while IFS= read -r file; do
  case "$file" in
    *.ts|*.tsx|*.js|*.mjs|*.json|*.md|*.mdx|*.yml|*.yaml|*.example) iconv -f UTF-8 -t UTF-8 "$file" >/dev/null || exit 1 ;;
  esac
done
git grep -n -I -E '�|锟斤拷' -- . ':!web/pnpm-lock.yaml' ':!docs/pnpm-lock.yaml'
```

Expected: docs typecheck/build PASS, all changed text decodes, and the mojibake scan returns no relevant output.

- [ ] **Step 6: Commit documentation changes**

```bash
git add .env.example .github AGENTS.md CHANGELOG.md CLA.md CONTRIBUTING.md README.md SECURITY.md web/README.md docs
git commit -m "docs(brand): rebrand project as HOTX AI"
```

---

### Task 7: Persist the brand in the currently running admin settings

**Files:**
- No repository schema files.
- Runtime state: existing `app_settings.site` record through `/api/admin/settings`.

**Interfaces:**
- Consumes: existing authenticated admin GET/PATCH settings API, `system.manage` permission, audit log and cache invalidation.
- Produces: current site settings with HOTX AI title/logo/icon/SEO/footer and `friendLinks: []` immediately visible to public Session and metadata APIs.

- [ ] **Step 1: Read current settings without exposing secrets**

Use the already authenticated admin page at `http://localhost:3000/admin?section=site`. Read only the site fields through the UI or the authenticated API response; do not print mail passwords, model keys or payment secrets.

- [ ] **Step 2: Save the current HOTX AI site state through the existing form**

Set these values:

```json
{
  "title": "HOTX AI",
  "logoUrl": "/hx-favicon.png",
  "iconUrl": "/hx-favicon.png",
  "footerCopyright": "© 2026 HOTX AI. All rights reserved.",
  "friendLinks": []
}
```

Set the three SEO tabs to the exact locale-native defaults from Task 3. Preserve unrelated terms/privacy URLs, versions and social settings. If mail sender name is exposed by the same settings form and still equals the old built-in product value, set it to `HOTX AI`; do not alter mail credentials.

- [ ] **Step 3: Verify immediate and durable persistence**

After saving:

1. Confirm the success notification.
2. Re-read the authenticated settings API and public Session/site metadata values.
3. Refresh the admin page and confirm the same title/logo/icon/SEO values and zero friend links.
4. Open `/`, `/en`, `/zh-cn` and verify their metadata uses the saved locale-specific values.

Expected: no wait for cache expiry; the current runtime and refresh both show HOTX AI.

---

### Task 8: Complete browser regression and release verification

**Files:**
- Modify: `web/e2e/all-pages.spec.ts`
- Modify: `web/e2e/core.spec.ts`
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `docs/progress/release-checklist.md`

**Interfaces:**
- Consumes: completed Tasks 1–7.
- Produces: final test evidence and rollout documentation.

- [ ] **Step 1: Run the complete focused brand suite**

```bash
cd web
pnpm exec vitest run \
  src/lib/auth/site-settings.test.ts \
  src/lib/auth/localized-seo-settings.test.ts \
  src/components/layout/site-logo.test.tsx \
  src/app/site-brand-assets.test.ts \
  src/app/site-metadata-routes.test.ts \
  src/app/home-metadata.test.ts \
  src/lib/server/site-metadata.test.ts \
  src/lib/channel-protocol-registry.test.ts \
  src/lib/server/agent-run-executor.test.ts \
  scripts/disaster-recovery-core.test.mjs \
  scripts/release-check.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run desktop and mobile browser checks**

Use Playwright semantic locators, without `force`, fixed waits or arbitrary retries. Verify `/`, `/en`, `/zh-cn`, `/login`, `/register`, `/create`, `/admin?section=site` and the docs homepage at desktop, 390px and 430px:

```ts
await expect(page.getByText("HOTX AI", { exact: true }).first()).toBeVisible();
await expect(page.locator('img[src="/hx-favicon.png"]').first()).toBeVisible();
await expect(page.getByText("VOZEB PRO")).toHaveCount(0);
await expect(page.getByText("VOZEB 开源交流 QQ 群")).toHaveCount(0);
expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
```

Also inspect the logo's `getBoundingClientRect()` and `naturalWidth/naturalHeight`; require non-zero dimensions and equal intrinsic width/height so `object-contain` cannot distort it.

- [ ] **Step 3: Run all quality gates**

```bash
cd web
pnpm run test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run check:release
pnpm run e2e
```

Run the docs checks again if Task 8 changed docs. Record any dependency audit advisories separately; do not change dependencies because this plan forbids unrelated upgrades.

- [ ] **Step 4: Re-run final brand, asset and UTF-8 audits**

Repeat Task 2 Step 4, Task 5 Step 3 and Task 6 Steps 4–5. Expected results:

- no reference to old SVG brand assets;
- no removed friend/community URL or asset;
- only approved technical VOZEB identifiers remain;
- no invalid UTF-8 or mojibake marker.

- [ ] **Step 5: Update readiness evidence and commit**

Record the exact command results, browser widths and any explicitly known external audit blocker in `pending-test.mdx` and `release-checklist.md`.

```bash
git add web/e2e docs/content/docs/progress/pending-test.mdx docs/progress/release-checklist.md
git commit -m "test(brand): record HOTX AI rollout evidence"
```

- [ ] **Step 6: Review the final diff**

```bash
git status --short
git diff HEAD~7 --stat
git log --oneline -10
```

Confirm that no unrelated file changed and that the original user-supplied `hx-favicon.png` bytes were not modified after being added.
