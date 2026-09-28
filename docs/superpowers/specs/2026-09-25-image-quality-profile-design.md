# `/create` 图片画质能力档案正式设计

**状态：** 待设计评审\
**日期：** 2026-09-25\
**采用方案：** A — binding 级 `ImageQualityProfile` + 服务端统一解析的 normalized context

## 1. 背景与问题

`/create` 当前固定展示“智能 / 高 / 中 / 低”，这些值来自前端平台常量，而不是逻辑模型绑定的真实上游能力。实际启用的 25 个图片逻辑模型，其 binding `generationParameters.qualities` 当前均为空，因此页面只能显示一组不可用的固定占位。

现有链路还存在更严重的语义分裂：一旦管理员手工填入 generic quality，前端会提交 `quality`，图片尺寸服务会把 low/medium/high 换算为平台固定尺寸，部分 provider 请求又不会发送该字段，而预计积分只能把它作为 generic quality 匹配。最终可能出现页面选项、实际请求、模型路由和计价采用不同解释。

DFLOP 的图片模型也没有统一的 `quality=high|medium|low` 契约：

- Midjourney 使用 prompt 后缀控制标准/高清模式；该选择不等同于图片尺寸。
- Qwen Image 3.0 Pro 按明确的 1K/2K 分辨率档计价，但必须解析为经过验证的 exact size。
- Seedream 5 Pro 按实际像素面积区分价格档，档位由 exact width/height 计算，不能由 generic quality 推断。
- Grok standard/quality、GPT Image 2.5 Flare/Sunburst 等当前是独立模型或逻辑模型，不是同一模型下的 quality 选项。

本设计以 binding 能力档案为事实来源，在任务创建前将用户选择完整解析为一个可执行且可计价的上下文，并让路由、上游请求、预计积分、预扣和使用快照共同消费该上下文。

## 2. 目标

1. 图片画质入口只显示当前逻辑模型真实可用的选项。
2. 画质选项可以表达 request parameter、prompt flag、resolution tier、pixel tier 和显式配置的 model variant。
3. 用户选择必须在服务端解析为确定的 binding、upstream model、请求参数、内部执行 prompt 和计价维度。
4. 预计积分和服务端预扣使用同一 normalized pricing context。
5. DFLOP 同步可以写入上游能力，管理员可以按 profile 手工覆盖，后续同步不得覆盖 manual profile。
6. 切换模型、能力修订或绑定路由后，不得残留旧模型的画质含义。
7. 保持已有图片生成、结果落盘、多图结果、settlement、refund、retry 和 usage snapshot 机制不变。

## 3. 不在本次范围

- 不合并当前独立存在的逻辑模型或 model variant。
- 不为未验证的模型补写 low/medium/high。
- 不改变正式 `saleRateCard`、markup、结算公式或退款规则。
- 不通过模型名称关键字推断画质能力。
- 不新增数据库表；继续使用现有逻辑模型/binding JSON 配置。
- 不在线探测未知尺寸并自动扩展生产能力；新增探测结果需走已有能力证据和管理员确认流程。

## 4. 强制不变量

以下规则必须同时由共享领域解析器和服务端任务创建入口执行，前端禁用状态不能代替服务端校验。

### 4.1 完整解析规则

> 任何会影响 upstream execution 或计价的画质选项，都必须完整解析为可执行且可计价的 normalized context；无法解析时不得提交任务。

具体含义：

- 不允许只得到显示标签而没有确定的上游效果。
- 不允许只得到上游参数而没有确定的计价维度。
- 不允许预计积分采用一个档位，而 provider 请求采用另一个档位。
- 不允许先创建任务或预扣，再在 worker 内猜测缺失的尺寸、档位或模型。
- 对候选 binding 逐一解析；只有解析成功且能力、计价均匹配的 binding 才能参与路由。
- 所有候选都无法解析时，在任务、预扣和上游调用产生前返回明确错误。

### 4.2 Provider 硬边界

