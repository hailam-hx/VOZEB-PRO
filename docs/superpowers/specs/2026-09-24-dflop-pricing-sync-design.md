# DFLOP 价格同步与 HOTX 建议售价设计

**日期：** 2026-09-24\
**状态：** 待书面审阅\
**范围：** DFLOP 模型目录价格同步、供应商成本换算、建议售价、价格来源与漂移审计\
**明确不在范围：** 修改 hold、settlement、refund、retry/recovery、usage snapshot 或现有最终结算公式

## 1. 目标

管理员在 DFLOP 渠道点击“拉取模型”后，系统继续以当前 API Key 的 `/v1/models` 结果作为允许使用的模型集合，并使用 `/api/v1/models/public` 补充模型 metadata 和结构化价格。系统同时读取 `/api/v1/config/currency` 的 DFLOP credits/CNY 配置，将上游价格精确换算为 HOTX credits 成本，生成可审计的建议售价，但默认不修改正式 `saleRateCard`。

本设计保持三层价格严格分离：

1. DFLOP 原始价格：上游 credits 计价，完整保留原始 snapshot。
2. HOTX provider cost：换算为 HOTX credits 后，写入 binding 级成本价格档案和安全可执行的 `costRateCard`。
3. HOTX sell price：logical model 级 `suggestedSaleRateCard` 与正式 `saleRateCard` 分开保存。

新模型若 `callable=true` 但价格 basis 无法可靠识别，必须标记 `NEEDS_REVIEW`，不得按零成本自动启用收费。

## 2. 现有系统基线

当前项目已经具备：

- `LogicalModelBinding.costRateCard`：binding 级供应商成本价格卡。
- `LogicalModelBinding.providerCostUnit`：USD 或带版本的 provider-native → USD 转换快照。
- `LogicalModel.saleRateCard`：logical model 级正式 HOTX 售价。
- `decimal.js` 封装：金额解析、乘除、精度验证和最终舍入。
- `wallet_holds`、`usage_charges`、`provider_usage_attempts`：分别保存预留、最终用户收费和供应商尝试成本 snapshot。
- `audit_logs`：通用后台审计日志。
- `app_settings.logical_models` JSONB：保存 logical model、binding、能力档案和价格卡。
- DFLOP public registry merge：已经按 canonical model ID 合并 API Key 可见模型与 public metadata。
- `DflopUpstreamModelMetadata.pricing`：目前仅保留有限字段，尚未形成来源明确、可换算、可审计的价格档案。

当前没有统一的模型 markup/minimum-margin policy。正式售价由管理员配置，系统不能自行假设利润率。

## 3. 选定方案

沿用现有 JSONB、Rate Card、settings repository 和 audit log，不新增价格业务表。

- `app_settings` 增加 `pricing_policy JSONB`。
- binding 增加 `providerPricingProfile`。
- logical model 增加 `suggestedSaleRateCard` 和对应计算 snapshot。
- 正式 `saleRateCard` 继续作为用户结算的唯一销售价格事实来源。
- 价格同步审计写入现有 `audit_logs`。

项目尚未上线，数据库 schema 直接加入新字段，不编写旧结构迁移兼容或回填脚本。文件 provider 使用相同的新结构。

## 4. 系统价格策略

### 4.1 数据结构

```ts
type PricingCostBasis =
    | "max_active_binding_cost"
    | "primary_binding_cost";

type SystemPricingPolicy = {
    version: string;
    dflopCreditsPerCny: string;
    dflopCreditsPerCnySource: "upstream" | "manual" | "default";
    dflopCurrencyConfigVersion?: string;
    dflopCurrencySyncedAt?: string;
    cnyToUsd: string;
    hotxUsdPerCredit: string;
    markupMultiplier: string;
    minimumMarginRate: string | null;
    costBasis: PricingCostBasis;
    autoApplySalePrice: boolean;
};
```

默认值：

```json
{
  "dflopCreditsPerCny": "60",
  "dflopCreditsPerCnySource": "default",
  "cnyToUsd": "0.15",
  "hotxUsdPerCredit": "1",
  "markupMultiplier": "1",
  "minimumMarginRate": null,
  "costBasis": "max_active_binding_cost",
  "autoApplySalePrice": false
}
```

`version` 由经过规范化的策略字段生成稳定 revision，不使用时间戳作为内容版本。

### 4.2 DFLOP currency 配置

