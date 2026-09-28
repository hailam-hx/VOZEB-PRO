# 低成本视频验收正式设计

**日期：** 2026-09-26\
**状态：** 待书面审阅\
**采用方案：** A — 集成式分层验收、协议族抽样和硬预算控制\
**范围：** 视频模型合同检查、无生成探测、协议族 canary、全模型最小参数 smoke test、结果留痕与后台操作界面\
**明确不在范围：** 修改用户正式生成、hold、settlement、refund、retry、usage snapshot、正式 `saleRateCard` 或 DFLOP 协议的现有图片/视频运行契约

> 本文记录第一版验收设计。后续 fingerprint、verification history、预算结算与成本单位的正式设计见 [Model Validation/Canary V2 设计](./2026-09-26-model-validation-canary-v2-design.md)。涉及这些主题时以 V2 为准；原实施计划在 V2 实施计划获批前仅作历史参考。

## 1. 背景与目标

DFLOP 渠道可能同时公开 60–70 个视频模型。逐模型生成真实视频可以验证上游可调用性，但会重复支付大量具有相同请求和查询契约的任务成本。只运行本地 adapter 测试又不能发现 API Key 可见性、上游 metadata、价格档案或线上 provider 状态变化。

本设计建立四层验收：

1. 对全部视频 binding 执行免费的本地合同检查；
2. 对真实 DFLOP 目录和本地配置执行不生成视频的探测；
3. 默认按协议族选择最低预计成本 binding 运行少量 live canary；
4. 仅在管理员明确选择时，对每个合格模型运行最小参数 live smoke test。

成功标准：

- 100% 视频 binding 都能得到合同、能力和计价层的明确结果；
- 日常验收只为每个不同的执行合同支付一次 canary 成本；
- 任一 live submit 前均能生成服务端价格预览并受 HOTX credits 硬预算约束；
- capability、pricing 或 contract 没有变化且已通过的模型无需重复生成；
- 管理员可以查看每个模型为何运行、复用、跳过或失败；
- 默认 CI、普通模型同步和无生成 probe 不调用 DFLOP generation endpoint。

## 2. 现有系统基线

项目已经具备以下可复用能力：

- `active-protocol-media-matrix.live.test.ts` 和本地 TCP fixture，能够验证注册协议的创建、查询、引用素材、幂等与结果解析；
- DFLOP `/v1/models` 与 `/api/v1/models/public` 的合并目录；
- binding 级 `generationParameters`、`capabilityProfile`、`providerPricingProfile` 和 `costRateCard`；
- logical model 级 `saleRateCard` 及统一 `creative-sale-estimator`；
- DFLOP controlled capability probe 与 pricing status；
- 视频任务 create/query/cancel runtime、provider usage snapshot 和审计日志；
- 管理后台的模型渠道、生成运维和计价管理界面。

本功能必须复用这些事实来源。不得创建第二套视频参数映射、价格计算器、provider adapter 或按模型名维护的能力列表。

## 3. 强制不变量

1. **合同检查不得访问真实 provider。** 所有请求只发送到本地 TCP fixture。
2. **Probe 不得创建 generation task。** 它只读取已同步目录、binding、能力和价格状态，必要时调用供应商公开的只读目录接口。
3. **客户端不构造 upstream request。** 客户端只提交运行模式、模型或 binding ID、preview revision、预算和并发配置；服务端重新读取当前配置并构造 normalized context。
4. **能力档案是参数事实来源。** 最小时长、分辨率、比例、引用方式、音频和水印均来自 binding 的当前能力档案，禁止从模型 ID 猜测。
5. **价格必须可执行。** Live item 只有在 provider pricing status 为 `READY`，且当前 normalized context 可用 `costRateCard` 完整估价时才允许提交。
6. **预算检查在服务端执行。** Preview 仅供确认；正式运行前及每次调度下一项前都重新检查 revision 和剩余预算。
7. **金额使用 Decimal。** 预算、预计成本和实际成本均使用十进制字符串，禁止用 JS float 做最终比较或累加。
8. **不改变用户结算。** 管理员验收任务不修改用户钱包、用户正式售价或既有结算公式；真实 provider 成本独立记录在验收 item。
9. **同一幂等身份不重复创建。** 提交不确定、刷新、恢复和 worker 重启必须沿用 validation item 的稳定 idempotency key。
10. **无变化即可复用。** 只有 contract、capability、pricing、channel credential state 或明确的上游 registry revision 发生变化时，既有通过结果才失效。

