# Agent R0 稳定性基线报告与 R0/R1 实施计划

**基线提交：** `b0523a76900a1f785e076bf52cacb42557af6e2c`。开始检查时工作区干净。本文位置中的行号均对应此提交；路径相对于仓库根目录。

**范围：** 已读取 `AGENT_CURRENT_ARCHITECTURE.md`、`AGENT_FAILURE_CATALOG.md`、`AGENT_STABILITY_REFACTOR_PLAN.md`、`AGENT_RECOVERY_INVARIANTS.md`，并核对实际代码、测试、Compose、CI 和质量脚本。本次只新增报告，不修改生产代码、测试或部署配置，不实施 R1。

**结论：** AGF-001、AGF-002、AGF-003 的核心代码缺陷仍存在，但都有适用边界；AGF-009 是缺少运行时兼容校验的部署风险，不是已证明发生的镜像不一致事故。额外确认 AGF-005 的文本创建身份缺口。AGF-011 不能概括为“运行时完全没有 accepted-boundary 保护”。

本次完成的是 R0 源码与现有测试审计。原重构计划 R0 还要求新增红灯回归、四场景夹具、故障注入和业务指标；这些尚未实施，不能把本报告或现有测试全绿当作该阶段全部退出条件已满足。

## 1. 已验证的执行链

```text
POST /api/agent/runs
  → createAgentRun / createPostgresRunBundle（或文件 Provider）
  → generation_tasks(agent payload) + messages + run.created
  → after / SSE / 外部 Worker 唤醒 runGenerationTaskRecoveryBatch
  → claimDueGenerationTasks → processAgentLease → executeAgentRun
  → 恢复已保存计划，或 direct plan，或默认文本 planner
  → 保存 tasks / conversationReply + planningFinalization
  → finishSystemAiTextAttempt（planner settlement）
  → executeTasks：依赖就绪 → runTaskWithRetry → dispatchTask
  → child POST（video 创建路径与查询路径不同）
  → generation row / provider attempt / system proxy / upstream
  → 已保存 upstream ID 的查询恢复，或 result_ready/persisting 保存恢复
  → generation log / server media / creative assets
  → child result → registerAgentTaskAssets → task.completed
  → 全部完成或部分成功策略 → review / project handoff → run.completed

计费是跨阶段链路：请求前 reserve → provider usage evidence → 业务确认/恢复结算。
不是所有媒体都在 Agent 完成之前同步完成钱包结算。
```

### 1.1 Run 创建与持久化

| 精确位置                                               | 函数 / 行为                                                                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/app/api/agent/runs/route.ts:45`               | `POST` 鉴权、规范化、按用户与 `clientRequestId` 查询已有 Run；限流和并发限制后创建；`:60` 通过 `after()` 唤醒恢复批次。                                     |
| `web/src/lib/server/agent-run-store.ts`                | `createAgentRun`、`updateAgentRunById`、`updateAgentRunTaskById` 持有 Run、Task、planner finalization 的当前 JSON 契约。                                    |
| `web/src/lib/server/creative-runtime-repository.ts:68` | `createPostgresRunBundle` 将 Run 存到 `generation_tasks`，并处理对话、消息、事件。                                                                          |
| 同文件 `:98`                                           | `mutatePostgresRun` 在事务内 `SELECT ... FOR UPDATE`，校验 allowed status / expected execution ID，修改整份 payload，写事件及助手消息。不是无保护的读改写。 |
| `web/src/lib/server/database/schema.ts:267`            | generation 请求唯一键实际是 `(user_id, task_type, client_request_id, COALESCE(attempt_no,0))`，另有 `(channel_id, upstream_task_id)` 唯一索引。             |

AgentTask 仍不是独立数据库行；`tasks[]`、child slots、planner attempts 和资产 ID 都在 Run JSON 中。文件 Provider 也有锁/队列路径，但不能用文件 Provider 测试证明 PostgreSQL 多进程安全。

### 1.2 Planner 与结算

- `agent-run-executor.ts:58` 的 `executeAgentRun` 设置新的 `executionId`，先处理已保存的 conversation reply 或 tasks（`:80–88`），优先结算原 planner attempt，不重新规划。
- `:94–139`：显式选择模型时走 `directAgentPlan`，校验当前绑定、参数后直接执行，不调用默认文本 planner。这是现有行为，也有测试锁定；与 AGENTS.md 中“所有媒体必须先由默认文本模型规划”的要求存在差距，本次不改变。
- 默认规划路径从 `:143` 开始，经 `agent-run-surface-policy.ts`、`agent-run-execution.ts` 的 `requestFunctionCall` / `requestRoutedFunctionCall`、`text-planning-runtime.ts` 完成模型候选、结构化解析、能力校验和 attempt 审计。普通 Skill 来自本轮显式选择，不能将文档里的“Select skills”理解为 planner 可自行启用普通 Skill。
- `agent-run-executor.ts:460–493`：先保存任务、planner 审计、`planningFinalization=pending`，再 `settlePlannerFinalization`，最后才 dispatch。conversation 分支也遵守保存后结算。
- `:527` 的 `settlePlannerFinalization` → `usage-billing-runtime.ts:200` 的 `finishSystemAiTextAttempt`：检查 hold、fingerprint、attempt，记录终态并结算；已 settled 的成功 hold 可以重放，避免再次扣费。
- planner 的 billing header 签名/绑定在 `system-ai-billing.ts`；hold、冻结价格快照、attempt 和钱包结算由 `usage-billing-runtime.ts` → `points-wallet-service.ts` → `database/points-wallet-repository.ts` 管理。Agent 没有直接写钱包流水。

### 1.3 DAG、child dispatch 与恢复

| 位置                                        | 当前契约                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-run-execution.ts:559` `executeTasks` | `ready/running` 且所有 dependencies 已 completed 才进入当前批次，批次大小来自 `settings.generationConcurrency.agent`。                                         |
| 同文件 `:631`                               | `Promise.all(ready.map(runTaskWithRetry))`；跨 AgentTask 批次仍然 fail-fast。                                                                                  |
| 同文件 `:803` `runTaskWithRetry`            | pending child 保持 attempt 并恢复；无 child 时重新解析模型绑定。deferred 返回给 scheduler；普通失败写 task.failed；未保存 child 的 dispatch error 会重新抛出。 |
| 同文件 `:953` `dispatchTask`                | 持久化 resolved child slot 后通过 self-HTTP 创建；每副本请求键为 `${run.clientRequestId}:${task.id}:${attempt}:${index+1}`。                                   |
| 同文件 `:1014–1027`                         | POST 成功拿到 ID 后才 `linkAgentChildTask`、保存 child ID。此处有“创建成功但响应/关联保存丢失”的窗口。                                                         |
| 同文件 `:1103` `mapWithConcurrency`         | 单个任务内多个 copies 收集 settled outcomes；不能与 `:631` 的跨任务 Promise.all 混为一谈。                                                                     |
| 同文件 `:1180` `pollTask`                   | 查询 child，未知/未完成结果使用 deferred 恢复；不自动重新创建已保存 child。                                                                                    |