同步时请求：

```text
GET https://api.dflop.top/api/v1/config/currency
```

解析规则：

- 只接受能明确表达 credits/CNY 的正十进制值。
- 成功时更新 `dflopCreditsPerCny`、source、版本和同步时间。
- endpoint 失败或响应不可识别时保留上次有效值并输出 warning。
- 系统从未保存有效值时才使用默认 `"60"`，并明确标记 `source="default"`。
- 管理员将该字段标记为 manual 后，普通模型同步不覆盖，只记录 upstream drift。

### 4.3 精确换算

```text
providerCostHotxCredits
= dflopCredits
÷ dflopCreditsPerCny
× cnyToUsd
÷ hotxUsdPerCredit
```

所有输入均以字符串进入 Decimal。禁止先经过 `Number` 或 `parseFloat` 再参与财务计算。

当前策略下：

```text
224.532 ÷ 60 × 0.15 ÷ 1 = 0.56133 HOTX credits
90.72 ÷ 60 × 0.15 ÷ 1 = 0.2268 HOTX credits
```

## 5. Provider pricing profile

### 5.1 Profile

```ts
type ProviderPricingStatus = "READY" | "PARTIAL" | "NEEDS_REVIEW" | "STALE";

type ProviderPricingProfile = {
    provider: "dflop";
    modelId: string;
    status: ProviderPricingStatus;
    syncedAt: string;
    raw: Record<string, unknown>;
    discount?: string;
    dimensions: ProviderPricingDimension[];
    unknownFields: string[];
    missingFields: string[];
    warnings: ProviderPricingWarning[];
    conversion: ProviderPricingConversionSnapshot;
};
```

`raw` 保存 public registry 当前模型的完整 pricing snapshot。未知字段不会导致同步失败，也不会自动进入计价。

### 5.2 Dimension 级来源与人工覆盖

```ts
type ProviderPricingDimension = {
    id: string;
    kind: ProviderPricingDimensionKind;
    key?: string;
    unit: string;
    source: "upstream" | "manual";
    upstreamValue?: string;
    effectiveValue: string;
    syncedAt: string;
    conditions?: Record<string, string>;
    metadata?: Record<string, unknown>;
};
```

每个 dimension 独立同步：

- `source="upstream"`：上游有新值时更新 `upstreamValue` 和 `effectiveValue`。
- `source="manual"`：只更新 `upstreamValue`；保留 `effectiveValue`，并在值不同时生成 drift。
- 上游字段缺失：保留最后有效的 `effectiveValue`，将 profile 标记为 `STALE` 或 `PARTIAL`，写入 missing warning。
- 上游明确返回合法零值：按零保存。`missing !== zero`。
- 管理员只修改 720p 时，不影响 1080p 等其他 dimension 的自动同步。

例如：

```text
720p source=manual, effective=0.25, upstream=0.2268
1080p source=upstream, effective=0.56133
```

下次同步只自动更新 1080p；720p 产生 `PRICING_DRIFT`。

### 5.3 转换 snapshot

```ts
type ProviderPricingConversionSnapshot = {
    pricingPolicyVersion: string;
    dflopCreditsPerCny: string;
    dflopCreditsPerCnySource: "upstream" | "manual" | "default";
    dflopCurrencyConfigVersion?: string;
    cnyToUsd: string;
    hotxUsdPerCredit: string;
    calculatedAt: string;
};
```

汇率或换算参数变化时，系统使用原始 DFLOP dimension 值重新生成 HOTX provider cost，不丢失原始价格。

## 6. DFLOP pricing parser

Parser 只读取 structured pricing fields，不从 description 猜价格。

### 6.1 Text

识别：

- `input_per_1m`
- `cached_input_per_1m`
- `output_per_1m`
- `cache_creation_per_1m`
- `long_context_threshold_tokens`
- `input_per_1m_long`
- `cached_input_per_1m_long`
- `output_per_1m_long`
- `price_per_server_tool_call`

Long-context threshold 与 normal/long tier 完整保存在 profile 中。server tool call 保持独立 dimension。

### 6.2 Image

识别：

- `price_per_image`
- `price_per_input_image`
- `price_per_image_large`
- `images_per_request`

`images_per_request` 保存为 upstream metadata，不等同于用户请求 `n`、最大批量数或实际计费数量。

### 6.3 Video

识别：

