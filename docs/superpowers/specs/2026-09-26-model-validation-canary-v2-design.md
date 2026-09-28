# Model Validation/Canary V2 正式设计

**日期：** 2026-09-26\
**状态：** READY_FOR_IMPLEMENTATION_PLAN；待用户确认最终语义，未进入实施计划\
**决策：** 方案 A，immutable fingerprint snapshot + 独立 append-only verification history\
**范围：** 现有低成本视频验收的分组、变更验证、预算、成本、指标、恢复、PostgreSQL 门禁\
**不在范围：** 修改用户生成、钱包 hold/settlement/refund、usage snapshot、正式 `saleRateCard`；本阶段不修改实现、schema 或 CI

## 1. 问题与事实来源

当前 `video-validation-service.ts` 以 `contractFamily + caseId` 选 canary；`findReusablePassed` 以 binding、family、case、capability revision、pricing revision 寻找旧结果。descriptor 尚不包含完整 provider、endpoint type、能力及运行时配置快照，因而不同执行合同可能共用 live canary。当前 repository 只累计预留金额，终态缺少原子 settle/release；`estimatedProviderCostHotxCredits` 实为换算后的 HOTX credits。`skippedModels` 统计的是 item/case。PostgreSQL 测试使用的 `RUN_VIDEO_VALIDATION_POSTGRES_INTEGRATION` 与 CI 的 `VOZEB_PRO_RUN_POSTGRES_INTEGRATION` 不一致，且 CI 没有列入该测试文件。

用户目标是：相同 runtime contract 的 case 才共用抽样；每个 binding 的 live 验证能独立审计；变更后精确重测；并发 worker 不能基于同一旧余额多次提交；provider 原始成本与内部积分分开。默认测试不创建真实视频。

### 1.1 与现有文件对齐

- [原视频验收设计](./2026-09-26-low-cost-video-validation-design.md) 的 TCP fixture、probe、normalized context、HTTPS reference fixture、API 鉴权与不触碰用户钱包的边界继续适用；本文覆盖其中关于运行模式、fingerprint/canary、预算、持久化、成本、指标、reuse 和测试门禁的不一致规则。
- [DFLOP 定价设计](./2026-09-24-dflop-pricing-sync-design.md) 定义 raw `providerPricingProfile`、可执行 `costRateCard`、Decimal 换算及独立 `saleRateCard`；validation 仅读取其当前版本，不写正式售价。
- `AGENTS.md` 要求参数以 binding 能力档案为准、定向 PostgreSQL 查询、`NUMERIC` 显式转换、共享测试库使用 `--no-file-parallelism`，并默认只用本地 TCP fixture。其“后台模型渠道不提供探测”规则约束渠道配置页；本功能属于独立管理员生成运维验收，不参与渠道启用决策。当前用户明确要求该验收，适用本专项设计。
- 仓库未找到独立命名的 Model Validation PRD、System Design 或 ADR 文件；本 spec 与上述现有设计、`docs/content/docs/backend/backend-database.mdx` 和 CI workflow 对齐，不假称已有额外决策。

## 2. 不变量

