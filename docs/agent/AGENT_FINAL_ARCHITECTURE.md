# Agent Final Architecture

Status: production candidate after the R0-R15 stability refactor on 2026-09-16.

## Authority and scope

This document describes the implemented architecture. The source code and database schema remain authoritative. Agent owns planning, dependency orchestration, task state, and the association between a logical tool call and an existing Generation task. It does not own provider execution, media persistence, usage accounting, or wallet settlement.

The PostgreSQL runtime is the production execution model. The file provider remains a serialized, single-process development fallback and keeps the legacy aggregate payload contract; it is not a multi-instance scheduler.

## End-to-end execution flow

1. The Agent Run API creates a creative conversation, the user message, assistant placeholder, and a `generation_tasks` compatibility record with `task_type = agent` in one runtime transaction.
2. `executeAgentRun` acquires the existing `generation_tasks` Run execution lease and invokes the configured default text model through the system AI billing runtime. The planner emits a validated logical plan; it has no generation route URL, provider endpoint, wallet, scheduler, or retry knowledge.
3. Planner usage is settled through the existing reserve/attempt/evidence/settlement primitives. The successful plan and settlement identity are persisted before child dispatch. A transient settlement failure leaves the Run recoverable; an incomplete or conflicting permanent billing identity terminates it.
4. `syncAgentRuntimeProjection` persists the plan as an immutable, versioned `agent_plans` row and materializes ordered `agent_tasks` plus `agent_task_dependencies` in the same PostgreSQL transaction as the Run mutation. `hydrateAgentRuntimeProjection` reconstructs the execution view from those first-class rows.
5. `claimReadyAgentTasks` selects only due tasks whose dependencies are complete, using `FOR UPDATE SKIP LOCKED`. It records lease owner, lease expiry, and attempt state. Retry time is stored in `next_attempt_at`; a later scheduler pass resumes the task without a hot loop.
6. Before a generation side effect, `createAgentGenerationTask` persists an `agent_tool_calls` row with a stable idempotency key derived from Run, plan version, task key, and child slot. A repeated call reuses its bound Generation task. Conflicting material input under the same identity is rejected.
7. The Agent invokes the shared server application handlers directly. REST task-creation routes re-export the same image, video, audio, and text application functions, so Agent execution no longer performs internal HTTP calls to its own task routes.
8. The existing Generation Runtime performs authorization, capability filtering, logical-model and provider selection, request adaptation, provider submission, lease-based polling, result persistence, asset registration, and Generation billing. Accepted or acceptance-unknown work is never blindly submitted to another provider.
9. Generation completion is mapped back to the stable Agent child slot. Creative assets are upserted by stable Run/task/ordinal identity. A failed branch cannot erase completed siblings; independent branches settle individually and the parent derives `completed`, partial completion, retry, or failure from durable child states.
10. Required tasks may complete the public Agent result before review. Review runs asynchronously for ordinary requests; only explicit strict-review modes keep it on the blocking path.
11. Agent mutations append to `creative_run_events` in the same PostgreSQL transaction. SSE uses the monotonic event ID as `Last-Event-ID`; reconnect reads durable events and a terminal snapshot without controlling execution lifetime.
12. Generation Operations joins Agent tasks and ToolCalls to the existing Generation task detail, attempts, upstream identity, assets, usage holds, and settlement evidence.

```text
Agent Run request
  -> planner attempt -> planner usage settlement
  -> immutable AgentPlan
  -> dependency-aware AgentTask lease
  -> stable AgentToolCall
  -> Generation application layer
  -> Generation Runtime / provider attempt
  -> asset finalization + Generation settlement
  -> Agent task/result derivation
  -> public completion -> asynchronous review (unless strict)
```

## Durable entities

| Entity | Responsibility | Important identity or fencing |
| --- | --- | --- |
| `agent_runs` | First-class Run projection and active plan pointer | Run ID and active plan version |
| `agent_plans` | Immutable normalized plan | `(run_id, version)` |
| `agent_tasks` | Independent DAG task lifecycle | `(plan_id, task_key)`, ordinal, lease owner/expiry |
| `agent_task_dependencies` | Persisted DAG edges | `(task_id, depends_on_task_id)` |
| `agent_tool_calls` | Logical side-effect identity and Generation link | unique idempotency key, at most one Generation task |
| `agent_context_snapshots` | Versioned execution context when needed | Run and plan version |
| `creative_run_events` | Durable UI/audit event stream | Monotonic `bigserial` cursor |
| `generation_tasks` | Generation Runtime state and Agent compatibility aggregate | Generation task ID, parent Run/task, client request ID |