实际 child API：

| 类型  | 创建                              | 查询                   | 主要实现                                                                                                   |
| ----- | --------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| image | `/api/image-tasks`                | `/api/image-tasks/:id` | `app/api/image-tasks/route.ts:128`、`server/image-task-runtime.ts:25`                                      |
| video | **`/api/video-generation-tasks`** | `/api/video-tasks/:id` | `video-generation-tasks/route.ts` 转出 `video-generation-route.ts` 的 POST；`server/video-task-runtime.ts` |
| audio | `/api/audio-tasks`                | `/api/audio-tasks/:id` | `app/api/audio-tasks/route.ts:25`、`server/audio-task-runtime.ts:29`                                       |
| text  | `/api/text-tasks`                 | `/api/text-tasks/:id`  | `app/api/text-tasks/route.ts:27`、`server/text-task-runtime.ts:56`                                         |

注意：video 的首次上游提交还在 `video-generation-route.ts` 中；不能把所有媒体都画成“创建仅落库，全部 submit 由 Worker 完成”。显式 Canvas 文字节点还有 `directCanvasTextContent` 的纯文本直接产物路径，不创建上游 text task。

### 1.4 Worker 的真实边界

- `web/scripts/generation-worker.mjs:32` 的 `runLane` 调用 `/api/maintenance/generation-tasks/run`；`:63` 发 heartbeat；`:86` 调 `/api/maintenance/usage-holds/run`。独立 Worker **不访问数据库，不加载 TS generation recovery engine**。
- `app/api/maintenance/generation-tasks/run/route.ts:12` 验 Worker token 和 schema readiness，然后在 **app 进程**调用 `runGenerationTaskRecoveryBatch`。
- `generation-task-recovery-service.ts:40` claim，并在批次存活期间续约；`:261` `processAgentLease` 先恢复已关联 child，再 `executeAgentRun`（`:326–327`）。paused/cancel、后台 review 都有独立分支。
- `generation-task-scheduler.ts:67` 的 `claimDueGenerationTasks` 使用 `FOR UPDATE SKIP LOCKED`（`:91`）；`:115` 续约；`:137` release 校验 owner。Run mutation 另有 `executionId` guard。已有这些保护，但尚不能据此宣称所有跨租约 side effect 都具备 fencing。
- `generation-task-recovery-service.ts:471` 起的 image handler 优先复用已存 upstream ID；`:565` `persistImageLease` 对 result_ready/persisting 只保存结果。audio/video 有相应处理器。中断 submit 且缺 upstream ID 并不一定继续 reconcile，详见第 3 节。

### 1.5 媒体、资产、结算、完成与 review

- Image：`image-task-runtime.ts:151` `handleImageProviderResult` 保存异步身份/结果恢复信息；`:215` `completeImageResult` 规范化全部成功图、写 generation log、更新 task.success、登记 creative assets。多个结果使用 allSettled 保留成功项。
- Video：`video-task-runtime.ts:67` `persistVideoTaskResult` → `:79` `completeVideoTask` 保存媒体、完成 task，并在 `:119` 调 `finalizeUsageBillingForBusiness`。
- Audio：`audio-task-runtime.ts:151` / `:210` 下载并保存音频、更新任务和资产；Text：`text-task-runtime.ts:409` 在完成结果后调用 `finishSystemAiTextAttempt`。
- Image/audio 的成功路径没有像 video 一样在 runtime 中显式调用 `finalizeUsageBillingForBusiness`；活跃预留由 `maintenance/usage-holds/run/route.ts` → `recoverOrphanUsageHolds` → `inspectPersistedUsageHold` 根据持久任务证据收敛。不能假设 Agent completion 是媒体钱包已 settled 的屏障。
- Agent 的 `registerAgentTaskAssets` 在 `agent-run-assets.ts:5` 使用 `sourceRunId + sourceTaskId + ordinal`。`creative-runtime-repository.ts:238` 的 upsert 与 `schema.ts:382` 的唯一约束保护逻辑资产；不等同于物理媒体写入在所有 crash window 都已证明 exactly-once。
- `agent-run-execution.ts:559–629`：全成功完成；有资产、含失败 task 且所有任务终态时允许 partial completed；未满足依赖的 ready task 最后会写“前置任务未完成”。不是严格的 required/optional DAG 策略。
- `:642` `shouldBlockOnReview`：多任务、drama 或中文严格检查关键词触发 blocking。单任务通常完成后调度 review；`creative-review-service.ts` 将常见复盘错误转 unavailable，保留输出。
- SSE：`app/api/agent/runs/[id]/events/route.ts:17` 接受 header/query cursor，`:34` 唤醒恢复，`:69` 发 public snapshot；事件来自 `creative_run_events`。已有 replay、分页 drain 和脱敏测试。

## 2. P0 核验结论

### AGF-001：planner settlement 将可恢复错误变成终态——确认

调用链：`executeAgentRun` → persist plan → `settlePlannerFinalization` → `finishSystemAiTextAttempt` 抛错 → `agent-run-executor.ts:553–556` 保存 finalization.failed / failureStage 后 throw → `:494–516` 外层 catch 将 Run.failed。

`generation-task-recovery-service.ts:320–335` 将 failed Run 当终态关闭调度，因此即使 `retryable:true` 也不会自动恢复。`app/api/agent/runs/[id]/[action]/route.ts:34` 的手动 retry 保留计划/回答，避免重新规划；这只是缓解措施。

已有 `agent-run-executor.test.ts:1206`、`:1237` 分别模拟 billing 不可用、ledger 成功但 Run 的 settled 写失败，**期望值就是 `status:failed`**。`:1279`、`:1306` 证明从已保存计划/回答继续结算可以完成，但由测试手动提供 running 状态，不是 Worker 自动恢复证明。

新增分类风险：`plannerFinalizationFailure`（`:584`）仅按 HTTP status 排除 400/401/403/409/422；`usage-billing-runtime.ts:239` 的 `UsageBillingIntegrityError` 和缺 fingerprint 的 `billing_identity_missing` 未必带 status，会被标成 retryable。R1 不能只检查现有 retryable 布尔值，否则可能把永久身份错误无限重试。