1. 每个 validation item 的 fingerprint snapshot、hash、version 在创建后不可变；worker 发现当前配置不等于快照时停止该 item 并要求重新预览，不能用新配置执行旧快照。
2. Canary 抽样身份是 `(fingerprintVersion, fingerprintHash, caseId)`；live 验证复用身份是 `(bindingId, caseId, fingerprintVersion, fingerprintHash)`。跨 binding 不复用 PASS。
3. 只有真实 live PASS 才能写 successful verification；probe、TCP fixture、复用、未知提交和失败不能伪装成 PASS。
4. 任何提交前，item 必须 `READY`、有可执行 normalized context、可信的 conservative maximum `estimatedCredits` 与原子预算预留。能否在终态读取 actual provider cost 不参与 live-submit 资格判断；并发 claim/lease 不等于预算预留。
5. 预算以 HOTX credits 计；provider cost 保留原币种及计费单位。所有持久金额是 PostgreSQL `NUMERIC`，API/domain 用 decimal string，计算使用 Decimal。
6. 未确认 provider 未创建任务或未计费时，不因 timeout、lease 过期或进程重启释放 reservation。只有该 provider 的 create contract 已验证支持同键幂等重放或按原键 reconciliation，才允许未知提交沿用原 `Idempotency-Key` 重试；否则停在 `SUBMISSION_UNKNOWN / NEEDS_RECONCILIATION`，不能再次 create。
7. 结果、fingerprint 和 audit 不保存 API Key、Authorization、敏感模板变量、长效签名媒体 URL 或完整上游响应。`REFERENCE_FIXTURE_UNAVAILABLE` 继续阻止缺少公开 HTTPS fixture 的引用 case；localhost URL 不发送给外部 provider。
8. 验证历史只追加。正式用户账务和既有视频 adapter 的运行契约保持独立。
9. `estimate → reserve → submit` 绑定同一个 immutable execution snapshot：binding/channel 身份、normalized context、pricing/FX revision、fingerprint、request payload digest 与 idempotency key。任一项变化必须废弃本次 submit 并重新估价、预留；不能拿旧 reservation 提交新 request。
10. 显式重试而新建 generation task、改用其他 provider 或 binding 均是新的付费尝试，必须创建新 attempt/item、重新计算费用上界并原子预留额外预算。原 attempt 的 reservation 按其上游结果独立 settle/release，不能转移给新 attempt。
11. `actualCredits > reservedCredits` 时记录完整 actual，不截断、不改写为 estimate；标记 `COST_BOUND_VIOLATION`，阻止该 run 后续 live submit，并继续恢复/结算已提交任务。Cancel 不代表免费：只有确认未创建 task 且未计费，或 provider 明确确认取消不计费时才 release；没有可信 actual 时走 `ESTIMATED_FALLBACK`。

## 3. Domain model 与 fingerprint

```ts
type ValidationFingerprintV1 = {
  provider: string;
  endpointType: string | null;
  endpoints: { create: string; query: string; imageToVideo?: string; cancel?: string };
  protocol: {
    protocolId: string;
    requestSchemaVersion: string;
    parserVersion: string;
  };
  capabilityProfile: {
    generationParameters: unknown;
    executionOptions: unknown;
    referenceContract: unknown;
  };
  billing: {
    billingBasis: string[];
    pricingRevision: string;
    normalizationRevision: string;
    conversionRevision: string;
    actualCostCapabilityRevision: string;
  };
  runtime: {
    relevantConfigRevision: string;
    credentialRevision: string | null;
    idempotencyReplayContractRevision: string;
  };
};

type FingerprintEnvelope = {
  fingerprintVersion: 1;
  fingerprintHashAlgorithm: "sha256";
  fingerprintHash: string;
  fingerprintSnapshot: ValidationFingerprintV1;
};
```

`provider` 是上游供应商身份，`endpointType` 来自已同步的官方 metadata；缺失时用显式 `null`，不得从 model ID 猜测。endpoint 包含 create/query，且 image-to-video/cancel 在该 case 可用时纳入。`requestSchemaVersion` 覆盖实际 request template、字段映射、reference 上传方式及 adapter 版本；`parserVersion` 覆盖 status/result/error/usage 解析。版本必须由实现中可复现的内容 digest 或明确的 adapter contract revision 得出，不能只取固定字符串。

