# AGENT_FAILURE_CATALOG

> Mục tiêu: danh mục failure mode có thể tái hiện và kiểm thử cho Agent hiện tại.  
> Quy ước severity: **P0** = có thể làm sai business result/duplicate cost/toàn Run chết không cần thiết; **P1** = reliability/operability nghiêm trọng; **P2** = latency/maintainability/degradation.

## 1. Nguyên tắc phân loại

Mỗi failure được phân theo một trong các stage:

```text
PLANNING
PLANNER_SETTLEMENT
TASK_SCHEDULING
TASK_DISPATCH
GENERATION_EXECUTION
POLLING_RECOVERY
ASSET_FINALIZATION
BILLING_SETTLEMENT
EVENT_DELIVERY
CANCELLATION
DEPLOYMENT
REVIEW
```

Terminal failure chỉ nên xảy ra khi lỗi **business/permanent** làm workflow không thể tiếp tục an toàn. Lỗi transient hoặc trạng thái chưa xác định phải đi vào recovery.

---

## AGF-001 — Planner settlement transient failure làm Agent Run terminal

**Severity:** P0  
**Stage:** `PLANNER_SETTLEMENT`

### Source evidence

- `web/src/lib/server/agent-run-executor.ts`
- `settlePlannerFinalization()`

Sau khi plan/tasks đã được persist, `finishSystemAiTextAttempt()` lỗi sẽ:

1. ghi `planningFinalization.status='failed'`;
2. ghi `failureStage='planner_settlement'`;
3. throw;
4. outer catch chuyển Agent Run thành `failed`.

### Triệu chứng

- Planner log cho thấy thành công.
- `run.planned` có thể đã được emit.
- Chưa có child generation nào chạy.
- Run kết thúc `failed` với `failureStage=planner_settlement`.
- User phải bấm retry để dùng lại persisted plan.

### Root cause

Retryable billing persistence error đang được map sang **workflow terminal state** thay vì durable pending/retry state.

### Rủi ro

- Agent fail dù generation chưa có vấn đề.
- transient DB/network error trở thành UX failure.
- tăng tỷ lệ lỗi end-to-end.

### Existing mitigation

`/api/agent/runs/[id]/[action]` có manual retry giữ lại persisted plan cho `planner_settlement`.

### Required fix

- phân biệt permanent vs retryable settlement;
- retryable -> recovery state, không terminal run;
- settlement phải idempotent;
- worker tự resume sau khi settlement xác nhận.

### Required tests

- DB unavailable khi settle -> run không terminal.
- ledger settle thành công nhưng Agent state update mất kết nối -> retry không charge lần hai.
- permanent billing identity invalid -> terminal đúng lý do.

---

## AGF-002 — `/responses` image fallback tự chuyển từ image thành text

**Severity:** P0  
**Stage:** `GENERATION_EXECUTION / PROVIDER_PROTOCOL`

### Source evidence

- `web/src/app/api/image-tasks/image-task-openai.ts`
- `buildResponsesImageBodies()`
- `web/src/app/api/ai/system/[channelId]/[...path]/route.ts`
- `hasResponsesImageGenerationTool()`
- `web/src/lib/server/system-ai-proxy-policy.ts`

`buildResponsesImageBodies()` trả bốn body; body #2 và #4 không có:

```json
{"tools":[{"type":"image_generation"}]}
```

Trong proxy, `/responses` chỉ được classify `usageKind='image'` khi có tool này. Nếu không có, request bị classify là `text`.

Với logical image model, policy kiểm tra:

```text
pointsUsageKind === logical.capability
```

nên fallback không có tool có thể bị trả `403 请求能力与逻辑模型不匹配`.

### Triệu chứng

- request đầu `/responses` trả 400/422;
- fallback sau đó trả 403 capability mismatch;
- Agent image task lỗi dù model/binding là image.

### Root cause

Protocol fallback và billing/capability classification không cùng một contract.

### Required fix

Ngắn hạn:

- loại bỏ image `/responses` body không có `image_generation`.

Dài hạn:

- provider binding xác định protocol rõ ràng;
- capability lấy từ signed internal context/binding, không đoán lại từ fallback payload nếu đã có authoritative context.

### Required tests

- mọi `/responses` image fallback vẫn classify image;
- logical image model không bao giờ gửi `usageKind=text`;
- upstream 400 không dẫn đến internal capability 403 giả.

---