1. **Qwen 不猜 exact size。** 1K/2K 选项只能使用能力档案中经过验证的 exact size 或显式 `sizeByAspectRatio` 映射。不得按比例、最长边、像素面积或通用平台默认值推导 Qwen exact size。
2. **Seedream 不用 generic quality 推断 pixel tier。** pixel tier 只能由已解析的 exact width/height 和官方阈值计算；画质标签不能反向生成尺寸或档位。
3. **Midjourney 不把 quality 转换为 size。** 标准/高清仅解析为规范化 prompt flag；图片比例/尺寸继续按 Midjourney 自身独立契约处理。
4. **Model variant 不自动合并。** 独立 logical model、binding 或 upstream model ID 保持独立。只有管理员在同一 logical model 内显式配置 `model_variant` profile 后，解析器才允许选择对应 binding；同步过程不得自动把名称相近的模型合并成画质选项。

### 4.3 单一解释规则

- 客户端只提交符号化的画质选项值以及用户真实选择的比例/尺寸等输入。
- 客户端不得提交可直接信任的 upstream model、prompt suffix、pixel tier、resolution tier、provider price 或最终金额。
- 服务端重新读取当前 logical model、binding、profile revision、能力与正式售价，再生成 normalized context。
- worker 只能消费已保存的 normalized execution snapshot，不得再次独立解释画质。

## 5. 领域模型

### 5.1 Binding 级画质能力

在 `LogicalModelBinding` 增加可选字段 `imageQualityProfile`：

```ts
type ImageQualityControlType =
  | "request_parameter"
  | "model_variant"
  | "prompt_flag"
  | "resolution_tier"
  | "pixel_tier"
  | "none";

type ImageQualityProfileSource =
  | "manual"
  | "structured_upstream"
  | "provider_preset"
  | "description"
  | "none";

type ImageQualityOptionEffect =
  | {
      kind: "request_parameter";
      parameter: string;
      upstreamValue: string;
    }
  | {
      kind: "model_variant";
      bindingId: string;
      upstreamModelId: string;
    }
  | {
      kind: "prompt_flag";
      flag: string;
      mutuallyExclusiveGroup: string;
    }
  | {
      kind: "resolution_tier";
      pricingResolution: string;
      exactSizes: string[];
      sizeByAspectRatio?: Record<string, string>;
    }
  | {
      kind: "pixel_tier";
      pricingPixelTier: string;
      minPixels?: string;
      maxPixels?: string;
    };

type ImageQualityOption = {
  value: string;
  label: string;
  description?: string;
  effect: ImageQualityOptionEffect;
  isDefault?: boolean;
};

type ImageQualityProfile = {
  supported: boolean;
  controlType: ImageQualityControlType;
  selectionMode: "explicit" | "derived" | "none";
  presentation: "quality" | "resolution" | "size" | "hidden";
  options: ImageQualityOption[];
  source: ImageQualityProfileSource;
  revision: string;
  syncedAt?: string;
  evidence?: {
    kind: "structured_metadata" | "official_docs" | "controlled_probe" | "manual";
    reference?: string;
    observedAt?: string;
  }[];
};
```

约束：

- `supported=false` 时 `controlType="none"`、`selectionMode="none"`、`presentation="hidden"`、`options=[]`。
- `supported=true` 时至少有一个完整 effect；value 在 profile 内唯一；最多一个 default。
- `selectionMode="explicit"` 表示用户或规划器选择 option；`selectionMode="derived"` 表示 option 只能由 exact execution input 计算，客户端不得反向提交该 option 来生成输入。
- `revision` 由影响执行或计价的规范化 profile 内容计算，label/description 的纯展示改动不改变执行 revision。
- Decimal/像素边界等需要精确比较的数值在配置中使用十进制字符串。
- `generationParameters.qualities` 不再承担 DFLOP 画质语义；完成迁移后只保留给真正声明 generic request parameter 的其他 provider，并由 adapter profile 显式映射。