`capabilityProfile` 是 binding 的公开 `generationParameters` 与会改变执行的私有能力选项的脱敏投影；分辨率、时长、比例、引用方式、audio、水印、数量及上下界都必须纳入。`billing` 包含当前 operation 的可执行 billing basis、cost rate card revision、normalized usage/price 规则及 FX/credit 换算 revision。定价数值变化应改变 `pricingRevision`；仅显示文案变化不应改变 fingerprint。`runtime` 包含相关 channel/binding/provider 配置及 credential 轮换 revision，不含密钥内容。credential revision 可由服务端密钥对当前 API Key 计算 HMAC-SHA256，结果只存服务端并不在 API DTO 暴露；无法取得可信 revision 时标记 `NEEDS_REVIEW`，不得声称 unchanged。

规范化算法：先构造明确白名单投影，再按 Unicode 字符串的确定性顺序排序 object keys；去掉 `undefined`，保留 `null`；decimal 转规范字符串；集合语义的数组去重排序，顺序影响执行的数组保持原序。端点先规范成实际请求所用的同源 URL/路径，不包含 API Key 或临时 token。SHA-256 输入为 `model-validation-fingerprint:v1\n` 加 canonical JSON UTF-8；输出小写 hex。不同 fingerprint version 永远不比较为相同，即使 JSON/hash 恰巧相同。hash 一经写入 item 不重算覆盖。

`contractFamily` 保留为管理员可读的粗分类和筛选信息，不参与 canary 相等或 PASS 复用。对于每个 live case，group key 是 `fingerprintVersion + fingerprintHash + caseId`；不能以 text-to-video 结果替代 first/last-frame 结果。

## 4. Verification history 与运行模式

每次 live item 到达可信终态时追加一条 verification，至少记录 item、run、binding、case、fingerprint、mode、`PASS | FAIL | UNKNOWN | CANCELLED`、provider task ID、实际/保守结算及时间。历史记录不可更新或删除；同一 item 的终态重复投递只允许生成一条历史记录。PASS 必须同时满足 provider 已确认成功、结果契约成立、预算结算已完成。未知成本可用明确 `ESTIMATED_FALLBACK` 结算后记 PASS；未知 task 结果不能记 PASS。

`changed_models` 对当前每个 eligible `(bindingId, caseId)` 定向读取最新 live verification，再读取该身份最近一次完整 PASS；判定如下：

| 证据 | 决策 |
| --- | --- |
| 无既往 live 记录 | `NO_PRIOR_VERIFICATION` → `LIVE_TEST_REQUIRED` |
| 曾 PASS，但版本/hash 与当前不同 | `PRIOR_PASS_DIFFERENT_FINGERPRINT` → `LIVE_TEST_REQUIRED` |
| 最近一次 live 已 PASS，且版本/hash 相同 | `PRIOR_PASS_SAME_FINGERPRINT` → `SKIPPED_UNCHANGED` |
| 当前 fingerprint 的最近一次 live 为 FAIL | `PRIOR_FAILED_SAME_FINGERPRINT` → `LIVE_TEST_REQUIRED` |
| 最近一次 live 为 UNKNOWN、中断或取消，且尚未 reconciliation | `PRIOR_UNKNOWN_OR_INTERRUPTED` → 等待恢复；不得立即再 submit |
| 未决项完成 reconciliation 且确认未创建/未计费 | `LIVE_TEST_REQUIRED` |

历史中更早的 PASS 不能覆盖其后同 fingerprint 的 FAIL/UNKNOWN。不同 fingerprint 的 PASS 也不能覆盖当前配置。`changed_models` 对每个需要 live 的 binding/case 各建一个 item；按 fingerprint/case 分组只用于显示和成本排序，**不**把某个 binding 的 canary PASS 扩展到同组其他 binding。`family_sample` 则对每个 fingerprint/case 选择一个尚需 live 的 cheapest binding；未选 binding 标为 `SKIPPED_CANARY_NOT_SELECTED`，不能标记已验证。`all_models_minimum` 对每个 READY binding/case 运行，不自动复用；`contract_only` 仍无付费调用。保留 API mode 值 `family_sample`，UI 文案改为“按合同指纹抽样”；不增设同义 mode 值。