## AGF-003 — Parallel task batch fail-fast làm parent fail trong khi sibling đã có side effect

**Severity:** P0  
**Stage:** `TASK_DISPATCH`

### Source evidence

- `web/src/lib/server/agent-run-execution.ts`
- `executeTasks()` dùng `Promise.all(...)`
- `runTaskWithRetry()` có thể throw `AgentChildTaskDispatchError`

### Failure scenario

```text
Task A -> child submitted
Task B -> dispatch HTTP 502 -> throws
Task C -> child submitted
Task D -> still running

Promise.all rejects because B
             ↓
executeAgentRun catch
             ↓
parent Agent may become failed
```

`Promise.all` không hủy A/C/D.

### Triệu chứng

- UI báo Agent fail nhưng provider vẫn chạy.
- vài phút sau asset có thể xuất hiện.
- có usage/cost nhưng parent đã failed.
- retry parent có nguy cơ khó reasoning về side effects cũ.

### Root cause

Batch orchestration dùng exception propagation thay cho durable per-task state machine.

### Required fix

- scheduler per-task;
- transient dispatch -> `WAITING_RETRY`;
- parent không terminal vì một transient branch;
- no blind retry sau accepted boundary;
- có thể dùng `allSettled` trong bước chuyển tiếp, nhưng target là task scheduler durable chứ không chỉ đổi API Promise.

### Required tests

- 4 branch, 1 dispatch 502: sibling success được giữ.
- parent không failed khi lỗi được classify retryable.
- permanent required branch failure -> parent terminal/partial theo policy rõ ràng.

---

## AGF-004 — Self-HTTP tạo failure boundary nội bộ không cần thiết

**Severity:** P1  
**Stage:** `TASK_DISPATCH / POLLING / CANCELLATION`

### Source evidence

Agent gọi:

```text
/api/text-tasks
/api/image-tasks
/api/video-tasks
/api/audio-tasks
```

qua `fetchInternalApi()` trong `agent-run-execution.ts`; cancellation cũng gọi child API qua HTTP.

### Failure modes

- internal origin sai;
- cookie/maintenance context sai;
- route 5xx;
- network/socket timeout;
- response lost sau khi server đã tạo task;
- JSON parse failure;
- app quá tải chính nó.

### Root cause

API transport đang được dùng làm application boundary giữa các module trong cùng hệ thống.

### Required fix

Tạo shared `GenerationApplicationService`:

```text
REST controller ─┐
                 ├─> GenerationApplicationService
Agent Tool ──────┘
```

Giữ HTTP chỉ ở external boundary.

### Tests

- API route và Agent Tool phải tạo cùng business object qua cùng service.
- application service dedupe theo idempotency key.

---

## AGF-005 — Unknown dispatch outcome có thể khó phân biệt với not-submitted

**Severity:** P0/P1  
**Stage:** `TASK_DISPATCH`

### Scenario

```text
Agent POST child
server tạo generation task
response connection reset
Agent nhận network error
```

Nếu orchestration không có durable ToolCall/idempotency record trước side effect, caller có thể không biết child đã tồn tại hay chưa.

### Current protection

Generation APIs có `client_request_id`, billing idempotency và nhiều dedupe primitives. Tuy nhiên Agent-level side effect boundary chưa được model hóa thành `AgentToolCall` first-class.

### Required fix

- persist `AgentToolCall` trước submit;
- deterministic idempotency key;
- service resolve existing generation by key trước create;
- after unknown outcome, reconcile thay vì blind submit.

---

## AGF-006 — Whole-Agent JSON row trở thành contention/hot row

**Severity:** P1/P2  
**Stage:** `PERSISTENCE`

### Source evidence

- `mutatePostgresRun()` lock row Agent bằng `FOR UPDATE`.
- `updateAgentRunTaskById()` map toàn bộ `tasks[]` rồi update toàn payload.

### Important nuance

Hiện tại row lock giúp tránh lost update; đây **không phải race bug trực tiếp**.

### Risk

- nhiều task parallel serialize vào một row;
- write amplification;
- khó index/query task;
- migration partial plan khó;
- debugging và admin ops khó.

### Required fix

Tách:

```text
agent_runs
agent_plans
agent_tasks
agent_task_dependencies
agent_tool_calls
```

`generation_tasks` vẫn là runtime của generation.

---

## AGF-007 — Agent task state quá coarse để biểu diễn recovery chính xác