- `price_per_video_second`
- `video_price_tiers`
- `video_token_price_per_1m`
- `video_second_stage_per_second`

所有 tier 键按上游实际返回保存和规范化，不维护固定 resolution 列表。`video_token_price_per_1m` 仅在对应 SKU 的 billing basis 明确为 token 时才可标记为 executable。`usage.completion_tokens` 的存在本身不能改变 billing basis。

Second-stage 价格独立保存；只有实际 usage contract 明确任务触发 second stage 时才能参与成本计算。

若模型按 `input video duration + output duration` 计费，profile 明确记录该 basis。当前 settlement 未提供该完整 usage 时，dimension 保留但标记 non-executable，不修改现有 settlement。

### 6.4 Audio、Voice、Music、Avatar

识别当前或未来出现的结构化字段，包括：

- `price_per_tts_char`
- `price_per_voice_clone`
- `price_per_generation`
- `price_per_call`
- `price_per_second`

根据模型 category、endpoint type 和字段语义映射为 TTS、voice clone、music、avatar 或 OTHER dimension。不能将其强行塞入 image/video schema。

### 6.5 Unknown fields 与 discount

- 未识别 pricing field 保存在 `raw`，加入 `unknownFields` 并输出 warning。
- 未识别字段不参与成本或建议售价。
- `discount` 仅保存为 metadata；structured price 字段视为 gateway 实际价格，不再次乘 discount。

## 7. costRateCard 生成边界

`providerPricingProfile` 是 DFLOP 成本事实的完整表达；`costRateCard` 是其中可以被当前 usage contract 安全执行的投影。

能够映射到现有稳定 usage 的维度才进入 `costRateCard`，例如：

- text input/cached/output tokens；
- image output count；
- video delivered seconds + 已知 resolution condition；
- TTS characters；
- voice clone request count。

Long-context、cache creation、server tool call、video token、input-video duration、second-stage 等维度即使完整保存，也不能在缺少明确 usage contract 时伪装成普通组件。此类模型或 dimension 标记 `PARTIAL`/`NEEDS_REVIEW`。

现有 provider attempt、usage settlement 和最终销售收费公式不改变。

## 8. Logical model 建议售价

### 8.1 数据结构

```ts
type SuggestedSaleRateCard = {
    rateCard: PricingRateCardV1;
    pricingPolicyVersion: string;
    calculatedAt: string;
    costBasis: PricingCostBasis;
    markupMultiplier: string;
    bindingInputs: Array<{
        bindingId: string;
        channelId: string;
        provider: string;
        costRateRevision: string;
        pricingStatus: ProviderPricingStatus;
    }>;
    conversionInputs: Array<ProviderPricingConversionSnapshot>;
};
```

### 8.2 当前默认成本基准

默认：

```text
costBasis = max_active_binding_cost
```

参与计算的 binding 必须同时满足：

- binding enabled；
- channel enabled 且连接配置有效；
- 与 logical model capability 相容；
- 当前 routing eligibility 未被静态配置排除；
- pricing status 为 `READY`，或该 dimension 明确 executable；
- 对应 pricing dimension、单位和条件可以规范化比较。

按同一 canonical pricing dimension 和相同条件集合比较所有 eligible binding 的 HOTX 成本，逐维选择最高值。不能只取 DFLOP、priority 最小或当前 primary binding。

若某 binding 缺少某一售卖 dimension 的可信成本：

- 不把缺失当零；
- 将建议价标记 incomplete；
- 不允许该不完整建议价自动应用到正式售价。

预留策略：

```text
primary_binding_cost
```

该策略选择当前 routing 顺序中第一条可计价 eligible binding，但本阶段不作为默认值。

### 8.3 建议售价计算

```text
suggested dimension price
= selected provider cost dimension
× markupMultiplier
```

`markupMultiplier="1"` 表示 break-even 成本基准建议价，不表示正式商业售价。

`autoApplySalePrice=false` 为默认值。因此正常 DFLOP 同步只更新：

```text
providerPricingProfile
→ costRateCard
→ suggestedSaleRateCard
```

绝不自动覆盖 `saleRateCard`。

只有管理员配置正式 markup/minimum margin 并明确开启 `autoApplySalePrice` 后，系统才允许将完整且安全的建议价写入正式 `saleRateCard`。首次开启和后续策略更新均写审计日志。

## 9. Margin 与漂移保护

### 9.1 Pricing drift

以下变化产生 drift：