## 4. 验收层级与运行模式

### 4.1 Test level

```ts
type VideoValidationTestLevel =
    | "CONTRACT"
    | "PROBE"
    | "FAMILY_CANARY"
    | "MODEL_SMOKE";
```

### 4.2 后台运行模式

```ts
type VideoValidationMode =
    | "contract_only"
    | "family_sample"
    | "all_models_minimum";
```

- `contract_only`：执行合同检查和 probe，不创建真实视频。
- `family_sample`：先执行合同检查和 probe，再为每个合格 contract family 选择一个最低预计成本 canary。后台默认选择此模式。
- `all_models_minimum`：先执行前两层，再对每个合格 binding 运行最小参数 smoke test。

合同检查和 probe 始终先于 live test。前置检查失败的 item 不进入 live 队列。

## 5. 合同检查

### 5.1 覆盖范围

本地 TCP fixture 对每个 active video binding 生成测试矩阵，至少覆盖：

- text-to-video；
- image-to-video；
- first-frame；
- first/last-frame；
- resolution、duration、ratio、audio、watermark；
- Bearer auth 与 `Idempotency-Key`；
- create、query、cancel 路径；
- pending、success、failed 状态和结果 URL；
- 400、402、429、503、timeout、提交结果未知及安全 retry。

每个 binding 只执行其能力档案明确支持的 case。不支持某 case 是 `NOT_APPLICABLE`，不是失败。

### 5.2 生产内合同检查

后台按钮不能动态启动 Vitest。共享的 protocol contract case builder 和断言规则从现有测试文件提取为无副作用领域模块：

- Vitest 继续调用该模块连接 local TCP fixture；
- 后台 `contract_only` 使用同一 case builder 对已注册 adapter 做静态契约和 normalized request 检查；
- 需要真实 socket response parser 的完整矩阵仍由 CI/test command 负责，后台显示最近一次发布构建的 contract suite revision 与结果。

因此生产页面不会开放任意 localhost/network 请求，也不会把测试 runner 打包进 Next.js runtime。

## 6. 无生成 probe

### 6.1 输入

Probe 使用服务端当前快照：

- `/v1/models` 同步后的 API Key 可见集合；
- `/api/v1/models/public` 合并后的 structured metadata；
- channel enabled、credential availability 和 protocol；
- binding enabled、eligible 和 generation parameters；
- provider pricing profile、cost rate card 及其 revision；
- protocol registry 中的视频 operation。

普通 probe 不回传或记录 API Key。

### 6.2 输出状态

```ts
type VideoValidationProbeStatus =
    | "CONTRACT_READY"
    | "CAPABILITY_INCOMPLETE"
    | "PRICING_INCOMPLETE"
    | "AUTH_UNAVAILABLE"
    | "NEEDS_REVIEW";
```

状态优先级：

1. credential/channel 不可用 → `AUTH_UNAVAILABLE`；
2. protocol operation 或 normalized execution context 不完整 → `CAPABILITY_INCOMPLETE`；
3. pricing status 不是 `READY`，或最小 context 无法完整估价 → `PRICING_INCOMPLETE`；
4. metadata 冲突、未知 billing basis 或 revision 无法建立 → `NEEDS_REVIEW`；
5. 其余合格 → `CONTRACT_READY`。

每个非 ready 状态必须附带机器可读 reason code 和中文说明。

## 7. Contract family

### 7.1 Family fingerprint

协议族由影响执行、查询和计价的规范化合同生成稳定 fingerprint：

```ts
type VideoContractFamilyDescriptor = {
    protocol: string;
    createPath: string;
    imageToVideoPath?: string;
    queryPath: string;
    cancelPath?: string;
    requestShapeRevision: string;
    statusParserRevision: string;
    resultParserRevision: string;
    referenceModes: string[];
    billingBases: string[];
    runtimeOptionKeys: string[];
};
```

对 descriptor canonical JSON 做稳定 hash 得到 `contractFamily`。显示名称可以来自官方 metadata，但不参与 family 相等判断。Seedance、Kling、Veo、Wan、Hailuo/Minimax 等名称不得作为唯一分组依据。

以下任一变化都会产生新 family revision：

- endpoint 或模板变化；
- reference contract 变化；
- parser/status/result field 变化；
- billing basis 变化；
- 会改变请求 shape 的 runtime option 变化。

### 7.2 Canary 选择

每个 family 只从 `CONTRACT_READY` item 中选择 canary：

