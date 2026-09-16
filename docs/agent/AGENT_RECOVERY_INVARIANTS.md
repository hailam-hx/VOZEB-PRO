# AGENT_RECOVERY_INVARIANTS

> Tài liệu này định nghĩa các invariant bắt buộc để Agent có thể crash/retry/recover mà không tạo sai business result.  
> Các invariant phải được encode thành database constraints, state-transition guards và integration/chaos tests; không chỉ là convention trong code review.

## 1. Định nghĩa

### Durable state

State đã commit vào PostgreSQL và có thể được process khác đọc lại sau crash.

### Side effect

Bất kỳ hành động nào không thể coi là pure/replay-safe, ví dụ:

- submit request lên provider;
- tạo generation job;
- debit/settle wallet;
- tạo durable asset;
- gửi external webhook.

### Accepted boundary

Điểm mà hệ thống có đủ bằng chứng rằng một side effect external **có thể đã được chấp nhận**. Sau boundary này, retry không được blind-resubmit.

### Reconciliation

Quá trình đọc durable local state/upstream state/billing state để xác định kết quả của một operation có outcome chưa chắc chắn.

---

## INV-001 — Một logical ToolCall có một identity duy nhất

Mỗi Agent side effect phải có `idempotency_key` deterministic.

```text
UNIQUE(agent_tool_calls.idempotency_key)
```

Key không được thay đổi chỉ vì worker/process retry.

Ví dụ:

```text
agent:{runId}:{planVersion}:{taskKey}:{toolName}:{logicalAttempt}
```

**Không dùng random UUID mới cho mỗi retry của cùng logical operation.**

### Test

Hai worker đồng thời attempt cùng ToolCall -> chỉ một row/business operation được tạo.

---

## INV-002 — Persist intent trước side effect

Trước khi gọi `GenerationApplicationService.create*`, phải có durable ToolCall record.

```text
AgentTask READY
 ↓
ToolCall CREATED  -- commit
 ↓
submit side effect
```

Nếu process chết sau `CREATED`, recovery biết operation cần tiếp tục.

Nếu process chết trước `CREATED`, không có bằng chứng rằng side effect được phép chạy.

---

## INV-003 — Unknown outcome không tương đương failure

Network error sau khi request bytes có thể đã gửi không được map ngay thành "not submitted".

State cần phân biệt tối thiểu:

```text
NOT_SENT
SUBMITTING
ACCEPTED
UNKNOWN
SUCCEEDED
FAILED_PERMANENT
```

`UNKNOWN` bắt buộc reconciliation trước resubmit.

---

## INV-004 — Sau accepted boundary không blind resubmit

Khi có một trong các bằng chứng:

- local generation task đã persist với identity cố định;
- upstream task ID;
- provider accepted status;
- first content từ synchronous stream;
- provider idempotency acknowledgement;

ToolCall được xem là accepted.

Sau đó retry phải:

```text
query/recover existing operation
```

không:

```text
submit new operation blindly
```

---

## INV-005 — Provider failover chỉ safe trước acceptance

Provider A -> Provider B chỉ được tự động khi chứng minh request A chưa được accepted, hoặc provider contract có idempotency/failover guarantee tương đương.

```text
BEFORE_ACCEPT + retryable => failover allowed
AFTER_ACCEPT              => reconcile A
UNKNOWN_AFTER_SEND        => reconcile, no blind failover
```

Đặc biệt bắt buộc cho video và các operation chi phí cao.

---

## INV-006 — Một business usage chỉ settle một lần

Mỗi billable operation phải có stable business identity/fingerprint.

Nếu ledger đã settle nhưng caller crash trước update state:

```text
retry settlement
→ detect existing settlement
→ return settled result
→ no second debit
```

### Required assertion

```text
wallet_delta == expected_once
usage_record_count == 1 logical settlement
```

---

## INV-007 — Retryable settlement không làm mất business success

Nếu generation/planner result đã durable thành công nhưng settlement gặp transient error:

```text
business result remains recoverable
settlement enters retry state
```

Không được xóa output hoặc regenerate chỉ để thử billing lại.

