# DFLOP 视频 Canary 合同指纹审计（2026-09-26）

仅执行 read-only 配置读取、HTTPS fixture 检查及 dry-run request capture；未调用 provider generation、未创建视频任务、未消耗 credits。

## Cardinality 与根因

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| video models | 68 | 68 |
| contract fingerprints | 68 | 13 |
| planned live cases | 72 | 11 |
| full-pass / partial / blocked | 59 / 0 / 9 | 59 / 0 / 9 |

旧 execution fingerprint 的投影基数：provider=1、endpointType=1、endpoints=1、protocol=1、capabilityProfile=17、billing=45、runtime=68。`runtime.relevantConfigRevision` 包含 `upstreamModel`，单项即有 68 个值；`billing.pricingRevision` 有 45 个值；`generationParameters` 有 17 组具体值。删去 runtime 整块后仍有 47 个 execution fingerprint，因此不能只删除 modelId。

当前将 immutable execution fingerprint 原样用于 binding drift、credential/pricing 变更和 reserve→submit 快照；另算 canary contract fingerprint。canary 只包含 provider adapter、endpoint type、create/query/image/cancel path、request schema、parser、reference transport、执行选项、request case、billing basis、billing 条件形状、usage algorithm 和 idempotency replay contract。具体 model ID、价格、FX revision、credential/base URL、能力的具体分辨率/时长/比例不参与 canary 分组。具体 binding/case 仍逐一做免费 capability、定价、normalized context 和 request capture 检查。

## Canary dry-run

| contractFingerprint | modelsInGroup | sharedContractReason | selectedCanaryModel | selectedTestCase | estimatedCredits | blockedReason |
| --- | --- | --- | --- | --- | ---: | --- |
| `660453da245b1e97fd4eb32459648e4036931fe936b732e2baedc1b447e008e8` | `doubao-seedance-2.5` | dflop · text-to-video · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5` | text-to-video | 0.5292 | — |
| `d4829b17f86c47292064b727ae45f3dcf227a1fa43fcf6dc9c9f6db1ba0f8ffb` | `doubao-seedance-2.5` | dflop · image-to-video · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5` | image-to-video | 0.5292 | — |
| `94ca6fd240ab88a3ede3b5118c622a23d22dfef0f40395854f449f6b6846b297` | `doubao-seedance-2.5` | dflop · first-frame · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5` | first-frame | 0.5292 | — |
| `9fb0291d1e679177a218c4121702bf7b9a9e5a30ec6a8f43951d41ff8972372a` | `doubao-seedance-2.5` | dflop · first-last-frame · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5` | first-last-frame | 0.5292 | — |
| `2c7ee857072a3586e7ae1045911991ce8b20f26042132819860d3d2eeaf42ed7` | `doubao-seedance-2.0-fast`, `doubao-seedance-2.0-fast-lite`, `doubao-seedance-2.0-lite`, `doubao-seedance-2.0-mini`, `doubao-seedance-2.0-mini-lite`, `doubao-seedance-2.0-2` | dflop · text-to-video · seedance-2.0 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.0-mini` | text-to-video | 0.1386072 | — |
| `619b44fc48fa37007f246522b773a4ce22ff17f7907608c03c0ba37d14c1a155` | `doubao-seedance-2.5-lite` | dflop · text-to-video · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5-lite` | text-to-video | 1.1907 | — |
| `39e98f0eceec5bde17553b08f45061fb0ba43d6f1b7b9446aa5a90c878be7fe0` | `doubao-seedance-2.5-lite` | dflop · image-to-video · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5-lite` | image-to-video | 1.1907 | — |
| `5c5c20fd23adf35c82d60e3c41ec038891f325d0471a188dfb9011ab8100d0bd` | `doubao-seedance-2.5-lite` | dflop · first-frame · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5-lite` | first-frame | 1.1907 | — |
| `93f8c929aaea1ceb1252b943c12124cd5ab3148d45a7ea701aa1b8f4aefd720a` | `doubao-seedance-2.5-lite` | dflop · first-last-frame · seedance-2.5 · 同一端点、请求/响应 schema 与计费维度形状 | `doubao-seedance-2.5-lite` | first-last-frame | 1.1907 | — |
| `2ffc3a7767dc8643ff81185e8f48af0ed049309d3aa7c527b150bd2cf971122a` | `grok-imagine-video`, `grok-imagine-video-1.5-preview`, `dh-avatar`, `dh-lipsync`, `dh-lipsync-max`, `dh-lipsync-pro` | dflop · text-to-video · normalized-video-usage:v1 · 同一端点、请求/响应 schema 与计费维度形状 | — | — | — | COST_NOT_ESTIMATABLE |
| `1ae31fb44fd3e4ce6d6b4815a450ad27e2351a8a462103c20ac47a4fbc5b4e16` | `happyhorse-1.0-i2v`, `happyhorse-1.0-r2v`, `happyhorse-1.0-t2v`, `happyhorse-1.0-video-edit`, `happyhorse-1.1-i2v`, `happyhorse-1.1-r2v`, `happyhorse-1.1-t2v`, `tvod-hailuo-02`, `tvod-hailuo-2.3`, `tvod-hailuo-2.3-fast`, `tvod-hailuo-h3`, `tvod-hunyuan-video-1.0`, `tvod-hunyuan-video-1.1`, `tvod-jimeng-1.0-lite-i2v`, `tvod-jimeng-1.0-pro`, `tvod-jimeng-1.0-pro-fast`, `tvod-jimeng-1.5-pro`, `tvod-jimeng-3.0`, `tvod-jimeng-3.0-pro`, `tvod-jimeng-4.0`, `tvod-kling-video-1.6`, `tvod-kling-video-2.0`, `tvod-kling-video-2.1`, `tvod-kling-video-2.5-turbo`, `tvod-kling-video-2.6`, `tvod-kling-video-3.0`, `tvod-kling-video-3.0-omni`, `tvod-kling-video-master`, `tvod-kling-video-o1`, `tvod-pixverse-c1`, `tvod-pixverse-v5.6`, `tvod-pixverse-v6`, `tvod-sora-2`, `tvod-veo-3.1`, `tvod-veo-3.1-fast`, `tvod-veo-3.1-lite`, `tvod-vidu-video-2.0`, `tvod-vidu-video-q1`, `tvod-vidu-video-q1-classic`, `tvod-vidu-video-q2`, `tvod-vidu-video-q2-pro`, `tvod-vidu-video-q2-pro-fast`, `tvod-vidu-video-q2-turbo`, `tvod-vidu-video-q3`, `tvod-vidu-video-q3-ad`, `tvod-vidu-video-q3-drama`, `tvod-vidu-video-q3-pro`, `tvod-vidu-video-q3-turbo`, `wan2.7-t2v`, `wan3.0-video`, `wan3.0-video-prime`, `dh-motion`, `tvod-subtitle-soft` | dflop · text-to-video · normalized-video-usage:v1 · 同一端点、请求/响应 schema 与计费维度形状 | `tvod-kling-video-2.5-turbo` | text-to-video | 0.03033 | — |
| `250111b983beb5b21cf7be12b423b670f302493cc6c1fc6a4546760864f3a1a3` | `happyhorse-1.0-i2v`, `happyhorse-1.0-t2v`, `happyhorse-1.1-i2v`, `happyhorse-1.1-t2v`, `tvod-hailuo-h3`, `wan2.7-t2v`, `wan3.0-video` | dflop · first-frame · normalized-video-usage:v1 · 同一端点、请求/响应 schema 与计费维度形状 | `wan3.0-video` | first-frame | 0.09 | — |
| `d1b58c675a0715445c1d7806cbb8536c04bb71a72856c2174da586a8b6e0532b` | `clip-compose` | dflop · text-to-video · normalized-video-usage:v1 · 同一端点、请求/响应 schema 与计费维度形状 | — | — | — | PRICING_NEEDS_REVIEW |

