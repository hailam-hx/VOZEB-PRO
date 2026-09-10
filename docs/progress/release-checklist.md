# HOTX AI 发布检查清单

页面、API Service、Route Handler、服务层、持久层与 E2E 的对应关系见[页面与接口证据矩阵](./page-api-evidence.md)。

发布前先在 `web` 目录执行：

```bash
pnpm run check:release
```

该命令会检查 Prettier、TypeScript、隔离生产构建、补丁空白，以及 `.data`、`.next`、`node_modules` 等运行时文件是否被误提交。

## 2026-09-10 HOTX AI 品牌发布证据

- Web Vitest：579 个文件通过、6 个跳过；2,845 项通过、16 项跳过。TypeScript、ESLint、Prettier 与生产构建通过。
- Playwright：桌面、390px、430px 依次执行，197 项通过、25 项项目/环境跳过、0 项失败。覆盖品牌 Logo、三语首页与 27 个 SEO URL、登录/注册、`/create`、后台站点设置和页面横向溢出；Logo 已验证可见、固有宽高非零且相等，并使用 `object-contain`。
- 发布阻断项：`pnpm run check:release` 的依赖审计报告 11 项既有 advisory（2 critical、3 high、6 moderate）。本轮未升级依赖；应在获批升级后重新执行发布检查。

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