### 5.2 上游候选与手工覆盖

binding 同时允许保存 provider 同步候选，用于 drift 显示：

```ts
type BindingImageQualityState = {
  imageQualityProfile: ImageQualityProfile;
  upstreamImageQualityProfile?: ImageQualityProfile;
  imageQualityDrift?: {
    detectedAt: string;
    upstreamRevision: string;
    effectiveRevision: string;
  };
};
```

- effective profile 来源为 `manual` 时，同步只更新 `upstreamImageQualityProfile` 和 drift，不覆盖 effective profile。
- 非 manual profile 按证据优先级更新，并重新生成 revision。
- logical model 不持久化一个自动合并的 profile；公开能力由当前 active/enabled/eligible bindings 实时派生。

## 6. Normalized context

### 6.1 解析输入

```ts
type ResolveImageQualityInput = {
  logicalModelId: string;
  requestedBindingId?: string;
  selectedQualityValue?: string;
  requestedSize?: string;
  requestedAspectRatio?: string;
  publicPrompt: string;
};
```

`selectedQualityValue="auto"` 只是客户端 UX 值，不是 provider option。对于 `selectionMode="explicit"`，服务端把它解析为当前 profile 的唯一 default；无唯一 default 时必须继续由规划器给出明确选项或拒绝提交。对于 `selectionMode="derived"`，服务端忽略任何客户端档位意图，并只从已解析的 exact execution input 计算结果。

### 6.2 成功结果

```ts
type ResolvedImageExecutionContext = {
  logicalModelId: string;
  bindingId: string;
  upstreamModelId: string;
  profileRevision: string;
  selectedQualityValue?: string;
  publicPrompt: string;
  executionPrompt: string;
  request: {
    size?: string;
    aspectRatio?: string;
    parameters: Record<string, string>;
  };
  pricing: {
    resolution?: string;
    pixelTier?: string;
    quality?: string;
    width?: string;
    height?: string;
    megapixels?: string;
  };
  appliedEffects: Array<{
    kind: ImageQualityOptionEffect["kind"];
    value: string;
  }>;
};
```

成功的 normalized context 必须同时满足：

1. binding 可用且支持所有用户参数；
2. 上游模型与请求参数已确定；
3. 影响执行的 prompt flag 已规范化；
4. 正式 `saleRateCard` 能使用 pricing context 匹配一个确定价格；
5. 服务端预扣能使用同一价格和数量生成 hold；
6. 该 context 可以作为任务创建时的不可变 snapshot 保存。

### 6.3 失败结果

```ts
type ImageQualityResolutionErrorCode =
  | "IMAGE_QUALITY_UNSUPPORTED"
  | "IMAGE_QUALITY_OPTION_INVALID"
  | "IMAGE_QUALITY_PROFILE_CHANGED"
  | "IMAGE_QUALITY_SIZE_UNRESOLVED"
  | "IMAGE_QUALITY_EXECUTION_UNRESOLVED"
  | "IMAGE_QUALITY_PRICING_UNRESOLVED"
  | "IMAGE_QUALITY_NO_COMPATIBLE_BINDING";
```

API 继续使用 `{ code, data, msg }`。错误信息用中文说明具体模型、选项以及缺失的 exact size、执行映射或计价维度；不得静默回退为其他档位。

## 7. 各控制类型解析规则

### 7.1 `request_parameter`

- 仅发送 profile 明确声明的 parameter/upstreamValue。
- adapter 必须声明该字段如何进入 JSON 或 multipart 请求。
- pricing context 必须有显式映射；仅有请求参数但没有正式售价维度时解析失败。
- 禁止继续使用全局 low/medium/high 尺寸表替代 provider 契约。

### 7.2 `model_variant`

- option 必须引用同一 logical model 内已存在且可用的 binding。
- 引用的 `bindingId + upstreamModelId` 必须与服务端当前配置一致。
- 每个 variant 自己完成能力和计价匹配。
- 当前 Grok standard/quality 与 GPT Image 2.5 Flare/Sunburst 继续作为独立 logical models，不创建 selector，也不自动合并。