1. 为每个 binding 解析一个最小、可执行、可计价的 normalized context；
2. 用 binding `costRateCard` 计算预计 provider cost；
3. 按 Decimal 成本升序；
4. 成本相同则按 channel priority、binding ID 稳定排序；
5. 选择第一项。

如果一个 family 同时包含不同 reference contract，descriptor 必须使其成为不同 family，或为同一 binding 生成独立 canary case。不得用 text-to-video 成功替代 first/last-frame 合同验证。

## 8. 最小 normalized context

### 8.1 选择规则

最小 context 只从 binding 能力档案构造：

- `count = 1`；
- 使用声明的最小时长；
- 从有可执行 provider price 的 resolution 中选择预计成本最低者；
- 比例使用 binding 声明的默认值；没有唯一默认值时使用能力列表中稳定排序的首项，但在 snapshot 中记录选择原因；
- audio 可关闭且会增加价格时设为 false；必须开启时保留；
- watermark 可关闭且不影响合同覆盖时设为 false；
- text-to-video 不添加 reference；
- image-to-video 使用项目内固定、授权的低体积 fixture 图片；
- first/last-frame 使用两个不同 fixture 资产；
- reference video 只在专门覆盖该 billing basis 时使用，并提供已验证时长。

### 8.2 拒绝条件

以下情况不得提交 live task：

- capability profile 没有足够信息构造请求；
- 影响 upstream execution 或 pricing 的字段没有 normalized value；
- pricing status 非 `READY`；
- cost estimator 返回 missing/unsupported；
- credential 不可用；
- preview revision 已变化；
- 剩余预算不足；
- fixture 资产与 reference contract 不匹配。

## 9. Preview 与预算控制

### 9.1 Preview contract

```ts
type VideoValidationPreviewRequest = {
    mode: VideoValidationMode;
    modelIds?: string[];
    bindingIds?: string[];
    maxBudgetHotxCredits: string;
    concurrency: number;
    readyPricingOnly: true;
};

type VideoValidationPreview = {
    revision: string;
    registryRevision: string;
    pricingPolicyVersion: string;
    selectedModels: number;
    runnableModels: number;
    skippedModels: number;
    estimatedProviderCostHotxCredits: string;
    maxBudgetHotxCredits: string;
    items: VideoValidationPreviewItem[];
};
```

`concurrency` 使用管理员已有 generation concurrency 上限约束，不新增拍脑袋常数。0 或负数无效。

### 9.2 Run 请求

客户端提交：

```ts
type StartVideoValidationRunRequest = {
    previewRevision: string;
    mode: VideoValidationMode;
    modelIds?: string[];
    bindingIds?: string[];
    maxBudgetHotxCredits: string;
    concurrency: number;
};
```

客户端不得提交可落库的 normalized context、价格、upstream payload、task ID 或状态。

服务端重新读取当前设置并重新生成 preview。revision 不一致时不创建 live task，返回 `REVISION_CHANGED` 并要求重新预览。

### 9.3 调度预算

- Run 保存不可变 budget snapshot。
- 调度器使用 Decimal 累加已提交 item 的预计成本。
- 只有 `committedEstimate + nextEstimatedCost <= budget` 时才提交下一项。
- 不因 concurrency 并发预先越过预算；每项领取执行租约前原子预留其预计成本。
- 实际成本高于预计成本时记录 drift 和超预算事实，但不伪造退款或更改现有 settlement。
- 后续未提交 item 标记 `SKIPPED_BUDGET_EXHAUSTED`。

## 10. 持久化

### 10.1 Run 表

新增 `video_validation_runs`：

- `id`
- `mode`
- `status`
- `preview_revision`
- `registry_revision`
- `pricing_policy_version`
- `max_budget_hotx_credits NUMERIC`
- `estimated_cost_hotx_credits NUMERIC`
- `actual_cost_hotx_credits NUMERIC`
- `concurrency`
- `selected_count`
- `runnable_count`
- `skipped_count`
- `created_by`
- `created_at`
- `started_at`
- `completed_at`
- `cancelled_at`

### 10.2 Item 表

新增 `video_validation_items`：

- `id`
- `run_id`
- `logical_model_id`
- `binding_id`
- `channel_id`
- `upstream_model_id`
- `contract_family`
- `test_level`
- `status`
- `probe_status`
- `reason_code`
- `normalized_context JSONB`
- `capability_revision`
- `pricing_revision`
- `estimated_cost_hotx_credits NUMERIC`
- `actual_cost_hotx_credits NUMERIC`
- `provider_task_id`
- `provider_status`
- `result_summary JSONB`
- `error_code`
- `error_message`
- `idempotency_key`
- `submitted_at`
- `tested_at`
- `created_at`
- `updated_at`