### AGF-002：image `/responses` fallback 被解释为 text——确认，但有协议前提

`image-task-openai.ts:349` 的 `buildResponsesImageBodies` 返回四个 body，第二、第四没有 `image_generation`。`:333–346` 对 400/422 尝试下一个 body。系统代理 `route.ts:545–547` 以 `hasResponsesImageGenerationTool`（`:677`）区分 image/text；`system-ai-proxy-policy.ts:70` 对逻辑模型能力不一致返回 403。

因此在第一个 image body 被上游 400/422 拒绝后，第二个 body 会在本地 policy 失败，后面的合法 image body 甚至可能到不了上游。这是调用链静态证据，当前没有端到端 fixture 重现该特定链路。

限制：`image-task-support.ts:623` 的 `allowsImageProtocolFallback` 只对未声明、auto、compatible 开放；模型级协议优先于渠道级协议。显式协议只发第一个带 tool 的 body。不能报告成“所有 image Responses 调用都坏了”。修复应删掉无 tool 变体，保留代理授权检查，不把 unsigned caller 的能力声明当权威。

### AGF-003：跨任务 Promise.all fail-fast——确认，限定为会抛出的 dispatch 分支

`runTaskWithRetry:872–876`：`AgentChildTaskDispatchError` 且该 AgentTask 尚无已保存 child 时，task 恢复 ready / 原 attempts，再抛错。`executeTasks:631` 提前 reject，父 executor 标 failed 并清掉 executionId；已经启动的 sibling promise 不会被 Promise.all 自动取消。

结果：已接受的 sibling generation 仍可能运行；旧 executor 的后续 patch 又会受 executionId/status guard 拒绝。不能保证父 Run 内的 sibling 产物摘要立即收敛。已持久资产不会因为 Promise.all 自身被回滚，但“父摘要已完整保留所有产物”需要测试。

不是所有 task 错误都触发：poll deferred 返回 `deferred`；普通终态错误通常写 task.failed 并返回；单任务 copies 使用 settled outcome 收集。已有 `agent-run-executor.test.ts:1327` 验证单 task dispatch 502 导致 parent.failed；`:370` 验证双任务并行；缺少四分支混合故障的联合断言。

### AGF-009：app / Worker 不兼容——缺少 fence 已确认；真实不匹配未验证

五套主 Compose 使用相同 app/worker image 表达式或本地 image 名称。`scripts/compose-contract.mjs:77` 已强制 sameImage，`:91–92` 禁止 Worker 获得数据库配置。`:99` 规定 Worker 等待 app **liveness**。

`generation-worker-heartbeat.ts:9–29` 只记录 worker ID / 时间并判断 stale；`app/api/health/ready/route.ts` 已要求 heartbeat healthy。`maintenance/generation-tasks/run/route.ts:12` 在 claim 前未校验 build/git/schema/runtime protocol。缺少兼容 fence 属实，但同 image 名称并不保证已运行容器同 digest，也没有证据证明当前机器正在运行不匹配镜像。

准确风险是 Worker HTTP 协议、鉴权、启动脚本、运行环境和 app 版本不一致；恢复引擎/schema producer 都在 app 中，不能用“独立 Worker 运行旧版恢复引擎写新 schema”描述当前拓扑。多 app 混合版本是另一项需要独立检查的风险。

### AGF-005：unknown dispatch 的保护不完整——额外确认文本身份缺口

图片/视频/音频创建有 request-key 查询及底层唯一约束：`image-tasks/route.ts:146`、`video-generation-route.ts:46/58`、`audio-tasks/route.ts:62`、`generation-task-store.ts:822`。这不是“完全没有去重”。

但是文本 `text-tasks/route.ts:45–47` 仅把经 `resolveAgentTextTaskContext` 验证的 `executionContext` 交给 `createTextTask`。`agent-run-store.ts:242–248` 只返回 runId/parentTaskId；`text-task-store.ts:71–82` 生成随机 ID；`generation-task-store.ts:906` 从根字段取 clientRequestId，不会从 executionContext 补出请求键。Agent 在收到响应后才 link child，且 `linkAgentChildTask:1157` 没有补 clientRequestId。

因此：文本 child 已创建但响应丢失 → Agent 没有 child ID → 重放相同 dispatch 时仍可能分配新 text row。尚未跑真实丢响应并发实验，但代码缺口明确。新增 `/api/text-tasks` POST 测试应成为 R1.3 自动重试的前置条件，不能先把全部网络失败一律改为自动再次 POST。

另有可追踪性差异：`linkAgentChildTask` 设置存储记录 `parentTaskId: run.id`，不是 DAG task.id；文本 executionContext 和 asset metadata 则保留 DAG task.id。当前“parentTaskId”跨层含义并不统一，新增关联测试应显式辨别，不能猜字段语义。

### AGF-011：accepted 后盲目 failover——部分防护已存在，仍有目标差距

- `image-task-runtime.ts:25–67` 对已有 upstream ID 直接 query，仅 `GenerationSubmissionSafeFailure` 才进入下一候选；unknown outcome 终止，不自动切换。`image-task-runtime.test.ts:77/104/115` 覆盖安全拒绝、unknown、无合法 query contract 的 ID-only 响应。
- system proxy 的 `route.test.ts:319/331/395` 验证无供应商幂等支持禁止 replay、有支持才使用原键、正文/身份变化拒绝。不能说缺少所有 accepted/idempotency 防护。
- planner `agent-run-executor.ts:311–345` 只在 `resolveSystemAiTextFailure` 允许且没有 `streamedConversationContent` 时切换；公开文本已输出后不切换。已有 `executor.test.ts:1047` 正向保护，也有 `:1075` **accepted stream 在公开 discriminator 完成前断开仍 failover** 的当前行为测试。INV-004/005 用“任何 first content”作 accepted 的约束比实现更强。
- unknown 不盲目切换不等于 durable reconciliation：image recovery `:477–494` 对缺 upstream identity 的中断 submit 标失败；`usage-billing-runtime.ts:264–284`、`:407–411` 释放 ambiguous/unknown hold，测试 `usage-billing-runtime.test.ts:837/1003` 明确锁定该行为。这与 INV-003 及项目“未知保留预留/人工复核”约束不一致。需后续账务和状态治理，不能在 R1 中悄悄宣称已满足。

## 3. 四份设计文档需要修正或限定的内容