### 7.3 `prompt_flag`（Midjourney）

- 标准/高清选项分别映射到 profile 中明确的 `--sd`/`--hd`。
- canonicalizer 只处理该 mutually exclusive group：移除 execution prompt 末尾或 token 化后已存在的同组 flag，再追加唯一目标 flag。
- `publicPrompt` 与用户可复制的公开优化提示词不包含平台内部追加的 flag；`executionPrompt` 才用于上游。
- 该选项绝不修改 `size`、宽高或比例。
- 计价若不随 flag 变化，也必须明确匹配同一固定价格；不能因为价格相同而跳过执行解析。

### 7.4 `resolution_tier`（Qwen Image 3.0 Pro）

- 1K/2K option 保存经过官方资料或受控 probe 验证的 `exactSizes`。
- 用户已经选择 exact size 时，只接受该 exact size 位于选中 option 的列表中。
- 用户只选择比例时，只能读取该 option 的显式 `sizeByAspectRatio[ratio]`；不存在时返回 `IMAGE_QUALITY_SIZE_UNRESOLVED`。
- 禁止以最接近比例、最长边、总像素、平台默认尺寸或另一模型的映射补全。
- resolved size 同时进入上游 `size` 和 pricing `resolution`/width/height。
- 1K 与 2K 同价的模型可以共享售价，但仍需保存实际 resolution tier；不得丢弃执行差异。

### 7.5 `pixel_tier`（Seedream 5 Pro）

- pixel tier 不生成尺寸；它只校验已解析 exact size 对应的实际档位。
- profile 使用 `selectionMode="derived"`；normal/large 是解析结果和计价摘要，不是可点击后反推尺寸的画质按钮。
- exact size 来自用户明确尺寸、能力档案中明确的默认 exact size，或经过验证的 `sizeByAspectRatio`。缺失时不能使用 generic quality 补全。
- 使用整数宽高计算 pixels，并用 Decimal 按官方阈值选择 tier；边界包含关系由 profile 的 `minPixels/maxPixels` 明确表达。
- 客户端若伪造或残留提交 pixel-tier option，服务端拒绝；不把该 option 转换为尺寸，也不自动改档。
- resolved width/height、megapixels 和 pixelTier 同时进入请求与 pricing context。

### 7.6 `none`

- 不显示画质入口，不提交 `selectedQualityValue`。
- 仍按模型已有尺寸、比例和数量能力执行及计价。
- 收到旧客户端提交的画质值时返回 `IMAGE_QUALITY_UNSUPPORTED`，不忽略该值。

## 8. 有效能力派生与 UI

### 8.1 单模型

- 0 个真实选项：完全隐藏“画质”行。
- 1 个真实选项：隐藏选择器；仅当该选项及当前尺寸上下文可完整解析时作为默认执行效果。
- 2 个及以上真实选项：显示后台配置的 label，不再固定渲染高/中/低。
- `presentation="resolution"` 可显示“1K / 2K”；`presentation="quality"` 可显示“标准 / 高清”；`presentation="size"` 优先引导用户选 exact size，而不是伪装成 generic quality。
- `selectionMode="derived"` 不渲染独立 option selector；解析完成后可在摘要中只读显示实际档位和对应预计积分。

### 8.2 多模型手工选择

- 只展示所有选中逻辑模型都能解析的语义选项交集。
- 交集依据显式语义标识和每个模型自身 resolver 结果，不按 label 文本匹配。
- 若模型采用不同控制类型且没有显式公共语义，隐藏画质选择并清除旧值。
- 用户保留的比例/尺寸也必须对每个候选模型重新解析；不兼容模型不能参与执行。

### 8.3 智能规划

- 规划器只看到公开脱敏 profile 和可解析选项。
- 只要至少一个候选 binding 可以完整解析，规划器即可选择该模型与参数。
- 服务端最终仍逐 binding 解析和过滤，不信任规划输出中的 provider 字段。