The plan/task tables are additive. `generation_tasks.payload` remains a compatibility projection for existing APIs and the file provider, but PostgreSQL task scheduling and hydration use the first-class Agent rows.

## Task states and recovery

Persisted task states are `pending`, `ready`, `claimed`, `running`, `waiting_retry`, `waiting_external`, `finalizing`, `completed`, `failed`, `cancelled`, and `skipped`.

- A task becomes claimable only when every declared dependency is complete and `next_attempt_at` is due.
- A task claimant receives a lease owner and expiry. Run mutations retain the existing execution-ID fence, so an expired Run executor cannot overwrite a newer attempt; task claims use row locking and lease ownership to prevent concurrent execution.
- `waiting_retry` stores the next eligible time. Retry policy follows the existing Generation/Agent configuration and provider contract; the scheduler adds no arbitrary retry count or delay.
- `waiting_external` and a bound ToolCall resume the existing Generation task.
- A ToolCall with `unknown` submission outcome remains observable and is not converted to a safe retry.
- Completed sibling tasks and assets remain durable when another branch waits or fails.

## Idempotency and side-effect boundaries

The last point at which generic failover is safe is before the provider acceptance boundary. The protocol adapter and Generation Runtime own that decision.

Agent establishes identity before creation. `prepareAgentToolCall` inserts or reads the stable logical call, `bindAgentToolCallGeneration` uses compare-and-set semantics to bind exactly one Generation task, and later recovery reads that binding. Generation retains its own stable client request IDs, provider task IDs, asset upserts, usage records, and settlement idempotency. This layered contract prevents Agent recovery from inventing another provider submission, asset, ledger entry, or wallet debit.

## Billing ownership

Planner calls use the system AI billing runtime:

```text
reserve/admit -> attempt -> usage evidence -> exactly-once settlement
```

The persisted planner attempt and settlement identity allow recovery after either side of the ledger/state boundary. Agent does not debit wallets or calculate provider charges. Image, video, audio, and text generation charges remain exclusively owned by the Generation Runtime.

## Provider protocols

Bindings resolve an explicit protocol and its request, response, query/cancel, capability, timeout, and replay behavior through the existing channel protocol registry and provider task configuration. Runtime code does not guess an unregistered model-catalog endpoint. A known rejection before acceptance may follow configured failover policy; accepted or ambiguous submission cannot fail over unless the adapter proves replay safety.

## Worker compatibility and deployment fencing

App and worker exchange application version, immutable Git SHA, schema contract `20260916_agent_runtime_v2`, and runtime protocol version. Maintenance endpoints reject incompatible workers before they claim Generation or usage-recovery batches, and readiness reports the incompatibility. The production Docker build embeds `VOZEB_PRO_GIT_SHA`; the image workflow supplies the commit SHA. App and worker must be deployed from the same immutable image digest.

## Operations and diagnostics

The existing Generation Operations detail now exposes:

```text
Agent Run -> AgentTask -> AgentToolCall -> GenerationTask
          -> GenerationAttempt -> Provider -> Asset -> Usage/Settlement
```

It includes persisted status, retry time, lease/recovery state, upstream task identity, assets, holds, settlement details, and recorded error stage. Existing request and stream diagnostics retain real timings such as upstream start, first byte/content, last frame, and completion when the protocol supplies them; no synthetic timings are added.

## Compatibility limits

- The file provider is safe for serialized local development, but it does not offer PostgreSQL row locks, `SKIP LOCKED`, or multi-process lease guarantees.
- The shared creation handlers still accept Web `Request` objects and return `Response` objects, and the polling adapter invokes the existing GET handlers in-process. Self-HTTP is gone, but a future typed command/query interface could further separate transport concerns and make every read route a thin controller.
- `generation_tasks.payload` remains during compatibility. New PostgreSQL execution state must be read from the first-class Agent tables; removing the aggregate requires a later API/storage migration.