| 文档                                             | 核验结果与修正                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CURRENT_ARCHITECTURE §2–6                        | Run 存 generation_tasks、整 JSON、FOR UPDATE、planner settlement critical path、DAG Promise.all 均匹配。不能把“recoverable”理解为自动恢复。                                           |
| CURRENT_ARCHITECTURE §7 / FAILURE AGF-004        | video **创建**是 `/api/video-generation-tasks`，`/api/video-tasks/:id` 是查询；文档路径列表不够准确。                                                                                 |
| CURRENT_ARCHITECTURE §10 / FAILURE AGF-002       | 四个 body 问题仍在，但应注明 auto/compatible/未声明协议条件；显式 model protocol 已收紧 fallback。                                                                                    |
| CURRENT_ARCHITECTURE §8/13 / FAILURE AGF-008/009 | Worker 是 HTTP 调度客户端；readiness 心跳 gate、同镜像 Compose contract 已存在；缺的是运行时版本 fence 和部署证据。                                                                   |
| CURRENT_ARCHITECTURE 资产→用量流程图             | 是概念顺序，不是统一原子事务；不同媒体结算时机不同，Agent 完成不保证 image/audio hold 已关闭。                                                                                        |
| FAILURE AGF-005                                  | 已有 deterministic per-copy key 和媒体 dedupe，但文本创建不保存该身份，须明确区别。                                                                                                   |
| FAILURE AGF-011/016                              | 不能当作已证明全链路盲目重试；已有 uncertainty、stream 和 proxy replay 防护。accepted stream 的 planner failover 与严格 invariant 仍冲突。                                            |
| REFACTOR_PLAN R0                                 | 目标含新红灯测试、四场景 fixture、业务指标；现有审计不能替代这些退出条件。当前部分测试锁定缺陷行为，需要有意更新断言。                                                                |
| REFACTOR_PLAN R1.3                               | allSettled 只是等待 sibling 的机制；若 ready 分支仍在同一 while 立即重发会形成热循环，且 text unknown 会重复创建。必须先明确身份与 reconciliation，再让 scheduler 下一次 lease 接管。 |
| REFACTOR_PLAN R1.4                               | “不改 data model”与要求 durable heartbeat 新字段有实现冲突：不需要 Agent V2 表，但若持久保存 build/protocol/schema 元数据，需要小型 heartbeat schema/类型调整，并更新数据库文档。     |
| REFACTOR_PLAN R4/文件责任表                      | feature flag、legacy adapter、dual write 是后期方案，不是现有代码；项目尚未上线，AGENTS.md 不要求旧数据兼容。不能在 R1 顺手引入双写或历史迁移。                                       |
| RECOVERY_INVARIANTS INV-001/002/011/015          | 描述目标 ToolCall/PlanVersion/Task 状态，当前没有这些表和状态，不能当作已经具备的基础设施。                                                                                           |
| RECOVERY_INVARIANTS INV-003/005/007/014/028      | 当前分别存在 unknown 终态/释放、planner accepted 判据更弱、settlement terminal、batch exception terminal、无版本 fence 等差距。                                                       |
| RECOVERY_INVARIANTS INV-008/017/018              | 已有资产唯一键、租约和 executionId，但仍缺真实 PostgreSQL crash/concurrent finalizer/stale-worker 综合证明。                                                                          |
| RECOVERY_INVARIANTS INV-029                      | 不能据此新增拍脑袋重试次数/最大年龄后自动失败；沿用已配置/已有可测试的 scheduler backoff，并将未知状态保留为可观察状态。                                                              |

这四份文件保持原样，差异集中记录在本报告。已检查 todo、pending-test 与 production-readiness；本次没有交付功能或关闭缺陷，无需移动待办、增加功能完成声明或更新 CHANGELOG。

## 4. 现有覆盖与缺口

| 边界               | 已有测试及证据                                                                                                                 | 缺少的联合证明                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| planner/settlement | `agent-run-executor.test.ts:1206–1360`；`usage-billing-runtime.test.ts`；`system-ai-billing.test.ts`；action route retry tests | 不经用户操作的 Worker 自动恢复；真实 ledger settle 后 Run 写失败，再恢复只扣一次；永久 billing identity 错误停止重试。       |
| Responses image    | `image-task-openai-live.test.ts` 的 6 个本地 TCP 场景；`image-task-support.test.ts` 显式协议限制；proxy policy 能力拒绝        | 将真实 fallback builder、系统代理和 TCP fixture 串起来，第一个 400/422 后仍是 image，无伪 403；目前 TCP 测试没有此用例。     |
| DAG/copies         | executor 双任务并行、pause、deferred、copies、partial、依赖资产→video；direct/helper tests                                     | 四分支之一 dispatch 502，其他已提交 sibling 全部收敛；unknown POST 不再次 submit；永久 branch 对子孙和 partial 的确定策略。  |
| child idempotency  | generation-task-store 请求去重、媒体 route tests；text attempt/retry tests                                                     | text **POST** 稳定身份、丢响应恢复、双请求并发创建。当前没有 `app/api/text-tasks/route.test.ts`，只有 `[id]/route.test.ts`。 |
| generation runtime | image/video/audio/text runtime、protocol matrices、recovery-service tests                                                      | 同一 binding 下 direct 与 Agent 的端到端计费/产物一致；四场景 image→video 全链路。                                           |
| lease/recovery     | scheduler 的 file/mock PG claim/owner SQL；recovery-service 各媒体、cancel/review/child 恢复                                   | 两个真实 PG worker、租约到期旧执行器迟到 completion、进程 kill/restart 后 no duplicate。                                     |
| assets             | agent-run-assets/result-items、creative-runtime-store/service；image 多结果                                                    | 并发 finalizer、asset 写完但 parent patch 前 crash、物理媒体去重和所有输出计数。                                             |
| wallet             | usage runtime 文件 Provider、wallet repository/service；`points-wallet-idempotency.postgres.test.ts`                           | Agent planner / media / recovery 与真实 PG wallet 在同一故障场景中的唯一结算证明。                                           |
| Worker/deploy      | generation-worker(.policy)、heartbeat、heartbeat repository、maintenance routes、health ready、compose/render contract         | 不匹配 metadata 的 heartbeat 和 batch claim 被拒绝；同名不同镜像实例、滚动发布；实际 Docker digest 验收。                    |
| SSE/review/cancel  | events route cursor/drain/public snapshot；creative-review-service；action/cancellation tests                                  | 关闭浏览器后 Worker 独自完成再 replay 与 snapshot 收敛；混合失败/cancel/late result race。                                   |

完整检索清单附在文末。清单中的存在性与本次实际运行结果分开，不将所有文件都标为已运行。