### 8.4 切换与失效

- 切换 logical model 后，若旧 `selectedQualityValue` 不存在或当前尺寸无法解析，立即回到 `auto` 或清空。
- profile revision 变化后，客户端重新获取公开能力；服务端遇到旧 revision 不沿用旧映射。
- prompt flag 只在本次 normalized context 中生成，不写回输入框，因此切换模型不会残留 `--sd/--hd`。

### 8.5 预计积分

- 前端 estimator 使用公开 profile 调用同一纯解析规则的安全子集，得到 preview normalized pricing context。
- 无法完整解析时不显示旧价格，显示“当前参数无法解析为可执行计价配置”。
- 服务端任务创建时重新解析并以正式 `saleRateCard` 计算 authoritative estimate/hold。
- 用户侧显示的选项摘要与预计积分必须来自同一 preview context。

## 9. 数据流与事务边界

```text
公开 logical model + binding quality profile
                  ↓
用户选择 option / ratio / exact size
                  ↓
客户端 preview resolver → 预计积分（仅预览）
                  ↓
POST 创建请求（只提交符号值和原始选择）
                  ↓
服务端重新读取最新模型、binding、profile、saleRateCard
                  ↓
逐 binding resolve + capability filter + pricing match
                  ↓
选择兼容 binding，生成 ResolvedImageExecutionContext
                  ↓
同一业务创建流程写入 task config / pricing snapshot / hold
                  ↓
worker 直接消费 execution snapshot 构造上游请求
```

- normalized context 必须在创建任务和 hold 之前完成。
- 任务配置保存 profile revision、binding ID、upstream model ID、applied effects 和 pricing context。
- 请求幂等重试复用同一任务 snapshot；普通新提交重新解析最新 profile。
- 本设计不改变现有 hold、settlement、refund、retry 或 usage snapshot 的原子边界，只为其提供一致输入。

## 10. DFLOP 同步规则

证据优先级：

```text
manual effective profile
  > structured upstream metadata
  > verified provider preset / controlled probe
  > deterministic official description parser
  > none
```

规则：

1. 仅当 metadata 或官方文档能完整表达执行 effect 和计价维度时生成 profile。
2. model ID preset 必须是明确、可审计的 provider contract，不允许使用 `image`、`qwen`、`seedream`、`grok` 等名称包含判断。
3. `manual` effective profile 永不被普通拉取覆盖；上游变化记录为 drift。
4. public registry 缺失时保留当前有效 profile，并标为证据 stale/drift；不得从名称补猜新 profile。
5. profile 内容变化生成新 revision；纯显示文案变化不需要让执行 revision 失效。
6. DFLOP 同步继续保留当前模型发现 allowed-models 交集，不通过 public registry 给渠道添加 API Key 不可见模型。

## 11. 当前 DFLOP 模型落地矩阵

### 11.1 有真实画质控制（4 个逻辑模型）

| 逻辑模型 | controlType | UI | 解析效果 |
| --- | --- | --- | --- |
| `tvod-midjourney-v7` | `prompt_flag` | 标准 / 高清 | `--sd` / `--hd`，不改 size |
| `tvod-midjourney-v8.1` | `prompt_flag` | 标准 / 高清 | `--sd` / `--hd`，不改 size |
| `qwen-image-3.0-pro` | `resolution_tier` | 1K / 2K | 只使用已验证 exact size/ratio 映射 |
| `doubao-seedream-5-0-pro-260628` | `pixel_tier` | 不显示独立档位按钮；摘要只读显示 | 由 exact pixels 计算 normal/large |

### 11.2 不显示画质选择（21 个逻辑模型）

包括当前其余 GPT Image、Seedream、Grok、Nano Banana、Qwen、Kling、Hunyuan、Vidu 等图片逻辑模型。它们继续按既有尺寸/比例能力和正式售价执行。存在独立质量/速度/风格 variant 的模型继续由逻辑模型选择入口呈现，不转成画质选择器。