Canary 排序按 `estimatedCredits` 的 Decimal 值、channel priority、binding ID 稳定排序。跨 provider 原始成本不可直接比较。选择前必须排除执行 capability/提交前 pricing 不完整、缺少 HTTPS fixture、无法建立可信费用上界的候选；terminal actual-cost capability 缺失不在排除条件内。

## 5. Cost model 与 hard budget

```ts
type ProviderCost = { amount: string; currency: string; unit: string };
type ValidationCost = {
  estimatedProviderCost: ProviderCost | null;
  estimatedCredits: string;
  actualProviderCost: ProviderCost | null;
  actualCredits: string | null;
  actualCostCapability: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  actualCostProvenance: {
    providerTaskId: string | null;
    source: "USAGE" | "BILLING_API" | "PROVIDER_CREDITS" | "ESTIMATED_FALLBACK" | "MANUAL";
    sourceField: string | null;
    observedAt: string;
    providerUnit: string | null;
    pricingRevision: string;
    conversionRevision: string;
  } | null;
  creditEstimateSource: string;
  creditSettlementSource: "ACTUAL_PROVIDER_COST" | "ESTIMATED_FALLBACK" |
    "PROVIDER_REPORTED_CREDITS" | "MANUAL_RECONCILIATION" | null;
  pricingRevision: string;
  conversionRevision: string;
};
```

`estimatedProviderCost` 是供应商原始成本，`estimatedCredits` 是按定价/FX snapshot 换算的内部预算成本；非空金额必须指出单位与来源，credits 的来源单独记录。provider 原始金额无法可靠导出时保留 `null`，不得把 HOTX 数字回填为原始 provider cost。`actualCostCapability` 在创建 item 时记录 provider/case 的 actual-cost 能力及依据，并在 verification 中保留；`UNAVAILABLE` 或 `UNKNOWN` 不阻止 live submit。`actualCostProvenance` 记录脱敏的 provider task、数据来源/字段、观察时间、原始单位和换算 revision，覆盖 provider 原始费用、provider-reported credits 与保守 fallback；不得保存完整 upstream response。实际 provider 费用仅在 authoritative provider usage/账单可取得时保存；否则 `actualProviderCost` 和 `actualCredits` 保持 `null`，同时有独立的保守 `settledCredits` 与 `ESTIMATED_FALLBACK`。不能把 fallback 冒充 actual。

**严格预算前提与唯一成本 gate：** `estimatedCredits` 必须是该 normalized request 可验证的 conservative maximum 计费暴露，不是均值或“可能的最低价”。可通过 provider 官方固定价格、明确 token/秒/数量上限及完整 pricing tiers 证明；不允许凭模型名称或任意系数补安全边际。写入 `NUMERIC(30,8)` 前对上界向上取整到 8 位，不能因四舍五入降低 reservation。无法证明**提交前上界**的 case 标记 `BUDGET_BOUND_UNAVAILABLE`，不得 live submit。已证明上界的 case 即使没有可靠的 terminal actual cost，仍可 reserve 并 live test。按 estimate reserve、actual 缺失时 settle estimate 才不削弱 hard budget。若 provider 违反已验证上界，记录 `PROVIDER_COST_EXCEEDED_BOUND`、冻结该 run 后续 submit、保留真实实际费用并告警；系统不可能在上游已收费后逆转该笔超额。

Run 账本按 HOTX credits 保存 `budgetCredits`、`activeReservedCredits`、`totalSettledCredits`；item 保存 `estimatedCredits`、`reservedCredits`、`settledCredits`。`remainingBudget = budgetCredits - totalSettledCredits - activeReservedCredits`，三个汇总均非负，且提交前 `remainingBudget >= next.estimatedCredits`。`estimatedProviderCost` 的不同 currency/unit 不在 run 上加总；UI 按 `(currency, unit)` 分组汇总，不能生成一个无意义的混合总数。