## 5. 本次实际执行结果

| 检查                       | 结果                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 第一批核心基线             | 12 files / **219 passed**，3.35s。                                                                                                   |
| 第二批边界基线             | 12 files / **198 passed**，2.23s。原调用还带了不存在的 text POST 测试路径，Vitest 未匹配它；该路径不计覆盖，以下可复用命令已删除它。 |
| `pnpm --dir web typecheck` | exit 0。                                                                                                                             |
| 合计                       | **24 个不同文件、417 个测试通过**，无生产代码改动。                                                                                  |

运行日志在执行环境的 `/tmp/agent-r0-baseline-tests.log`、`/tmp/agent-r0-boundary-tests.log`、`/tmp/agent-r0-typecheck.log`；不把临时日志视为长期 CI 证据。

未执行：全库 lint/format/build/全部测试、Playwright、真实 PostgreSQL、多进程 crash、真实供应商、Docker 启动/镜像 digest 检查。原因是本次仅文档审计，使用已有本地 fixture/隔离测试锁定证据，没有改运行逻辑，也未配置专用 PG/部署验收环境。未操作当前 localhost 对话或后台真实渠道。

**指标边界：** 417/417 是自动化用例通过率，不是业务 Agent 成功率。当前只确认 Run timings、plannerAttempts、failureStage、recovery batch summary 等指标来源；没有采样真实业务数据，不能编造 P95、重复扣费率或恢复成功率。

## 6. 精确测试命令

所有命令从仓库根目录运行。根 `package.json` 没有 test/typecheck；真正入口是 `web/package.json`，包管理器声明 `pnpm@11.9.0`，CI 使用 Node 22。Vitest config 包含 `src/**/*.test.{ts,tsx}` 和 `scripts/**/*.test.mjs`。

### 6.1 重跑本次覆盖

```sh
pnpm --dir web test src/lib/server/agent-run-executor.test.ts src/lib/server/agent-run-execution-direct.test.ts src/lib/server/generation-task-recovery-service.test.ts src/lib/server/generation-task-scheduler.test.ts src/lib/server/system-ai-proxy-policy.test.ts src/lib/server/usage-billing-runtime.test.ts src/lib/server/agent-run-assets.test.ts src/lib/server/generation-worker-heartbeat.test.ts src/app/api/image-tasks/image-task-openai-live.test.ts src/app/api/health/ready/route.test.ts scripts/generation-worker.test.mjs scripts/compose-contract.test.mjs --no-file-parallelism

pnpm --dir web test src/lib/server/image-task-runtime.test.ts src/lib/server/video-task-runtime.test.ts src/lib/server/audio-task-runtime.test.ts src/lib/server/text-task-runtime.test.ts src/lib/server/generation-task-store.test.ts src/lib/server/creative-runtime-store.test.ts src/lib/server/system-ai-billing.test.ts 'src/app/api/ai/system/[channelId]/[...path]/route.test.ts' 'src/app/api/agent/runs/[id]/[action]/route.test.ts' 'src/app/api/agent/runs/[id]/events/route.test.ts' src/app/api/maintenance/generation-tasks/run/route.test.ts src/app/api/maintenance/generation-tasks/heartbeat/route.test.ts --no-file-parallelism

pnpm --dir web typecheck
```

### 6.2 仓库质量门禁与协议测试

```sh
pnpm --dir web test --no-file-parallelism
pnpm --dir web run test:protocols --no-file-parallelism
pnpm --dir web run lint
pnpm --dir web run format:check
pnpm --dir web run typecheck
pnpm --dir web run build
pnpm --dir web run check:release
```

`check:release` 自身执行 diff/Compose/Render 检查、audit、lint、format、tests、typecheck、隔离 build 和产物检查；**不等于 Playwright 全量门禁**。无需与前面的子命令无意义重复运行；上面列出可独立定位的入口。它内部 `pnpm test` 没有 `--no-file-parallelism`；启用共用 PG 集成开关时不要直接依赖该默认串行语义，应单独执行下面的 PG 命令。

### 6.3 真实 PostgreSQL（必须是可清理的专用测试库）

先由测试环境配置 `DATABASE_URL`，不可指向用户业务库。以下命令明确拒绝缺失 URL，不读取 `.env.local` 中的真实渠道。

```sh
: "${DATABASE_URL:?请先配置隔离 PostgreSQL 测试库}"
VOZEB_PRO_DATABASE_PROVIDER=postgres VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1 \
VOZEB_PRO_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
pnpm --dir web exec vitest run --no-file-parallelism \
  src/lib/server/points-wallet-idempotency.postgres.test.ts \
  src/lib/server/text-task-retry.postgres.test.ts
```

`.github/workflows/quality.yml` 的 PostgreSQL job 还运行 `database/auth-entity-concurrency.postgres.test.ts`、`admin-backup-store.postgres.test.ts`、`database/work-community-postgres.test.ts`，后者另需 `RUN_WORK_COMMUNITY_POSTGRES_INTEGRATION=1`。`text-task-retry.postgres.test.ts` 当前不在这段 CI 显式 PG 列表内，默认 suite 又会跳过，应在相关改动验收时显式补跑。

### 6.4 浏览器回归（R1 必跑）

```sh
pnpm --dir web exec playwright install chromium
pnpm --dir web run build
pnpm --dir web run e2e
```

执行前设置四个**当次确认空闲的独立端口**：`VOZEB_PRO_E2E_PORT`、`VOZEB_PRO_DOCS_E2E_PORT`、`VOZEB_PRO_PROTOCOL_FIXTURE_PORT`、`VOZEB_PRO_PAYMENT_FIXTURE_PORT`。默认分别是 3100/3001/4010/4020；不能假设默认空闲。`playwright.config.ts` 已 `reuseExistingServer:false`，不要改成复用当前 3000 服务。`pree2e` 会清理 `.e2e-data/.e2e-artifacts/playwright-report`，仅在专用 E2E 环境执行。PG 浏览器矩阵另设 `VOZEB_PRO_E2E_DATABASE_URL`。

已有聚焦回归：`pnpm --dir web run e2e planner-failover.spec.ts core.spec.ts canvas.spec.ts creative-video-result.spec.ts`；按配置覆盖 desktop / mobile-390 / mobile-430，Canvas 文件只在 desktop project 匹配。新 `agent-stability.spec.ts` **必须同步加入 project.testMatch**，否则仅创建文件不会自动运行。

## 7. 可实施的 R0/R1 顺序

**目标：** 先锁定失败与 side effect 数量，再修四项 P0 边界；保留 Generation Runtime、钱包 primitives 和 SSE，不引入 Agent V2 表，不移除 self-HTTP，不改 review 策略。