该矩阵是当前审计结果，不作为写死的产品数量。同步和 UI 统计始终根据实际 channel/binding 数据计算。

## 12. 管理后台

在 logical model binding 的“生成能力档案”增加“图片画质控制”区域：

- 是否支持、control type、selection mode、presentation。
- option value/label/default。
- request parameter、binding variant、prompt flag、resolution exact size、ratio map 或 pixel boundary。
- effective source、profile revision、evidence、最后同步时间。
- manual effective profile 与 upstream candidate 的 drift 预览。

保存校验：

- option value 唯一，只能有一个 default。
- 每个 option 的 effect 与 profile control type 一致。
- `model_variant` 引用真实 binding/upstream model。
- `resolution_tier` 至少包含一个 verified exact size；ratio map 的目标必须同时存在于 exactSizes。
- `pixel_tier` 边界无重叠、无倒置，并能覆盖管理员声明的可用范围。
- `prompt_flag` 同组互斥，不能为空或重复。
- 只配置执行 effect、没有匹配的 pricing dimension 时不能标记为可用。

管理员保存 manual profile 后，binding 的 effective source 设为 `manual`。删除 manual override 后，才恢复最新可验证 upstream profile。

## 13. API 与持久化

### 13.1 公共模型 API

公开脱敏数据包含：

- profile supported/controlType/presentation/options/default/revision；
- 客户端完成 preview 所需的 exact sizes、ratio map 和 pixel boundaries；
- 不包含 provider price、密钥、内部渠道信息或不可见 binding ID。

model variant 若未来显式启用，公共 option 使用不透明 option value，服务端内部解析 binding，不能公开内部 binding ID。

### 13.2 管理 API

沿用现有 logical model/settings 管理接口和 repository，增加强类型 profile 字段与校验。无需新增数据表或 migration；若数据库文档描述 logical model JSON 结构，则同步更新 `docs/backend-database.md` 对应文档源。

### 13.3 任务 API

创建图片任务的请求新增：

```ts
{
  imageQuality?: {
    value: string;
    profileRevision: string;
  };
}
```

服务端不接受客户端提供 effect、upstream value、tier、binding 或金额。revision 不一致返回 `IMAGE_QUALITY_PROFILE_CHANGED`，客户端刷新能力后让用户重新确认。

## 14. 兼容与迁移策略

项目尚未上线，不维护旧画质语义兼容层：

1. 为现有 binding 生成显式 `imageQualityProfile`。
2. DFLOP 当前 4 个可验证模型写入对应 profile，其余写入 `none`。
3. 移除 DFLOP 对 generic `generationParameters.qualities` 的读取和 low/medium/high 尺寸换算。
4. 其他 provider 只有在 adapter 已明确支持 generic quality 时才转换为 `request_parameter` profile；无法证明的配置保持 `none` 并进入管理员检查清单。
5. 已打开页面提交旧 revision 或旧 fixed option 时明确失败，不静默转换。

## 15. 预计修改范围

正式实施计划应精确到函数和测试；设计阶段预计涉及：

- `web/src/lib/auth/store-types.ts`：binding/profile 类型。
- `web/src/lib/auth/store-normalizers*.ts`、settings persistence tests：规范化、存取、公开脱敏。
- `web/src/lib/dflop-*` 与 DFLOP sync service：profile 解析、来源、revision、manual drift。
- 新增共享纯领域模块，例如 `web/src/lib/image-quality-profile.ts`：profile 校验、公开能力派生和 normalized resolver。
- `web/src/lib/model-routing-config.ts` 与图片 candidate resolver：逐 binding 解析和过滤。
- `web/src/app/api/image-tasks/image-task-support.ts`、`image-task-openai.ts`、provider request builder：保存/消费 normalized execution context。
- `web/src/lib/billing/creative-sale-estimator.ts` 与服务端 billing/hold 入口：消费 normalized pricing context。
- `web/src/components/creative-generation-preferences.tsx` 与 `/create` composer：动态选项、隐藏、切换清理、错误说明。
- 管理后台 logical model editor：profile 编辑、证据与 drift。
- 相关 API、unit、integration、worker fixture 和 Playwright 测试。