计划中的 conservative maximum provider cost：2855.41488 DFLOP_CREDITS（task）；internal estimate：7.1385372 HOTX credits。以上均为 dry-run 估计，实际费用 0。

两个 blocked fingerprint 合计 9 个 model：Grok 与 `dh-*`、`tvod-subtitle-soft` 缺可执行 normalized context；`clip-compose` 定价仍需复核。它们没有被选入 live。未选的同组 model 标为 `SKIPPED_CANARY_NOT_SELECTED`，不能视为 live PASS。

当前最小 canary 仅规划已实现的 T2V、I2V、first-frame、first/last-frame request case。audio、reference-video、video edit 与多步 workflow 不能由这些 case 的 PASS 代替；它们需要在 FULL_ACCEPTANCE 增加专用 fixture、normalized context 和成本上界后才可单独 live 验证。

同组共享的是本项目已验证的 adapter request/response 结构；单个 canary 不证明其他 model 在 provider 端均可调用。每个 model 仍保留独立免费检查、binding drift 判定与显式全量验收路径。

## 验证

- Fingerprint、canary selection、service 与后台面板：4 个测试文件，35/35 通过。
- 完整 release check：649 个测试文件通过、10 个跳过；3,794 个测试通过、34 个跳过；TypeScript、ESLint、Prettier、production build、依赖审计与发布检查通过。
- 浏览器中的后台 dry-run 预览确认显示 68 个模型、13 个指纹、11 个 planned canary、9 个 blocked；展开分组确认共享依据、选中用例和分离的上游/HOTX 成本。
- 严格 UTF-8 解码、乱码标记与 `git diff --check` 通过。