**技术栈：** Next Route Handler / TypeScript / Vitest / 本地 TCP fixture / PostgreSQL / Playwright。

执行计划时使用 `superpowers:executing-plans` 按项落实；本次不执行。每项先见到针对目标不变量失败的断言，再实现最小改动、验证、独立审查。测试失败必须来自行为差异，不能把 missing module 或 fixture 配置错误当红灯证明。

### R0-A：新增可复现基线（测试变更，尚未实施）

- [ ] 扩展现有 `agent-run-executor.test-fixtures.ts`：4 个 image task + 各自依赖对应 image 的 4 个 video task，稳定 scene ID、固定 clientRequestId、固定 logical binding。受控 Promise gates 控制 A/C accepted、B 502、D pending 顺序，不添加 sleep。
- [ ] 新增 `web/src/lib/server/agent-run-execution-stability.test.ts`：四分支 dispatch fault、unknown response、永久错误、pause/cancel；复用既有 mock 模式。明确记录 provider submit、child create、asset registration、terminal event 次数。
- [ ] 扩展 `agent-run-executor.test.ts`：将 settlement transient 的目标断言设为非 terminal；settled ledger 后 Run 写失败再恢复，planner 不重跑、同 hold/fingerprint。保留永久 identity 失败用例。
- [ ] 扩展 `image-task-openai-live.test.ts` 和系统代理 `route.test.ts`：真实 builder 的每个 image body 均有 tool；同一 local TCP fixture 返回首个 400/422、下一合法请求成功；验证 proxy capability、upstream 请求次数、无虚假 403。
- [ ] 新增 `web/src/app/api/text-tasks/route.test.ts`：同一请求创建后响应丢失、再发相同请求，以及并发重放；断言一个 logical child。另测同身份不同正文必须冲突，不默默复用。
- [ ] 新增 `web/src/lib/server/agent-stability.postgres.test.ts`：直接调用现有 services/repositories，故障注入使用 test spy 或 fixture 断点，不添加生产 crash 开关。覆盖结算成功→Run 写失败、双 claim、asset→task patch 中断。没有 ToolCall 实体，当前用 Run/task/copy/request/hold identity 对应 crash matrix。
- [ ] 扩展 heartbeat/run/health ready tests：构造 incompatible worker，目标断言是 claim 前拒绝；当前应失败。扩展 proxy/runtime tests 锁住 accepted/unknown 不提交第二次的路径。
- [ ] 收集 fixture 的 business outcome、submit/asset/settlement 次数和耗时；已有 timings 只作观测来源。R0 报告红灯用例名称及实际失败原因，不能提交“417 通过所以稳定”的结论。

新增测试建好后的命令：

```sh
pnpm --dir web test src/lib/server/agent-run-execution-stability.test.ts src/lib/server/agent-run-executor.test.ts src/app/api/text-tasks/route.test.ts src/app/api/image-tasks/image-task-openai-live.test.ts 'src/app/api/ai/system/[channelId]/[...path]/route.test.ts' --no-file-parallelism

: "${DATABASE_URL:?请先配置隔离 PostgreSQL 测试库}"
VOZEB_PRO_DATABASE_PROVIDER=postgres VOZEB_PRO_RUN_POSTGRES_INTEGRATION=1 \
VOZEB_PRO_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
pnpm --dir web exec vitest run src/lib/server/agent-stability.postgres.test.ts --no-file-parallelism
```

### R1.1：修 image Responses（最小独立变更）

- [ ] 修改 `image-task-openai.ts:349`，删除两种没有 image_generation 的 body；保留 structured input 与 string input 的 image 请求。
- [ ] 保留 `allowsImageProtocolFallback` 的显式协议限制和 `system-ai-proxy-policy` 的能力拒绝；不要为了通过测试把 `/responses` 全部当 image。
- [ ] 运行 R0 Responses 回归、image runtime、proxy route/policy、`test:protocols` 和 typecheck。验收：fallback 始终 image；第一个请求失败不产生成功消费；成功变体只产生一次最终结算。

### R1.2：planner settlement 自动恢复

- [ ] 在 `agent-run-executor.ts` 的 finalization 分类中显式识别 `UsageBillingIntegrityError` / `billing_identity_missing` 为 permanent；保留暂时 DB/连接错误的 retryable 类别，避免纯 message 正则。
- [ ] transient 时保留已保存 tasks/reply、原 hold/attempt/fingerprint 和可恢复 Run 状态，退出本次 executor，不执行 child、不写 run.failed、不重新调用 planner。
- [ ] 通过 `generation-task-recovery-service.ts` / `generation-task-scheduler.ts` 的下一次 lease 重试结算；沿用 `generationTaskNextPollAt({consecutiveErrors})`，使失败次数在持久调度状态中可累加。不能每次把 finalization failure 吞掉后以“正常 running”零延迟循环。
- [ ] 如 settled Run 写失败，后续读回 finalization，再用原 billing identity 重放。`usage-billing-runtime.ts:200` 已支持成功 settled hold；永久错误保留计划与账务证据后明确失败，不无限循环。
- [ ] 修改当前锁定 failed 的两个 executor 测试，扩展 recovery-service 与 action route tests；真实 PG 验证 wallet delta、hold、usage charge/ledger 数量都只发生一次。与 usage-hold recovery 的并发释放竞态单独注入测试，不只 mock `finishSystemAiTextAttempt` 调用次数。

### R1.3：先补 dispatch 身份，再去掉跨任务 fail-fast

- [ ] **前置小修：** `text-tasks/route.ts`、`text-task-store.ts` 及必要的 context 类型把服务器验证后的稳定请求身份落到 generation row；复用 `insertTask` 唯一约束，不信任未验证的用户字段。覆盖丢响应重放和 fingerprint 冲突。不满足该前置条件，不允许 unknown text POST 自动重发。
- [ ] `agent-run-execution.ts` 的 dispatch error 保留可判定的 stage/status/unknown 分类；网络异常、5xx、无 ID 响应不能一律当“尚未提交”。先按稳定 key 查询已存在 generation row，保留现有 child references。
- [ ] 跨 task 批次等待所有 settled outcome；各分支写自己的 durable 状态。known-safe transient 返回 deferred 并让下一次 lease 按既有 backoff 接管；unknown 走查询/核对，无法证明未接受时不再 POST。不得在同一个 while 内让 ready task 立即无限重试。
- [ ] required/permanent failure 暂沿用现有 partial 规则，不新增产品 policy；等待 active sibling 收敛后再 derive parent。completed sibling 的 ID/assets 不变，手动重试只处理失败项。
- [ ] 跑四分支 fixture、text POST、executor、recovery、retry/cancel/SSE tests；验收每个 logical copy 的 submit_count、child_count、asset_count、hold 和 event 均符合预期。