**Severity:** P1  
**Stage:** `TASK_SCHEDULING`

Current statuses:

```text
ready
running
completed
failed
cancelled
```

Không biểu diễn rõ:

```text
CLAIMED
DISPATCHING
WAITING_RETRY
WAITING_CHILD
FINALIZING
```

### Risk

- recovery phải suy luận trạng thái từ `taskId/taskIds/childTasks`;
- error handling dùng exception type + field combinations;
- khó chứng minh no-duplicate side effects.

### Required fix

AgentTask state machine riêng; ToolCall state machine riêng.

---

## AGF-008 — Agent lifecycle phụ thuộc worker availability

**Severity:** P1  
**Stage:** `POLLING_RECOVERY / DEPLOYMENT`

### Source evidence

- `generation-worker.mjs`
- `generation-task-recovery-service.ts`
- event route wake recovery.

### Expected design

Dependency này không sai; async Agent cần worker/recovery.

### Failure mode

Nếu worker heartbeat stale/missing hoặc worker/app không tương thích:

- run có thể chậm/stuck;
- pending task không được poll/finalize kịp;
- browser SSE có thể wake một phần recovery nhưng không nên là reliability guarantee chính.

### Required fix

- readiness check worker health;
- alert heartbeat stale;
- deployment version fencing;
- worker là production-required service, không phải optional helper.

---

## AGF-009 — App và Worker có thể chạy khác build/version

**Severity:** P0/P1  
**Stage:** `DEPLOYMENT`

### Source evidence

`docker-compose.yml`:

```text
app image: ${VOZEB_PRO_IMAGE:-ghcr.io/csyqlz/vozeb-pro:v0.0.6}
worker image: ${VOZEB_PRO_IMAGE:-ghcr.io/csyqlz/vozeb-pro:v0.0.6}
```

Nếu custom deployment override/build không nhất quán, app và worker có thể chạy khác digest.

### Risk

- worker hiểu execution phase khác app;
- recovery logic khác schema/state producer;
- bug chỉ xuất hiện production.

### Required fix

Heartbeat/readiness thêm:

```text
buildVersion
gitSha
schemaVersion
runtimeProtocolVersion
```

Không nhận job nếu incompatible.

---

## AGF-010 — Protocol fallback dựa trên runtime guessing tăng failure surface

**Severity:** P1  
**Stage:** `PROVIDER_PROTOCOL`

### Example

Image runtime có nhiều path/fallback giữa:

- `/images/generations`;
- JSON image edits;
- response format variants;
- `/responses`.

### Risk

- mỗi fallback có billing/auth/capability semantics khác;
- 400 do invalid prompt có thể bị hiểu nhầm là protocol mismatch;
- request accepted nhưng client thử protocol khác có thể gây duplicate cost nếu upstream idempotency không đảm bảo.

### Required fix

Provider binding phải khai báo protocol:

```text
OPENAI_IMAGES_JSON
OPENAI_IMAGES_MULTIPART
OPENAI_RESPONSES_IMAGE
CUSTOM_ASYNC_VIDEO
...
```

Fallback chỉ cho phép trước accepted boundary và theo error taxonomy cụ thể.

---

## AGF-011 — Blind failover sau provider acceptance có nguy cơ duplicate generation/cost

**Severity:** P0  
**Stage:** `PROVIDER_EXECUTION`

### Rule

Sau một trong các tín hiệu:

- upstream task ID returned;
- provider explicitly accepted;
- first output token/frame/content received;

không được tự gửi lại sang provider khác nếu chưa reconcile request cũ.

### Current foundation

Billing context đã có fields về provider idempotency support/key. Đây là nền tảng tốt nhưng Agent/Generation policy phải áp dụng consistent accepted boundary.

### Required fix

Tool/attempt có state `ACCEPTED`; failover policy chỉ áp dụng trước state này trừ khi provider contract có explicit safe retry.

---

## AGF-012 — Review nằm trên critical path cho đa task

**Severity:** P2  
**Stage:** `REVIEW`

`shouldBlockOnReview()` trả true nếu `run.tasks.length > 1`.

Review service đã graceful-fallback sang `unavailable`, nên chủ yếu là vấn đề:

- latency;
- thêm model request;
- thêm billing settlement;
- thêm dependency trước `run.completed`.

### Required fix

Default review background; chỉ blocking trong strict/high-quality mode hoặc workflow yêu cầu quality gate.

---