Reservation state：`NONE → RESERVED → SETTLED | RELEASED`。禁止逆向转移、二次 settle 或二次 release。状态和金额的更新必须以 item 当前状态作 compare-and-set，锁 run 行与 item 行，在同一 PostgreSQL transaction 更新两个账本。并发 worker 只能在事务提交后 submit。claim lease 失效不改账本。任何终态状态更新及 verification insert 与对应 settle/release 使用同一事务；客户端与 worker 只接收提交后的结果。

| 事件 | 预算动作 |
| --- | --- |
| Submit 前管理员取消 | release |
| Provider 明确拒绝且确认未创建 task、未计费 | release |
| Submit/执行后取得可信 authoritative actual provider cost | 用同一 conversion snapshot 得到 `actualCredits`，source=`ACTUAL_PROVIDER_COST`；按 actual settle，并释放多余 reserve |
| Submit/执行后仅取得可信 provider-reported HOTX credits | 按该 credits settle，source=`PROVIDER_REPORTED_CREDITS`；`actualProviderCost` 仍为 `null` |
| Task 已 submit/执行，但 provider 无可信 actual cost/credits | 保守 settle 全额 reservation，即 `estimatedCredits`，source=`ESTIMATED_FALLBACK`；`actualProviderCost`、`actualCredits` 仍为 `null`，不得仅因 actual unavailable 而 release |
| Submit outcome unknown，provider 已验证支持同键幂等重放/按键查询 | 保留 RESERVED；用同一 snapshot 和原 key 恢复，不生成新 key |
| Submit outcome unknown，provider 未验证支持同键重放/查询 | 保留 RESERVED，item status=`SUBMISSION_UNKNOWN`、reason=`NEEDS_RECONCILIATION`；禁止自动再次 create |
| Submit 后取消且 provider 明确确认无费用 | release |
| Provider 已确认取消终态，但费用未知 | 保守 settle 全额 reservation，即 `estimatedCredits`；actual unavailable 本身不是 release 证据 |
| Submit 后取消不支持或状态未终止 | 保留 reservation，继续查询/reconciliation；确认终态且无可信 actual 时再 `ESTIMATED_FALLBACK` |
| 查询超时、worker crash、lease 过期 | 不 release；按任务 ID/原 idempotency 身份恢复 |

实际 `actualCredits > reservedCredits` 时账本记录完整实际数额，不截断、不以 reserve/estimate 覆盖，item 记 `COST_BOUND_VIOLATION`；run 进入 `reconciling`、设置 `budget_violation_at`，停止后续 live submit。已提交 item 仍允许查询至终态；不得以负 reservation 隐藏超额。实际费用比 reserve 低时，差额在同一 transaction 释放。`MANUAL_RECONCILIATION` 需要具名管理员、证据与 audit log；不能通过修改旧 verification 隐藏历史。

## 6. Recovery、reconciliation 与事务边界

定向扫描 `reservation_state=RESERVED` 且 `updated_at` 早于管理员/现有 worker 配置的 reconciliation threshold；时间仅触发检查，不判定免费。优先用已存 provider task ID 查询；若无 ID，只有 adapter/provider contract 明确证明支持按原 idempotency key 查询或同键幂等重放，才可按原键恢复。仅接受 `Idempotency-Key` header 或项目本地标记不构成该证明。不能安全判定时保持 RESERVED、记 item status=`SUBMISSION_UNKNOWN`、reason=`NEEDS_RECONCILIATION` 并等待有证据的人工处理；不得自动换 key 或再次 create。完成后在锁定事务中执行 terminal transition、预算 settle/release、append-only verification 和审计。进程在提交任一事务前/后崩溃，重复恢复必须得到同一结果。

事务边界：创建 run + items + audit 原子；reserve 为一个短事务；provider network 调用只在事务外；任务 ID/提交不确定状态的保存为短事务；terminal item + 账本 + verification + audit 为一个事务。取消 queued/reserved 与 release 在同一事务；submitted/polling 只写取消请求，待 provider 证据后结算。任何读取后再写的业务判断都必须在锁内重验。