若不想在 R1 增加文本创建身份修复，则 R1.3 只能实现“等待 sibling + 保留未知状态供核对”，不能承诺 unknown 自动恢复或关闭 AGF-005。

### R1.4：Worker HTTP 兼容 fence

- [ ] 生产修改范围：`generation-worker.mjs`、`maintenance/generation-tasks/{heartbeat,run}/route.ts`、必要的 `maintenance/usage-holds/run/route.ts`、`generation-worker-heartbeat.ts`、heartbeat repository/schema、`health/ready/route.ts`、Docker/build metadata。不要加载一套新的 Worker recovery engine。
- [ ] 明确 metadata 来源：buildVersion 来自仓库 VERSION、gitSha 由构建注入、runtimeProtocolVersion 为 app/worker HTTP 契约版本；schemaVersion 必须来自现有 schema readiness/明确版本契约，不能捏造已存在的 migration version。
- [ ] heartbeat 和每次 batch admission 都校验 protocol/build policy；不兼容请求在调用 recovery/claim 前拒绝，仅 readiness 返回 503 不足以阻止工作。schema 由 app 检查，Worker 不拿 DATABASE_URL。
- [ ] heartbeat 持久化兼容信息时按新字段直接设计，不做旧数据兜底；更新实际数据库文档 `docs/content/docs/backend/backend-database.mdx`。这是 heartbeat 小型 schema 变更，不是 Agent V2。
- [ ] 保留 app liveness 启动 Worker、ready 检查 healthy compatible Worker 的顺序，避免 app 等 Worker ready、Worker 又等 app ready 的死锁。不能让任意旧 Worker 的最新 heartbeat 掩盖全部兼容 Worker 已失活。
- [ ] 扩展 script、route、heartbeat repo、health、Compose/Render tests；部署前额外核对已运行容器 digest 与 metadata。相同版本、版本缺失、协议不匹配、schema 未准备、旧 heartbeat 均需覆盖。

### R1 收尾门禁

- [ ] R0 红灯全部转绿，既有 direct generation / Agent / 协议 suite 无回归。
- [ ] 真 PG crash/concurrency：同一 logical operation 无额外 generation、asset、charge；浏览器关闭后仍能完成，再连 SSE 不重复终态效果。
- [ ] 运行第 6 节质量门禁和项目要求的 desktop / 390px / 430px、Canvas、image/video/history/reference、相关按钮及本地协议浏览器矩阵。新增稳定性 E2E 文件时更新 testMatch。
- [ ] 记录本次缺陷修复与仍未验收部分到 todo/pending-test/production-readiness/CHANGELOG；没有真实上线证据，不满足 FAILURE_CATALOG 的 canary/rollout closure，不能写“生产稳定性已验证”。

## 8. 关键风险与暂停条件

1. **未知结果不是安全重试。** 文本身份缺口和媒体 submit→link 窗口尚未补齐前，自动重发会扩大成本风险。
2. **结算类型不能只看 status。** 现有 integrity error 常无 HTTP status，transient/permanent 错分会造成永久 pending。
3. **账务恢复与 planner 恢复可能竞争。** unknown hold 当前释放行为与目标不变量冲突；R1 必须测试“恢复前 hold 已关闭”的行为，不能重新预留/扣费掩盖问题。
4. **allSettled 不是调度器。** 不解决持久身份、下一次 lease/backoff、旧 executor guard 或 late asset 收敛。
5. **lease 与 executionId 是不同保护。** 前者用于 worker 调度，后者用于 Run mutation；必须以真实多进程测试证明迟到执行器没有额外 side effect。
6. **资产唯一行不等于文件唯一写。** 唯一约束可证明 logical asset，但下载、日志和物理保存 crash 仍需单独计数。
7. **当前测试有目标相反的断言。** 修改时要明确替换 transient terminal/unknown release 的契约，不能只删失败断言；R1 不涉及的差距保留为开放项。
8. **版本 fence 不能破坏启动。** 从构建元数据到 heartbeat、batch admission、ready 必须全链路一致，且不把两套不同拓扑混在一起。
9. **R1 不是 R2–R14。** 不引入 ToolCall/Plan V2、legacy 双写、服务提取、review 政策变更或全量 provider 重写。

## 9. 现有测试文件检索清单

下列清单包括 Agent 服务/接口、规划、generation runtime、协议、计费、资产、Worker/SSE 以及直接相关 UI 恢复测试。由文件名族和测试正文引用检索整理；不是“全部已运行”。e2e 项目选择仍以 `playwright.config.ts` 为准。

检索共定位 120 个相关测试文件；以下使用仓库根相对路径。辅助 fixture `web/src/lib/server/agent-run-executor.test-fixtures.ts` 不是 Vitest 测试入口。

### 服务端与共享契约