## AGF-013 — Parent run failure semantics không đủ chi tiết

**Severity:** P1  
**Stage:** `OBSERVABILITY`

`failureStage` chỉ có bốn giá trị coarse. Một production Agent cần phân biệt:

```text
planner_request
planner_parse
planner_validation
planner_settlement
tool_dispatch
tool_unknown_outcome
child_running
child_provider
child_asset_import
child_settlement
scheduler
recovery
cancellation
```

### Required fix

Không nhất thiết mở rộng `AgentRun.status`; thay vào đó lưu structured error trên `AgentTask`/`AgentToolCall` và derive run summary.

---

## AGF-014 — Browser event stream đang wake recovery

**Severity:** P2  
**Stage:** `EVENT_DELIVERY / RECOVERY`

SSE route chủ động gọi `runGenerationTaskRecoveryBatch()` khi run active. Đây là optimization hữu ích, nhưng không nên trở thành assumption rằng user phải mở browser để workflow tiến triển.

### Required invariant

- worker một mình phải đủ để hoàn tất/recover run;
- SSE chỉ wake nhanh hơn.

---

## AGF-015 — Cancellation transport và cancellation state đang trộn

**Severity:** P1/P2  
**Stage:** `CANCELLATION`

Current flow có semantics tốt: cancel requested và confirm child terminal. Tuy nhiên transport vẫn là self-HTTP.

### Required fix

- giữ `CANCELLING`/pending confirmation semantics;
- thay HTTP bằng internal generation service;
- cancellation phải idempotent;
- provider không hỗ trợ cancel thì parent cần policy rõ: detach/wait/mark ignored output.

---

## AGF-016 — Planner structured-output sensitivity

**Severity:** P1/P2  
**Stage:** `PLANNING`

Planner phải trả contract có cấu trúc. OpenAI-compatible providers có thể khác nhau về:

- tool call format;
- streaming termination;
- JSON strictness;
- Responses vs Chat semantics.

### Current mitigation

- candidate ranking/failover;
- structured parsing;
- planner attempt telemetry;
- `resolveSystemAiTextFailure()`.

### Required fix

- planner adapter contract per protocol;
- canonical normalized response;
- parse/validation error taxonomy;
- failover chỉ khi request acceptance cho phép.

---

## 2. Failure priority matrix

| ID | Failure | Severity | Fix phase |
|---|---|---:|---|
| AGF-001 | Planner settlement terminal hóa lỗi transient | P0 | R1 |
| AGF-002 | `/responses` image fallback image→text | P0 | R1 |
| AGF-003 | `Promise.all` fail-fast + sibling side effects | P0 | R1/R5 |
| AGF-005 | Unknown dispatch outcome | P0/P1 | R2/R6 |
| AGF-009 | App/worker build mismatch | P0/P1 | R1 |
| AGF-011 | Failover sau accepted boundary | P0 | R7/R9 |
| AGF-004 | Self-HTTP internal dispatch | P1 | R2/R3 |
| AGF-007 | AgentTask state coarse | P1 | R4/R5 |
| AGF-008 | Worker availability/deployment dependency | P1 | R1/R13 |
| AGF-010 | Runtime protocol guessing | P1 | R9 |
| AGF-013 | Error semantics coarse | P1 | R8/R13 |
| AGF-016 | Planner protocol sensitivity | P1/P2 | R11 |
| AGF-006 | Whole-run JSON hot row | P1/P2 | R4 |
| AGF-015 | Cancellation transport coupling | P1/P2 | R3/R5 |
| AGF-012 | Blocking review | P2 | R12 |
| AGF-014 | SSE wake recovery coupling | P2 | R10/R13 |

---

## 3. Required diagnostic dimensions

Mọi lỗi Agent production sau refactor phải truy được tối thiểu:

```text
runId
planVersion
taskId
toolCallId
generationTaskId
attemptId
logicalModelId
bindingId
channelId
provider
upstreamTaskId
billingHoldId
billingAttemptNumber
assetIds
failureClass
retryable
acceptedBoundaryReached
```

Không log secret/API key/raw credential.

---

## 4. Definition of "fixed"

Một failure item chỉ được đóng khi có đủ:

1. regression test tái hiện lỗi cũ;
2. code path mới;
3. crash/retry test nếu có side effect;
4. observability field để xác định failure;
5. no duplicate charge/generation/asset proof cho P0 side-effect failures;
6. rollout/canary evidence ở production.