- manual provider dimension 与新 upstream value 不同；
- manual `dflopCreditsPerCny` 与 currency endpoint 不同；
- manual sale price 未随建议售价变化；
- 某价格字段从 registry 消失；
- 某模型 billing basis 变为未知或不再 executable。

### 9.2 Below cost

使用与建议价相同的 cost basis 比较正式售价：

- `effectiveSellPrice < max active binding cost`：严重 `BELOW_COST`。
- `minimumMarginRate != null` 且实际 margin 低于阈值：`MARGIN_BELOW_MINIMUM`。
- manual sale price 只报警，不自动修改。
- auto sale price 仅在 `autoApplySalePrice=true` 且建议价完整时重新计算。

## 10. 同步数据流

```text
GET /v1/models with API Key
        ↓ visible/allowed model ids
GET /api/v1/models/public
        ↓ metadata + structured pricing
GET /api/v1/config/currency
        ↓ DFLOP credits/CNY
canonical model-id merge
        ↓
model discovery + capability sync
        ↓
raw pricing snapshot + dimension parser
        ↓
dimension-level manual/upstream reconciliation
        ↓
Decimal currency conversion
        ↓
binding providerPricingProfile + executable costRateCard
        ↓
logical model cost-basis aggregation
        ↓
suggestedSaleRateCard
        ↓
drift / stale / below-cost warnings + audit
```

`/v1/models` 失败时整次同步失败，不能用 public registry 绕过 API Key allowlist。Public registry 或 currency endpoint 单独失败时，模型发现可继续，但价格使用最后有效 snapshot，并明确返回 warning。

## 11. 持久化与数据库

### 11.1 PostgreSQL

直接修改当前 schema：

```sql
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS pricing_policy jsonb NOT NULL DEFAULT '{}'::jsonb;
```

同时修改初始 `CREATE TABLE app_settings` 定义。项目未上线，不增加旧字段迁移、双写或兼容读取。

`providerPricingProfile`、`costRateCard`、`suggestedSaleRateCard` 和正式 `saleRateCard` 继续位于 `logical_models` JSONB 内。价格同步历史使用 `audit_logs`，不新增价格历史表。

### 11.2 Repository 与 file provider

- settings repository 读写 `pricing_policy`，使用参数化 JSONB。
- settings merge 必须保留未修改的价格策略字段。
- 文件 provider 使用相同 normalized contract。
- 管理员保存后立即读取必须绕过缓存并刷新模块缓存，符合现有设置一致性规则。

### 11.3 文档

更新 `docs/content/docs/backend/backend-database.mdx`，说明 pricing policy、logical model 价格层级、来源和 audit 行为。

## 12. API 设计

### 12.1 DFLOP 拉取模型

扩展现有：

```text
POST /api/admin/models
```

响应增加：

```ts
{
  pricingPolicyPatch?: Partial<SystemPricingPolicy>;
  pricingSync?: {
    profiles: Record<string, ProviderPricingProfile>;
    stats: DflopPricingSyncStats;
    warnings: ProviderPricingWarning[];
  };
}
```

Route Handler 继续只处理认证、输入、服务调用和响应映射。DFLOP 请求、parser、reconcile、换算和统计放入 server/service 与纯函数模块。

拉取动作先更新管理页面草稿；与现有渠道/模型设置一起保存时才持久化。预览拉取不写价格变更审计，避免把未保存结果记录为正式配置变化。

保存草稿时，服务端必须再次读取 DFLOP `/api/v1/config/currency`，只有 `dflopCreditsPerCny`、currency snapshot version 与最终 `pricingPolicyVersion` 都和上游一致时，才接受客户端随渠道草稿带回的服务端管理字段。验证失败时拒绝保存该汇率草稿，不能信任客户端值或静默回退。

### 12.2 管理员模型价格 API

扩展现有：

```text
GET/PATCH /api/admin/billing/model-pricing
```

支持：

- 查看 provider raw/effective dimension；
- dimension 级 manual override；
- 恢复某 dimension 的 upstream 值；
- 查看 suggested price calculation snapshot；
- 保存正式 `saleRateCard`；
- 设置 `salePriceSource`；
- 返回 drift、stale、needs-review、below-cost warning。

服务端拒绝客户端伪造 derived cost、suggested price、policy revision 或同步时间。客户端只提交允许修改的 manual value/source 和正式售价。

### 12.3 Pricing policy API