唯一性约束保证同一 run、binding、test level 和 case identity 不重复创建。金额列使用 `NUMERIC`，repository SQL 对同一 placeholder 的赋值和比较显式使用 `::numeric`。

`normalized_context` 只保存执行和计价所需脱敏 snapshot。结果保存摘要和受控媒体引用，不长期保存 provider signed URL、API Key、Authorization header 或完整 raw response。

项目尚未上线，schema 直接增加新表，不写旧数据迁移兼容。同步更新 `docs/backend-database.md` 和内容文档镜像。

## 11. 服务与任务编排

### 11.1 领域模块

- `video-validation-contract.ts`：构造 descriptor、family fingerprint 和合同 case。
- `video-validation-probe.ts`：评估目录、binding、能力、价格和 credential state。
- `video-validation-context.ts`：构造最小 normalized context。
- `video-validation-cost.ts`：使用现有 pricing primitives 估算 provider cost 和预算。
- `video-validation-service.ts`：preview、创建 run、取消、查询和 drift/reuse 决策。
- `video-validation-worker.ts`：领取 item、调用现有视频 runtime、查询终态和保存结果。

模块名称可按项目现有目录布局微调，但边界保持独立。Route Handler 只做鉴权、输入解析、服务调用和响应映射。

### 11.2 Runtime 复用

Live validation 必须复用现有视频 adapter 的 create/query/cancel 实现和请求模板，不复制 provider request logic。验收任务使用独立 source/actor 和独立持久化表，不创建用户作品或用户对话，不扣用户钱包。

Provider 返回 authoritative usage/cost 时写入 `actualCost`；只有估算值时保持 `actualCost=null`，不得把预计成本伪装为实际成本。

### 11.3 恢复和取消

- Worker 重启后继续查询已保存的 provider task，不再次创建。
- 提交结果未知时使用同一 idempotency key 恢复。
- 管理员取消 run 后，未提交 item 直接取消；已提交且 provider 支持 cancel 时调用现有 cancel adapter；不支持时继续查询到终态并标记取消请求结果。
- Run 状态由 item 状态聚合，不依赖固定轮询次数或新增固定延时。

## 12. API

```text
POST /api/admin/video-validation/preview
POST /api/admin/video-validation/runs
GET  /api/admin/video-validation/runs
GET  /api/admin/video-validation/runs/:runId
POST /api/admin/video-validation/runs/:runId/cancel
```

统一返回 `{ code, data, msg }`。

权限：

- Preview、列表和详情：`generation.read` + `upstream.manage`；
- 创建和取消 live run：`generation.manage` + `upstream.manage`；
- 显示 provider 成本不要求修改售价，不授予 `billing.manage` 写权限。

所有创建、取消、预算拒绝和 live 终态写入脱敏 audit log。

## 13. 后台 UI

在“上游配置”相关工作区增加 **低成本视频验收**，不放入充值或正式售价编辑区。

页面包括：

1. 运行模式：仅合同检查、按协议族抽样、全部模型最小参数；
2. model/binding 多选与仅 `READY` 提示；
3. HOTX credits 最大预算和 concurrency；
4. 预览卡：选择数、可运行数、跳过数、预计 provider cost；
5. item 表：family、测试层级、normalized 参数摘要、价格、状态和跳过原因；
6. 确认 Modal：展示实际将产生上游费用的 item；
7. 运行详情：进度、预计/实际成本、task 状态、错误和时间；
8. 历史记录与 drift/reuse 标记。

默认模式为 `按协议族抽样`。合同检查不显示会产生 provider 费用的确认文案；任何 live 模式必须先成功预览并由管理员明确确认。

UI 使用中文，并在桌面、390px 和 430px 保持无横向溢出。窄屏使用卡片摘要或横向内容折叠，不能依赖被裁切的大表格。

## 14. Drift 与结果复用

通过以下 revision 判断既有通过结果是否仍可复用：

- contract family fingerprint；
- binding capability revision；
- provider pricing/cost rate revision；
- registry model metadata revision；
- channel protocol/config revision；
- credential availability revision，不包含密钥内容。

