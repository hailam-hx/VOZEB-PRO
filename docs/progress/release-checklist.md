# HOTX AI 发布检查清单

页面、API Service、Route Handler、服务层、持久层与 E2E 的对应关系见[页面与接口证据矩阵](./page-api-evidence.md)。

发布前先在 `web` 目录执行：

```bash
pnpm run check:release
```

该命令会检查 Prettier、TypeScript、隔离生产构建、补丁空白，以及 `.data`、`.next`、`node_modules` 等运行时文件是否被误提交。

## 2026-09-10 HOTX AI 品牌发布证据

- `cd web && PATH=/opt/homebrew/bin:$PATH pnpm exec vitest run src/lib/auth/site-settings.test.ts src/lib/auth/localized-seo-settings.test.ts src/components/layout/site-logo.test.tsx src/app/site-brand-assets.test.ts src/app/site-metadata-routes.test.ts src/app/home-metadata.test.ts src/lib/server/site-metadata.test.ts src/lib/channel-protocol-registry.test.ts src/lib/server/agent-run-executor.test.ts scripts/disaster-recovery-core.test.mjs scripts/release-check.test.mjs`：exit 0，11 个文件、114 项通过、1 项跳过；缓存参数 RED（`"max"`）为 exit 1、1 项失败/3 项通过/1 项跳过，GREEN（`{ expire: 0 }`）为 exit 0、4 项通过/1 项跳过。
- `cd web && PATH=/opt/homebrew/bin:$PATH pnpm run pree2e && PATH=/opt/homebrew/bin:$PATH pnpm exec playwright test e2e/all-pages.spec.ts --project=chromium --project=mobile-390 --project=mobile-430 --grep 'HOTX AI branding stays visible'`：exit 0，6 项通过；文档首页及 Web 主要入口均验证精确 HOTX AI、可见 `/hx-favicon.png`、非零正方形尺寸、`object-contain`、旧品牌/QQ 文案不存在和无横向溢出。
- `cd web && PATH=/opt/homebrew/bin:$PATH pnpm run build && PATH=/opt/homebrew/bin:$PATH pnpm run pree2e && PATH=/opt/homebrew/bin:$PATH pnpm exec playwright test e2e/seo-landings.spec.ts --project=chromium --project=mobile-390 --project=mobile-430`：exit 0，36 项通过；三语 baseline metadata 已先通过 SSR 精确读取以填充缓存，PATCH configured fixture 后立即验证下一次 `/` SSR 及完整 27 URL。`e2e/home.spec.ts` 的 390px/430px 定向命令（每个 `pnpm` 均使用同一 `PATH`）exit 0，11 项通过。
- `cd web && PATH=/opt/homebrew/bin:$PATH pnpm run test`：exit 0，579 个文件通过、6 个跳过，2,845 项通过、16 项跳过；`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 与 `pnpm run build` 均为 exit 0。`PATH=/opt/homebrew/bin:$PATH pnpm run pree2e && PATH=/opt/homebrew/bin:$PATH pnpm run e2e`：exit 0，197 项通过、25 项项目/环境跳过、0 项失败。
- `cd docs && PATH=/opt/homebrew/bin:$PATH pnpm run types:check && pnpm run build`：均为 exit 0，构建 36 个静态页面。严格 UTF-8/乱码标记、补丁空白、旧 SVG/QQ 端点和产品品牌分类扫描通过；两份 PNG byte-identical，SHA-256 均为 `04e446e8cdb93484435f5b0aed0d2ac7869bf6f9145becb1af1543bb82a3ca19`。
- 发布阻断项：`cd web && PATH=/opt/homebrew/bin:$PATH pnpm run check:release` 为 exit 1，唯一阻断为 11 项既有依赖 advisory（2 critical、3 high、6 moderate）；本轮未升级依赖，应在获批升级后重新执行发布检查。

## 手动页面检查

- 桌面端：首页、统一创作 Agent、画布、短剧、声音管理、提示词库、素材库、管理员后台。
- 手机端：首页导航、统一创作 Agent、画布顶部工具、积分弹窗、短剧生成记录、管理员生成日志、日期选择器。
- 深浅色：首页、画布、弹窗、勾选框、生成中状态、后台表格。

## 数据安全

- 不提交 `web/.data`、`web/.next`、`web/node_modules`、`web/tsconfig.tsbuildinfo`。
- 数据库导入前会保存当前快照，导入快照只保留最近 3 份。
- 管理员密码重置前会备份 `auth.json`，密码重置备份只保留最近 3 份。
- 升级 Docker 镜像时不要执行 `docker compose down -v`。

## 错误提示

- 面向用户的接口错误使用中文。
- 不在错误提示中暴露 API Key、完整 Base URL、服务器内部路径或代理细节。
- 默认渠道连接失败时提示检查 Base URL、服务器网络、DNS、HTTPS 证书或代理配置。
- 声音档案和音频任务响应、浏览器状态与普通日志不得包含 Provider Voice ID、API Key、Gateway Trace 原文或源音频签名 URL。

## GitHub 发布

- Release 只记录 HOTX AI 当前版本的真实变更。
- Release 标题使用 `HOTX AI v版本号`，例如 `HOTX AI v0.0.6`。
- README 首页不写更新列表，只保留 GitHub Releases 入口。
- 版本更新后同步 `VERSION`、`web/package.json`、README、docs 首页、CHANGELOG 和 README 截图。