在现有管理员设置 API 的授权和一致性约束下增加 pricing policy GET/PATCH，或在 billing 设置路由中提供专用端点。权限使用 `billing.manage`；DFLOP 目录拉取继续使用 `upstream.manage`。

可修改字段：

- `cnyToUsd`
- `hotxUsdPerCredit`
- `markupMultiplier`
- `minimumMarginRate`
- `costBasis`
- `autoApplySalePrice`
- DFLOP credits/CNY 的 manual/upstream source 切换

保存后服务端重算 provider cost 与 suggested price；不会等待下次模型同步。

## 13. Service 与模块边界

计划新增或扩展以下职责：

1. `dflop-pricing-parser`：解析 structured pricing、保留 raw、识别 unknown fields。
2. `provider-pricing` domain：normalize dimension、dimension ID、source reconcile、missing/stale/drift。
3. `pricing-policy` domain：校验策略、生成稳定 version、Decimal 换算。
4. `suggested-model-pricing`：过滤 eligible binding、实现 cost basis、逐维聚合并生成 calculation snapshot。
5. `dflop-model-sync` service：组合 catalog、currency、metadata、capability 和 pricing 结果。
6. settings/model normalization：持久化新字段并保护 manual dimension。
7. admin pricing service：服务器权威地应用人工覆盖、恢复 upstream、重算和审计。

这些模块不调用 wallet 或 settlement service。

## 14. 管理后台 UI

### 14.1 渠道模型同步

“拉取模型”结果增加价格摘要：

- 已识别价格档案数；
- 新增、更新、未变化；
- 涨价、降价；
- 缺失价格；
- 未知字段；
- manual override 保留数；
- below-cost warning 数；
- currency endpoint 状态和采用的转换版本。

### 14.2 模型路由/价格配置

按 logical model 展示：

- 每个 binding 的 DFLOP 原始成本与 HOTX 成本；
- resolution/token/image/audio 等 dimension；
- dimension 来源：上游/手动；
- upstream value 与 effective value；
- 最近同步时间；
- stale、needs review、drift；
- logical model 建议售价、正式售价和来源；
- cost basis 与 pricing policy version；
- below-cost/minimum-margin 警告。

提供单 dimension 编辑和“恢复上游值”，不能用整 profile 的 manual 开关替代。

### 14.3 系统定价策略

后台财务设置增加紧凑表单：

- DFLOP credits/CNY、来源和最近同步时间；
- CNY/USD；
- HOTX USD/credit；
- markup multiplier；
- minimum margin；
- cost basis；
- auto apply sale price。

`autoApplySalePrice` 开启前明确展示其影响范围；默认关闭。页面文案保持中文，并补齐现有多语言资源。

## 15. 审计与日志

### 15.1 Audit log

正式保存同步结果时记录：

- model、binding、dimension；
- old upstream/effective value；
- new upstream/effective value；
- source；
- pricing policy version；
- conversion snapshot；
- changedAt；
- warning/drift 类型。

只记录发生变化的 dimension；不记录 API Key。

### 15.2 同步日志

```text
DFLOP pricing sync:
models=<n>
pricingProfiles=<n>
created=<n>
updated=<n>
unchanged=<n>
priceIncreases=<n>
priceDecreases=<n>
missingPricing=<n>
unknownPricingFields=<n>
manualOverridesPreserved=<n>
belowCostWarnings=<n>
```

统计值来自实际同步结果，不写死模型数或价格数。

## 16. 错误与降级规则

- `/v1/models` 认证或拉取失败：整个同步失败，不保存 public registry 模型或价格。
- Public registry 失败：保留 `/v1/models` 发现；价格保持最后有效值并标记 stale，不清零。
- Currency endpoint 失败：保留最后有效 conversion；首次失败使用明确标记的默认值。
- Model ID 不完全一致：只按 canonical ID merge，未匹配模型保留 discovery，价格标记 missing。
- Duplicate ID：按 canonical ID 去重，保留确定性的第一条/合并规则并记录 debug log。
- Unknown pricing field：保留 raw、warning、不可执行，不 crash。
- 无法确定 billing basis：`NEEDS_REVIEW`，不得自动产生零成本或应用正式售价。
- 自动建议价不完整：保留上一份有效建议价并标记 stale，禁止自动应用。

## 17. 测试设计

### 17.1 Parser 与 Decimal