Permanent billing invariant error có thể block completion theo policy, nhưng phải giữ evidence/result để operator reconcile.

---

## INV-008 — Asset finalization exactly-once về mặt logical output

Recovery sau provider success không được tạo nhiều durable Asset cho cùng logical output slot.

Cần unique identity theo một trong các cách:

```text
(tool_call_id, output_index)
```

hoặc generation-specific equivalent đã tồn tại.

### Test

Hai finalizer chạy đồng thời -> một asset logical output.

---

## INV-009 — Generation Runtime là owner duy nhất của provider attempt

Agent không gọi provider trực tiếp.

Agent chỉ gọi capability tool/application service:

```text
generate_image
generate_video
generate_audio
generate_text
```

Provider routing/failover/attempt state thuộc Generation Runtime.

Điều này tránh hai orchestration engine cùng retry một external request.

---

## INV-010 — Agent không trực tiếp debit wallet

Agent có thể yêu cầu/quan sát billing state nhưng không tự viết ledger hoặc tính provider cost.

```text
Agent → Generation/Planner billing service → Wallet/Ledger
```

Không có path:

```text
AgentTask → direct wallet mutation
```

---

## INV-011 — AgentTask state transition phải monotonic theo lifecycle

Allowed target model:

```text
PENDING -> READY -> CLAIMED -> RUNNING
RUNNING -> WAITING_CHILD
RUNNING -> WAITING_RETRY
WAITING_RETRY -> READY
WAITING_CHILD -> FINALIZING
FINALIZING -> COMPLETED
*
-> CANCELLED only by cancellation policy
*
-> FAILED only on permanent/non-recoverable condition
```

Không được transition ngược từ `COMPLETED` về `RUNNING` trong cùng task identity. Retry tạo logical attempt/tool state mới hoặc reset theo explicit retry transition, không mutate lịch sử terminal một cách mơ hồ.

---

## INV-012 — Task chỉ READY khi dependencies thỏa mãn

Với dependency bắt buộc:

```text
all(dep.status == COMPLETED)
```

mới READY.

Nếu dependency failed:

- task -> `SKIPPED` nếu không thể chạy;
- hoặc planner/policy tạo fallback/revision;
- không để task `READY` rồi fail bằng message chung "前置任务未完成" như cơ chế cuối-loop hiện tại.

---

## INV-013 — Sibling branch success không bị rollback bởi branch khác

Trong DAG parallel:

```text
A success
B transient fail
C success
```

A/C phải giữ durable state/assets. Retry B không regenerate A/C trừ khi plan revision explicit invalidates chúng.

---

## INV-014 — Parent Run terminal state được derive từ durable child state

Không được fail parent chỉ vì exception bị bubble khỏi Promise batch.

Parent terminal khi policy xác định từ states:

```text
all required tasks completed -> COMPLETED
required permanent failure + no acceptable partial result -> FAILED
partial policy satisfied -> COMPLETED/PARTIAL projection
cancel confirmed -> CANCELLED
```

Exception chỉ là input để update child state, không phải source of truth cho parent lifecycle.

---

## INV-015 — Plan version published là immutable

`agent_plans(run_id, version)` không mutate sau publish.

User chỉnh scene 2:

```text
Plan v1 remains intact
Plan v2 references/reuses unaffected outputs
```

Điều này bắt buộc để audit/recovery có thể biết task nào thuộc quyết định nào.

---

## INV-016 — Partial revision chỉ invalidate affected branch

Nếu task key ổn định:

```text
scene.1.image
scene.2.image
scene.2.video
```

và user chỉ đổi scene 2, revision không được invalidated scene 1/3/4 nếu inputs/dependencies không đổi.

Reuse phải explicit và auditable.

---

## INV-017 — Worker claim phải có lease ownership

Một worker chỉ mutate execution state nếu đang giữ valid lease hoặc transition dùng optimistic/transaction guard tương đương.

Pattern PostgreSQL khuyến nghị tiếp tục:

```sql
FOR UPDATE SKIP LOCKED
```

và:

```text
lease_owner
lease_until
```

Nếu lease hết hạn, worker cũ không được commit completion sau khi worker mới đã takeover nếu không có fencing/expected state guard.