## 7. PostgreSQL schema proposal

### 7.1 `video_validation_runs`

保留 run 身份、preview revision、registry/policy version、状态、并发及时间。新增/明确：`budget_credits NUMERIC(30,8) NOT NULL`、`active_reserved_credits NUMERIC(30,8) NOT NULL DEFAULT 0`、`total_settled_credits NUMERIC(30,8) NOT NULL DEFAULT 0`、`budget_violation_at`、精确定义的 `model_count`、`binding_count`、`validation_case_count`、`free_check_count`、`live_canary_count`、`live_submission_count`、`skipped_case_count`。状态允许 `reconciling`：停止新 submit，继续处理已提交 item。约束金额非负、`concurrency > 0`；正常运行 `active_reserved_credits + total_settled_credits <= budget_credits`，超额只能通过受审计的 provider actual 违规路径表示。原 `estimated_cost_hotx_credits` 不再兼任 reservation。

### 7.2 `video_validation_items`

在现有身份、状态、lease、task ID、normalized context 基础上增加：`fingerprint_version smallint`、`fingerprint_hash_algorithm text`、`fingerprint_hash text`、`fingerprint_snapshot jsonb`、`execution_snapshot_hash text`、`request_payload_digest text`、`attempt_no integer`、`estimated_provider_cost jsonb`、`actual_provider_cost jsonb`、`estimated_credits NUMERIC(30,8)`、`actual_credits NUMERIC(30,8) NULL`、`actual_cost_capability text`、`actual_cost_capability_evidence jsonb`、`actual_cost_provenance jsonb`、`reserved_credits NUMERIC(30,8)`、`settled_credits NUMERIC(30,8)`、`reservation_state text`、`credit_estimate_source`、`credit_settlement_source`、`conversion_revision`、`reconciliation_required_at`。execution snapshot digest 覆盖 binding/channel、normalized context、pricing/FX revision、fingerprint、实际 request payload digest 和 idempotency key；reserve 与 submit 必须验证它一致。capability/provenance evidence 只含脱敏 contract/source revision，不含原始响应或密钥。JSON cost 有结构校验：非负 decimal amount、非空 currency/unit；不能把混合单位作为一个数字聚合。Fingerprint 四字段 `NOT NULL`，snapshot 与 version/hash 写后不可变，服务端写入前验 hash。`UNIQUE(run_id,binding_id,test_level,case_id,attempt_no)` 和 `UNIQUE(idempotency_key)`；相同 key 只允许相同 payload digest。`provider_task_id` 允许 null，提交不确定的 item 必须保留 reservation；新付费尝试必须有新 attempt_no 与独立 reservation。

索引：`(run_id, created_at, id)` 用于审计详情；`(next_attempt_at, lease_until, id)` 的活动状态 partial index 用于 worker；`(reservation_state, updated_at, id) WHERE reservation_state='RESERVED'` 用于定向 recovery；`(binding_id, case_id, fingerprint_version, fingerprint_hash)` 用于 drift 与 history 关联。现有 run `created_at DESC` 索引保留。

### 7.3 `model_validation_verifications`

新表：`id`、`binding_id`、`case_id`、`fingerprint_version`、`fingerprint_hash`、`fingerprint_hash_algorithm`、`fingerprint_snapshot jsonb`、`validation_run_id` FK、`validation_item_id` FK、`result`、`verification_mode`、`verified_at`、`provider_task_id`、`actual_provider_cost jsonb NULL`、`actual_credits NUMERIC(30,8) NULL`、`actual_cost_capability`、`actual_cost_capability_evidence jsonb`、`actual_cost_provenance jsonb`、`settled_credits NUMERIC(30,8)`、`credit_settlement_source`、`created_at`。`UNIQUE(validation_item_id)` 保证重放仅追加一次；记录不可 UPDATE/DELETE，删除 run 时也不能级联抹去历史，因此 verification FK 使用 `ON DELETE RESTRICT` 或保留不可变身份快照。`(binding_id,case_id,verified_at DESC,id DESC)` 支持 latest live lookup；`(binding_id,case_id,fingerprint_version,fingerprint_hash,verified_at DESC)` 的 PASS partial index 支持同指纹查询；run/item FK 索引支持审计。查询必须按所选 binding 集合有界批处理，不能全表取回 Node 过滤。