- Text input/output/cached/cache creation。
- Long-context threshold 与 normal/long tier。
- Server tool call。
- Image output/input/large 与 `images_per_request`。
- Video per-second、动态 resolution tiers、video token tiers、second-stage。
- Input-video billing basis。
- TTS per character、voice clone per call、music/avatar/other。
- Unknown fields 保留 raw。
- Discount 不重复应用。
- 高精度和非终止中间结果使用 Decimal。
- `224.532 → 0.56133`、`90.72 → 0.2268`。

### 17.2 同步与覆盖

- API Key allowed-model subset。
- Duplicate canonical IDs。
- Provider price increase/decrease/unchanged。
- Missing price 不变为零。
- Public registry failure fallback。
- Currency endpoint success/failure/invalid payload。
- Currency manual override 与 drift。
- Dimension 级 manual：720p 保留、1080p 更新。
- New callable model + unknown basis → `NEEDS_REVIEW`。

### 17.3 Suggested pricing

- `max_active_binding_cost` 逐维选择最高成本。
- 禁用 channel/binding、不兼容 binding、不可计价 status 不参与。
- 某 binding dimension 缺失时不当零。
- `primary_binding_cost` 可选策略。
- markup=1 生成 break-even suggestion。
- 建议价保存 policy version、calculatedAt、cost basis 和 binding inputs。
- 默认不覆盖 `saleRateCard`。
- manual sale price 保留并产生 drift/below-cost warning。
- auto apply 仅在明确开启且 suggestion 完整时执行。

### 17.4 Regression

- 现有 text/image/video/audio pricing。
- Usage hold。
- Settlement。
- Refund。
- Retry/recovery。
- Provider attempt cost snapshot。
- DFLOP image/video generation 和 Seedance runtime。
- 非 DFLOP 渠道同步与价格配置。
- Settings 即时保存/读取/刷新一致性。

### 17.5 UI 与浏览器

- Dimension 来源、原值、有效值和恢复上游操作。
- Pricing policy 编辑和默认关闭 auto apply。
- Drift/stale/needs-review/below-cost 状态。
- 同步统计无硬编码。
- Desktop、390px、430px，浅色/深色、无横向溢出。

## 18. 预计文件范围

实施计划阶段将精确到函数和测试用例，预计涉及：

- `web/src/lib/auth/store-types.ts`
- `web/src/lib/auth/store-normalizers*.ts`
- `web/src/lib/billing/pricing.ts`
- `web/src/lib/billing/money.ts`
- `web/src/lib/dflop-model-metadata.ts`
- 新的 DFLOP pricing/domain 纯函数模块及测试
- `web/src/lib/model-routing-config.ts`
- `web/src/lib/server/admin-model-catalog.ts`
- `web/src/lib/server/admin-model-pricing-service.ts`
- `web/src/app/api/admin/models/route.ts`
- `web/src/app/api/admin/billing/model-pricing/route.ts`
- settings/pricing policy API 与 service
- `web/src/lib/server/database/schema.ts`
- `web/src/lib/server/database/repositories.ts`
- 管理后台渠道同步、模型价格和 billing 设置组件
- `web/src/services/api/admin-billing-commerce.ts`
- `web/src/i18n/messages/{zh-CN,en,vi}.json`
- `docs/content/docs/backend/backend-database.mdx`
- 对应 unit、route、DOM、PostgreSQL integration、fixture 和 E2E 测试

## 19. 验收条件

1. DFLOP 可见模型集合仍完全受 API Key `/v1/models` 控制。
2. 所有已识别价格字段、未知字段和 raw snapshot 均不丢失。
3. Currency 配置优先读取上游；失败时不破坏上次有效值。
4. 所有金额换算使用 Decimal，示例结果精确匹配。
5. Dimension 级 manual override 独立生效。
6. `costRateCard`、`suggestedSaleRateCard`、`saleRateCard` 三层不混用。
7. 建议价默认使用 `max_active_binding_cost`。
8. 建议价保存完整 policy/conversion/binding calculation snapshot。
9. markup=1 仅产生 break-even suggestion；默认不覆盖正式售价。
10. Missing 不变为零，unknown basis 不以零成本上线。
11. Discount 不重复计算。
12. Hold、settlement、refund、retry/recovery 和 usage snapshot 行为不变。
13. 全量测试、typecheck、lint、build、release check、UTF-8 检查和浏览器回归通过。