---

## INV-018 — Process crash không thay đổi business meaning

Crash/restart tại bất kỳ điểm nào không được làm thay đổi kết quả logical cuối ngoài latency.

Ví dụ:

```text
without crash: 1 video + 1 charge
with crash:    1 video + 1 charge
```

không:

```text
2 videos + 2 charges
```

---

## INV-019 — Browser connection không phải execution dependency

SSE/EventSource có thể wake recovery để giảm latency, nhưng:

```text
close browser
```

không được dừng workflow.

Worker/background scheduler phải đủ để workflow tiến triển.

---

## INV-020 — Event delivery at-least-once, state effect idempotent

SSE client có thể nhận replay sau reconnect. Vì vậy client phải xử lý event theo ID/state idempotently.

Current `creative_run_events` + `Last-Event-ID` semantics nên được giữ.

Không giả định event được nhận exactly once.

---

## INV-021 — Event order trong một Run phải có cursor ổn định

Current event `bigserial id` cung cấp cursor tăng dần. V2 phải tiếp tục đảm bảo:

```text
query run events where id > lastEventId order by id asc
```

Nếu sau này chuyển sang per-run `sequence`, cần unique:

```text
UNIQUE(run_id, sequence)
```

---

## INV-022 — Snapshot và event phải hội tụ

Sau replay, frontend state từ:

```text
snapshot + events after cursor
```

phải hội tụ với authoritative DB state.

Không để event là source duy nhất của business state.

---

## INV-023 — Cancellation là request + confirmation, không phải instant boolean

Cancel state phải phân biệt:

```text
CANCELLING
CANCELLED
```

Nếu provider/job không xác nhận cancel:

- không giả rằng work đã dừng;
- recovery tiếp tục reconcile;
- output đến muộn được xử lý theo cancellation policy, không tự đưa run về success.

---

## INV-024 — Cancellation idempotent

Gọi cancel nhiều lần cho cùng Run/ToolCall:

- không tạo duplicate cancellation business side effects nguy hiểm;
- trả cùng terminal/pending state hợp lý;
- không resurrect task.

---

## INV-025 — Retry không reset history quan trọng

Retry phải giữ:

- prior attempt error;
- accepted boundary evidence;
- generation task references;
- billing identity;
- timestamps.

Không overwrite mọi thứ bằng `attempts += 1` rồi mất forensic data.

---

## INV-026 — Provider protocol là binding property, không phải runtime lottery

Mỗi binding/model route biết protocol adapter mong đợi trước khi submit.

Runtime chỉ fallback theo explicit safe compatibility rule.

Không thử hàng loạt payload khác nhau sau unknown acceptance.

---

## INV-027 — Capability identity không được thay đổi qua fallback

Một logical image request phải giữ capability `image` qua toàn lifecycle.

Protocol payload khác nhau không được khiến internal billing/policy reinterpret thành `text`.

Đây là invariant trực tiếp để ngăn lỗi `/responses` image fallback hiện tại.

---

## INV-028 — App/worker compatibility là precondition nhận việc

Worker heartbeat/readiness phải chứng minh compatible:

```text
runtimeProtocolVersion
schemaVersion
buildVersion/gitSha policy
```

Nếu incompatible, worker không claim task mới hoặc app readiness fail theo deployment policy.

---

## INV-029 — Recovery có giới hạn/backoff, không hot-loop

Retryable errors phải có:

- bounded exponential backoff;
- max retry/age policy theo loại operation;
- operator-visible stuck state nếu vượt threshold.

Current `generationTaskNextPollAt()` là pattern tốt để reuse.

---

## INV-030 — Permanent error classification phải deterministic

Cùng một provider/business error không nên lúc thì retry, lúc thì terminal tùy call site.

Cần centralized taxonomy:

```text
retryable
permanent
unknown/reconcile
cancelled
```

Agent scheduler dùng taxonomy, không parse message text tự do.

---

## INV-031 — Review không được phá hủy successful generation

Nếu review unavailable/error:

- outputs thành công được giữ;
- không charge lại generation;
- run completion policy rõ ràng.