### 7.4 Migration 与 rollback

项目尚未上线，但当前开发库已有 validation 两表。实施时对隔离开发库执行显式一次性 validation 表重建，先导出需保留的旧审计，再建带 `NOT NULL` V1 fingerprint 的新表和 history 表；旧 item 没有 V1 fingerprint，一律不可用于 `changed_models` 的 PASS 复用，不伪造 backfill，也不在新表保留无 fingerprint 的兼容分支。生产式预发布环境必须先备份再重建，并把旧审计单独归档。schema inventory、trigger、repository types 与两份数据库文档同批更新。部署先暂停 validation worker，再完成 schema 和新代码切换；回滚先停新 worker，回到只读 validation 入口并保留新增表/历史，不运行会删除 history 的反向迁移。恢复旧代码的写操作前须确认其旧预算语义不会提交 live task；否则禁用 live validation。用户正式生成不受该 feature rollback 影响。

## 8. API/DTO 与 UI

Preview/start 请求仍只允许 mode、modelIds/bindingIds、budget credits、concurrency、preview revision；客户端不提交价格、fingerprint、normalized context 或 task ID。新增 `changed_models` mode。服务端在 start 时重新生成 fingerprint/成本/资格/预算 preview；revision 不一致返回 `REVISION_CHANGED`。worker 在 submit 前再次验证绑定和运行配置与 item snapshot 相同；变化返回 `RUNTIME_CONTRACT_CHANGED`，保留审计并不提交。

Preview item 返回 fingerprint version/hash（脱敏 snapshot 仅管理员详情可见）、case decision、成本及 source/revision、actual-cost capability/evidence、资格和 skip reason。Run/详情 DTO 使用 `estimatedProviderCost` 与 `estimatedCredits`、`actualProviderCost` 与 `actualCredits` 分列显示；`settledCredits` 与 `ESTIMATED_FALLBACK` 明确标“预算保守结算”，不冒充供应商实账。UI 显示按 currency/unit 分组的 provider cost subtotal 以及单一 HOTX credits budget subtotal。409 revision、费用上界缺失、fixture 缺失、reconciliation 等有中文原因。

指标按同一 run snapshot 计算：`models` 是去重 logical model 数；`bindings` 是去重 binding 数；`validationCases` 是计划的 binding/case item 数；`freeChecks` 是实际完成的本地合同检查与无生成 probe 次数（preview 用 `plannedFreeChecks`，不能从未提交 live 的 item 数反推）；`liveCanaries` 是 `family_sample` 实际提交 provider 的 canary item 数（preview 用 `plannedLiveCanaries`）；`liveSubmissions` 是所有 mode 实际提交的 item 数；`skippedCases` 是 `skipped` item 数，其中 `SKIPPED_UNCHANGED` 单独列出。`SKIPPED_CANARY_NOT_SELECTED`、fixture/capability/pricing/budget 跳过分别列出，不能将所有 skipped cases 标成 skipped models。指标在 preview 与已运行详情区分“计划”和“实际”。

## 9. 测试矩阵与发布门禁