- `web/src/lib/agent-text-stream.test.ts`
- `web/src/lib/channel-protocol-draft.test.ts`
- `web/src/lib/channel-protocol-registry.test.ts`
- `web/src/lib/creative-agent-contract.test.ts`
- `web/src/lib/creative-runtime-contract.test.ts`
- `web/src/lib/server/active-protocol-media-matrix.live.test.ts`
- `web/src/lib/server/active-protocol-media-proxy-matrix.live.test.ts`
- `web/src/lib/server/agent-function-call.test.ts`
- `web/src/lib/server/agent-readiness.test.ts`
- `web/src/lib/server/agent-run-assets.test.ts`
- `web/src/lib/server/agent-run-audit.test.ts`
- `web/src/lib/server/agent-run-canvas-ops.test.ts`
- `web/src/lib/server/agent-run-execution-direct.test.ts`
- `web/src/lib/server/agent-run-execution-helpers.test.ts`
- `web/src/lib/server/agent-run-executor.test.ts`
- `web/src/lib/server/agent-run-messages.test.ts`
- `web/src/lib/server/agent-run-project-handoff.test.ts`
- `web/src/lib/server/agent-run-public.test.ts`
- `web/src/lib/server/agent-run-result-items.test.ts`
- `web/src/lib/server/agent-run-store.test.ts`
- `web/src/lib/server/agent-run-surface-policy.test.ts`
- `web/src/lib/server/agent-run-text-stream.test.ts`
- `web/src/lib/server/agent-run-validation.test.ts`
- `web/src/lib/server/agent-skill-import-refiner.test.ts`
- `web/src/lib/server/audio-task-capability-retry.test.ts`
- `web/src/lib/server/audio-task-config.test.ts`
- `web/src/lib/server/audio-task-public.test.ts`
- `web/src/lib/server/audio-task-refund.test.ts`
- `web/src/lib/server/audio-task-runtime.test.ts`
- `web/src/lib/server/channel-protocol-assistant.test.ts`
- `web/src/lib/server/creative-review-service.test.ts`
- `web/src/lib/server/creative-runtime-service.test.ts`
- `web/src/lib/server/creative-runtime-store.test.ts`
- `web/src/lib/server/database/generation-worker-heartbeat-repository.test.ts`
- `web/src/lib/server/database/points-wallet-repository.test.ts`
- `web/src/lib/server/database/schema-wallet-holds.test.ts`
- `web/src/lib/server/generation-attempt.test.ts`
- `web/src/lib/server/generation-capability-recovery.integration.test.ts`
- `web/src/lib/server/generation-task-authorization.test.ts`
- `web/src/lib/server/generation-task-cancellation-service.test.ts`
- `web/src/lib/server/generation-task-recovery-service.test.ts`
- `web/src/lib/server/generation-task-retention.test.ts`
- `web/src/lib/server/generation-task-scheduler.test.ts`
- `web/src/lib/server/generation-task-store.test.ts`
- `web/src/lib/server/generation-task-webhook.test.ts`
- `web/src/lib/server/generation-usage-context.test.ts`
- `web/src/lib/server/generation-worker-heartbeat.test.ts`
- `web/src/lib/server/image-task-config.test.ts`
- `web/src/lib/server/image-task-runtime.test.ts`
- `web/src/lib/server/internal-origin.integration.test.ts`
- `web/src/lib/server/internal-origin.test.ts`
- `web/src/lib/server/points-wallet-idempotency.postgres.test.ts`
- `web/src/lib/server/points-wallet-service.test.ts`
- `web/src/lib/server/prompt-optimization-service.test.ts`
- `web/src/lib/server/protocol-media-matrix.live.test.ts`
- `web/src/lib/server/protocol-model-catalog.live.test.ts`
- `web/src/lib/server/system-ai-billing.test.ts`
- `web/src/lib/server/system-ai-proxy-policy.test.ts`
- `web/src/lib/server/text-planning-runtime.integration.test.ts`
- `web/src/lib/server/text-planning-runtime.test.ts`
- `web/src/lib/server/text-stream-diagnostics.test.ts`
- `web/src/lib/server/text-stream-protocol.integration.test.ts`
- `web/src/lib/server/text-stream-protocol.test.ts`
- `web/src/lib/server/text-task-attempt.test.ts`
- `web/src/lib/server/text-task-retry.postgres.test.ts`
- `web/src/lib/server/text-task-runtime.test.ts`
- `web/src/lib/server/text-task-stream-control.test.ts`
- `web/src/lib/server/usage-billing-adapter.test.ts`
- `web/src/lib/server/usage-billing-recovery-token-usage.test.ts`
- `web/src/lib/server/usage-billing-runtime.test.ts`
- `web/src/lib/server/video-task-config.test.ts`
- `web/src/lib/server/video-task-runtime.test.ts`
- `web/src/lib/server/voice-clone-runtime.test.ts`
- `web/src/lib/server/voice-profile-service.test.ts`

### API 路由

- `web/src/app/api/admin/billing/usage/recovery/route.test.ts`
- `web/src/app/api/agent/runs/[id]/[action]/route.test.ts`
- `web/src/app/api/agent/runs/[id]/events/route.test.ts`
- `web/src/app/api/agent/runs/[id]/tasks/[taskId]/retry/route.test.ts`
- `web/src/app/api/agent/runs/route.test.ts`
- `web/src/app/api/ai/system/[channelId]/[...path]/route.test.ts`
- `web/src/app/api/audio-tasks/[id]/route.test.ts`
- `web/src/app/api/audio-tasks/route.test.ts`
- `web/src/app/api/drama/analyze/route.test.ts`
- `web/src/app/api/drama/analyze/route.usage.test.ts`
- `web/src/app/api/health/live/route.test.ts`
- `web/src/app/api/health/ready/route.test.ts`
- `web/src/app/api/image-tasks/[id]/route.test.ts`
- `web/src/app/api/image-tasks/image-task-custom.test.ts`
- `web/src/app/api/image-tasks/image-task-openai-live.test.ts`
- `web/src/app/api/image-tasks/image-task-support.test.ts`
- `web/src/app/api/image-tasks/route.test.ts`
- `web/src/app/api/maintenance/generation-tasks/heartbeat/route.test.ts`
- `web/src/app/api/maintenance/generation-tasks/run/route.test.ts`
- `web/src/app/api/maintenance/usage-holds/run/route.test.ts`
- `web/src/app/api/text-tasks/[id]/route.test.ts`
- `web/src/app/api/video-generation-tasks/route-live.test.ts`
- `web/src/app/api/video-generation-tasks/route.test.ts`
- `web/src/app/api/video-tasks/[id]/route.test.ts`
- `web/src/app/api/video-tasks/route.test.ts`
- `web/src/app/api/voice-profiles/route.test.ts`

### Worker / 部署 / fixture 脚本

- `web/scripts/compose-contract.test.mjs`
- `web/scripts/generation-runtime.test.mjs`
- `web/scripts/generation-worker-policy.test.mjs`
- `web/scripts/generation-worker.test.mjs`
- `web/scripts/protocol-fixture-server.test.mjs`
- `web/scripts/release-check.test.mjs`
- `web/scripts/release-workflow-contract.test.mjs`
- `web/scripts/render-contract.test.mjs`

### 前端恢复与浏览器

- `web/e2e/all-pages.spec.ts`
- `web/e2e/canvas.spec.ts`
- `web/e2e/core.spec.ts`
- `web/e2e/creative-video-result.spec.ts`
- `web/e2e/planner-failover.spec.ts`
- `web/e2e/responsive.spec.ts`
- `web/src/app/(user)/canvas/[id]/canvas-image-task-results.test.ts`
- `web/src/app/(user)/canvas/components/canvas-agent-node-retry.test.ts`
- `web/src/app/(user)/canvas/components/canvas-agent-run-client.test.ts`
- `web/src/app/(user)/canvas/components/canvas-agent-run-watch-guard.test.ts`
- `web/src/app/(user)/create/use-create-agent.test.ts`
- `web/src/services/api/generation-task-request-error.test.ts`