Nếu review yêu cầu revision, revision là task/plan mới hoặc explicit retry; không mutate âm thầm output cũ.

---

## INV-032 — Observability correlation phải xuyên suốt

Mỗi output production cần trace được chuỗi:

```text
AgentRun
→ PlanVersion
→ AgentTask
→ ToolCall
→ GenerationTask
→ GenerationAttempt
→ Provider upstream ID
→ Asset
→ Usage/Settlement
```

Missing link trong chuỗi là operational defect.

---

## 2. Crash matrix bắt buộc

| Crash point | Recovery expectation |
|---|---|
| trước ToolCall persist | không side effect |
| sau ToolCall persist, trước generation create | resume create cùng idempotency key |
| sau generation row create, trước provider submit | reuse generation row |
| ngay sau provider accepted | query existing, không resubmit |
| sau provider success, trước asset persist | finalize cùng logical output |
| sau asset persist, trước ToolCall complete | discover/reuse asset |
| trước billing settle | settle once |
| sau billing settle, trước caller state update | detect already-settled, no second debit |
| AgentTask complete, trước parent update | derive/reconcile parent state |
| worker crash với active lease | lease expiry + safe takeover |
| app restart | worker/recovery tiếp tục |
| SSE disconnect | execution tiếp tục, replay events khi reconnect |

---

## 3. Concurrency matrix bắt buộc

### Two workers claim same task

Expected:

```text
one lease winner
zero duplicate side effects
```

### Two retries same ToolCall

Expected:

```text
one idempotency identity
one generation logical job
```

### Webhook + poll complete cùng lúc

Expected:

```text
one logical finalization
one asset set
one usage settlement
```

### Cancel + completion race

Policy phải explicit, ví dụ:

- nếu completion durable trước cancellation accepted -> preserve completed child, parent cancellation policy quyết định visibility;
- nếu cancellation accepted trước completion -> late result không resurrect run.

Không phụ thuộc race timing ngẫu nhiên.

---

## 4. Database constraints đề xuất

Tối thiểu:

```sql
UNIQUE (run_id, version)                 -- agent_plans
UNIQUE (plan_id, task_key)               -- agent_tasks
PRIMARY KEY (task_id, depends_on_task_id) -- dependencies
UNIQUE (idempotency_key)                 -- agent_tool_calls
```

Generation hiện đã có các constraint/idempotency index quan trọng và nên được reuse, ví dụ unique `client_request_id` scope và unique `(channel_id, upstream_task_id)` khi có upstream task ID.

---

## 5. Test assertions chuẩn

Mỗi recovery integration test side-effect phải assert ít nhất:

```text
provider_submit_count
logical_generation_count
asset_count
usage_record_count
settlement_count
wallet_balance_delta
hold_terminal_state
agent_task_terminal_state
agent_run_terminal_state
event terminal count/order
```

Chỉ assert HTTP 200/`status=completed` là chưa đủ.

---

## 6. Release gate

Không bật Agent Runtime V2 mặc định trước khi:

- tất cả P0 invariant tests xanh;
- chaos matrix xanh trên PostgreSQL integration environment;
- không có duplicate settlement trong canary;
- worker compatibility check hoạt động;
- reconciliation backlog quan sát được;
- admin có thể truy trace chain đầy đủ;
- rollback flag đã kiểm thử.

---

## 7. Invariant summary — 10 điều quan trọng nhất

Nếu cần kiểm tra nhanh code review, ưu tiên 10 câu hỏi sau:

1. Side effect này có durable idempotency identity chưa?
2. Intent đã persist trước khi gửi external request chưa?
3. Nếu response mất sau submit, code có reconcile hay blind retry?
4. Sau accepted boundary có thể failover/resubmit không?
5. Billing có thể settle hai lần không?
6. Asset có thể finalize hai lần không?
7. Một branch fail có làm mất sibling success không?
8. Restart app/worker có thay đổi business result không?
9. Browser/SSE có đang vô tình là execution dependency không?
10. Từ AgentRun có truy được đến exact provider attempt và settlement không?

Nếu bất kỳ câu nào chưa có câu trả lời deterministic, flow đó chưa đạt durable Agent standard.