全部相同且最近结果为 `PASSED` 时，日常 family run 可以标记 `REUSED_UNCHANGED`。管理员选择全量强制 smoke test 时可以显式绕过复用，但仍受预算限制。

Pricing 变化只要求重新 preview 和重新选择最低成本 canary；若 execution contract 未变化，不把旧 runtime pass 误报为 adapter failure。

## 15. 错误处理

至少提供以下 reason/error codes：

- `CONTRACT_INCOMPLETE`
- `CAPABILITY_INCOMPLETE`
- `PRICING_NOT_READY`
- `COST_NOT_ESTIMATABLE`
- `AUTH_UNAVAILABLE`
- `REVISION_CHANGED`
- `BUDGET_EXCEEDED`
- `SKIPPED_BUDGET_EXHAUSTED`
- `REFERENCE_FIXTURE_UNAVAILABLE`
- `UPSTREAM_REJECTED`
- `UPSTREAM_RATE_LIMITED`
- `UPSTREAM_PAYMENT_REQUIRED`
- `UPSTREAM_UNAVAILABLE`
- `SUBMISSION_UNCERTAIN`
- `POLL_FAILED`
- `CANCEL_UNSUPPORTED`
- `REUSED_UNCHANGED`

UI 显示面向管理员的中文说明，并保留受控的 request/task ID 供排障；不直接展示 HTML gateway body、Authorization、API Key 或 signed media URL。

## 16. 测试策略

### 16.1 单元测试

- descriptor canonicalization 与 family fingerprint；
- 同 contract 合并、reference/billing contract 分离；
- 最小时长、最低可计价 resolution、audio/watermark 选择；
- capability incomplete、pricing incomplete、auth unavailable；
- Decimal 成本排序和预算边界；
- revision changed、reuse 和 drift；
- unknown/unsupported parameter 拒绝。

### 16.2 TCP fixture 和 adapter 测试

- 100% 注册视频协议的 create/query/cancel；
- text/image/first/first-last/reference-video；
- Bearer、idempotency、retry；
- pending/success/failure；
- 400/402/429/503、timeout 和提交结果未知；
- 同一 idempotency key 不产生第二个付费任务。

### 16.3 Service/API/数据库

- contract/probe 模式从不调用 generation endpoint；
- family sample 每 family 只创建一个 canary；
- all-model 模式只运行 `READY` item；
- 混合状态 item 部分跳过，不阻塞其他合格 item；
- preview/run revision race；
- 并发调度不越过硬预算；
- worker 恢复不重复 submit；
- cancellation；
- PostgreSQL `NUMERIC` 小数回归并使用 `--no-file-parallelism`；
- audit log 脱敏。

### 16.4 UI 和回归

- 模式选择、筛选、preview、确认、运行进度和历史；
- 预算不足时不允许 submit；
- skip reason 和错误可见；
- desktop、390px、430px；
- 非 DFLOP 渠道和现有视频生成测试不回归；
- 默认测试套件不使用真实 API Key、不创建真实视频。

### 16.5 显式 live gate

真实 provider canary 只能通过管理员 UI 的确认操作或带显式 live 环境开关的专用测试命令启动。普通 `test`、typecheck、release check 和 CI 不读取生产 DFLOP API Key，也不产生 provider 费用。

## 17. 实施顺序

1. 提取共享 contract descriptor/case builder，并保持现有 TCP tests 通过；
2. 实现 probe、minimal normalized context 和 provider cost preview；
3. 增加 run/item schema、repository 和审计；
4. 实现 preview/run API、预算事务和 worker 恢复；
5. 接入现有视频 runtime；
6. 增加后台 UI；
7. 完成 unit、integration、PostgreSQL、release gate 和浏览器回归；
8. 仅在管理员明确配置预算并确认后执行真实 family canary。

## 18. 验收标准

- 全部视频 binding 都出现在 contract/probe 结果中，不因 adapter 暂未 live 验证而静默消失；
- `contract_only` 的网络记录中没有 DFLOP generation 请求；
- `family_sample` 的 live task 数等于有必要运行且未复用的 contract family/case 数；
- `all_models_minimum` 不运行非 `READY` 或无法估价的 item；
- Preview 和正式运行使用同一服务端算法，revision 漂移时拒绝旧 preview；
- 任何执行路径都不能超过提交时的预计预算预留；
- 同一 item 的 retry/recovery 不重复创建 provider task；
- 预计成本、实际成本、状态和错误都可按 run/item 审计；
- 用户正式 generation、钱包结算和现有 DFLOP 视频能力保持不变。