实际实施不得顺手重构上述文件中的无关代码。

## 16. 测试与验收

### 16.1 领域与同步单元测试

1. `none` profile 拒绝任何画质值。
2. 0/1/2+ options 的 UI 派生规则。
3. manual profile 在同步后保持不变，并产生 drift。
4. 非 manual profile 更新 revision；纯 label 更新不改变执行 revision。
5. 不通过模型名称关键字生成 profile。
6. model variant 不跨 logical model 自动合并。

### 16.2 Provider 解析测试

1. Midjourney standard/high 只规范化 `--sd/--hd`，不改变 size。
2. Midjourney 已存在重复/冲突 flag 时只保留一个目标 flag，公开 prompt 不变。
3. Qwen 1K/2K 接受列出的 exact sizes。
4. Qwen 未配置 ratio mapping 时不得由比例猜 exact size。
5. Qwen exact size 与 tier 不一致时拒绝。
6. Seedream 用 Decimal/整数像素在边界两侧正确选择 tier。
7. Seedream 只有 generic quality、没有 exact size 时拒绝。
8. Seedream option 与计算 tier 不一致时拒绝。
9. request parameter 缺 adapter 映射或 pricing dimension 时拒绝。

### 16.3 路由、计价与任务测试

1. 多 binding 中只保留能完整解析执行与计价的候选。
2. 第一个 binding 解析失败时可路由到另一个完整候选。
3. 所有 binding 无法解析时不创建 task、不预扣、不调用上游。
4. estimator、server hold 和保存的 pricing snapshot 使用相同 resolution/pixelTier/quality。
5. 客户端伪造 tier、upstream model 或金额不会被服务端接受。
6. profile revision race 返回 `IMAGE_QUALITY_PROFILE_CHANGED`。
7. 幂等重试复用同一个 normalized snapshot，不生成不同请求或重复预扣。
8. 现有 settlement/refund/usage snapshot 回归不变。
9. 图片多结果保存与展示回归不变。

### 16.4 UI 与浏览器回归

1. 无画质能力的模型完全不显示固定“高/中/低”。
2. Midjourney 显示标准/高清；切换后摘要和预计积分一致。
3. Qwen 只显示当前 exact size/ratio 可解析的档位；不可解析时禁用并说明原因。
4. Seedream 必须先有可解析 exact size；档位和预计积分随尺寸阈值变化。
5. 切换模型清除无效画质值和旧价格。
6. 单模型、多模型手工选择、智能规划都符合能力并集/交集规则。
7. desktop、390px、430px 中弹层可见可点击，无横向溢出；使用语义点击，不使用 force 或固定延时。
8. 管理后台 profile 编辑、manual override、drift 在 desktop、390px、430px 可用。

### 16.5 质量门禁

实施完成后运行：相关 Vitest、provider fixture/integration、typecheck、lint、项目既有全量 quality gate、UTF-8 严格检查和上述浏览器回归。PostgreSQL 集成测试遵循项目的串行执行约束。

## 17. 完成标准

- `/create` 不再固定显示虚假的高/中/低。
- 每个可见画质选项都能解析成完整 `ResolvedImageExecutionContext`。
- 无法解析的参数在任务、hold 和上游调用前被拒绝。
- Qwen、Seedream、Midjourney 和 model variant 四条硬规则均有服务端测试。
- 上游请求、预计积分、authoritative hold 和任务 snapshot 对同一选择使用同一 normalized context。
- manual profile 不被同步覆盖，upstream 变化可见为 drift。
- 现有图片/视频生成、正式售价、结算、退款、重试和 usage snapshot 没有回归。