| 层级 | 必测证据 |
| --- | --- |
| Domain | canonical key/order/null/decimal、数组语义、V1/V2 不等价；provider/endpoint/schema/parser/capability/billing/runtime 任一变化都改 hash；无关显示文案不改 hash |
| Selection | 相同 hash + case 选 Decimal 最便宜 canary；不同 case 不共用；`changed_models` 对每 binding 验证，same PASS skip、drift/failed/new required、UNKNOWN 不重复 submit |
| Cost | raw provider unit 与 HOTX credits 分离；FX revision 改 fingerprint；无可证明计费上界不得 live；有上界但无 actual cost 可以 submit/PASS，保守 settle 全额 reservation 且不 release；actual provenance；非整数 Decimal 边界；actual 高于 reserve 时完整记账并标 `COST_BOUND_VIOLATION` |
| Repository/PostgreSQL | create run/items/audit；并发 reserve 与预算竞争；exactly-once settle/release；取消前/后与无免费证据取消；同 key 同 payload；新 attempt/换 binding 另 reserve；append-only history；同/异 fingerprint；先前 FAIL；unknown/crash/resume；stale reservation reconciliation；transaction rollback 不留下半套账本/verification |
| Runtime TCP | 现有 create/query/cancel、引用、400/402/429/503、timeout；只在 provider 已验证支持时同 key 重放；不支持则 `SUBMISSION_UNKNOWN / NEEDS_RECONCILIATION` 且无第二次 create；`REFERENCE_FIXTURE_UNAVAILABLE`；外部 provider 不收到 localhost URL |
| API/UI | 客户端伪造成本/fingerprint 被拒；preview revision race；五类指标语义、分单位成本、中文跳过原因；desktop/390px/430px 无溢出 |

PostgreSQL integration 只使用既有 `VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1`，测试文件在 flag 启用但缺 isolated `DATABASE_URL` 时必须失败，不能 skip。CI 为 validation suite 创建独立测试数据库，显式列入 `video-validation.postgres.test.ts` 并使用 `--no-file-parallelism`；数据再以每 run UUID namespace 隔离，不清理其他测试数据。CI 检查该 suite 的执行用例数非零，并在失败时阻断发布。unit/full test、TypeScript、ESLint、Prettier、production build、release/UTF-8 check、浏览器回归均为实施验收门禁。默认流程只连本地 TCP fixture，不读取真实渠道密钥，不创建 provider video。真实 canary 另由管理员在预算 preview 后明确确认。

## 10. 验收标准与待决事项

- 实际 68 个或任意数量的视频模型按实时 binding/fingerprint 列出 family 与 fingerprint 数量、各 fingerprint 的 cheapest canary、provider 原始估价（按单位分组）、HOTX credits、所有跳过项原因；不得 hard-code 样本数或费用。
- 每个 live submit 前有原子 reservation；并发提交不超可验证成本上界；terminal 转换幂等，run/item/history/audit 一致。
- `changed_models` 对未验证、drift 或失败 binding/case 触发 live；同 fingerprint 最近 PASS 则 `SKIPPED_UNCHANGED`；未知提交只在上游证明同键幂等/查询时恢复旧身份，否则保持 `SUBMISSION_UNKNOWN` 并转 reconciliation。
- PostgreSQL integration suite 在 CI 确实执行且覆盖恢复路径；原视频生成、用户账务和 DFLOP 图片/视频适配测试不回归。

**已锁定的设计决策：** 方案 A；binding 隔离的验证历史；V1 SHA-256 fingerprint；HOTX credits 预算；可证明上界才允许 live；原始 provider 单位保留；未知提交保留 reservation；不改用户结算。\
**待用户决定：** 无阻塞实施计划的问题。实施阶段需分别审计每类 provider/case 的提交前成本上界证据与终态 actual-cost 能力。只有无法证明提交前 conservative maximum `estimatedCredits` 的 case 才因 budget gate 跳过 live；actual cost 不可得的 case 可 live，并以 `ESTIMATED_FALLBACK` 保守结算、保留 capability/provenance 供审计。\
**下一步：** 用户批准本文后编写独立 V2 implementation plan；在批准前不修改实现代码。
