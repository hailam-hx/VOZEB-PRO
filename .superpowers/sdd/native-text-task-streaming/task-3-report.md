# Task 3 report — Agent Run text streaming, retry and replay

## Status

Implemented the Task 3 integration. Focused service, API, hook and component checks pass. The final application/browser matrix is assigned to Task 4/root; no real provider was called in this task.

## Changes

- Text task creation now validates the run owner, current execution ID and running text parent before storing server-owned `runId` / `parentTaskId`. Child task and attempt IDs still come from the TextTask service.
- `mirrorAgentTextTaskSnapshot` mirrors durable accepted state into the matching AgentRunTask and emits an event in the same existing creative-runtime mutation. It rejects stale attempt/revision updates. Public event data is explicitly limited to `runId`, `taskId`, `parentTaskId`, `attemptId`, `revision`, `content`, `status`.
- `task.attempt.started` advances active attempt state without assigning the old visible partial to the new attempt. `task.text.updated` replaces accumulated text. `activeAttemptId`, `textRevision`, `textStatus`, and the public visible snapshot are available in run snapshots; provider/model audit and attempts remain private.
- Closing a TextTask attempt now advances its durable revision and updates its visible snapshot revision when it has content. AgentRun uses this authoritative revision; there is no synthetic public-only revision.
- Runtime lifecycle notifications are separate from the existing nonempty `onSnapshot` hook, preserving Custom's single buffered content emission. Recovery execution supplies both hooks so progress is published while the Agent executor polls.
- Text retries preserve child IDs, parent IDs, previous attempts and visible partial text. The existing failed TextTask is reset to pending with current server-resolved channel configuration; its next execution opens a new attempt. Image, video and audio retry paths remain as before.
- Text cancellation aborts the accepted current attempt through a process-wide registry. A stale explicit attempt ID or stale persisted CAS cannot cancel a retry. Agent cancellation passes its known text attempt identity. Separately loaded route modules share the registry.
- `/create` and Canvas use one attempt/revision tracker. Duplicate, out-of-order and retired-attempt events are ignored; accumulated snapshots replace text. Empty retries retain the old partial. `/create` renders partial text with localized status, including failure/cancellation; Canvas upserts one stable text message per parent task with localized status metadata.
- SSE refreshes its snapshot after draining new events so a newer text event cannot be followed by the old attempt snapshot. Global event IDs remain the replay cursor.

## TDD evidence

All substantive new behaviors were exercised RED before their implementations. Initial missing exports were replaced by inert API skeletons and the tests were rerun to verify assertion failures rather than module-load errors.

| Regression | Observed RED | GREEN |
| --- | --- | --- |
| Durable text mirror / client replacement | Missing snapshot, expected `一二` but received undefined | Real file-store persistence and replay assertions pass |
| Terminal authoritative revision | Expected revision 2; received 1 | Close advances TextTask and mirrored revision |
| Lifecycle publication | Expected `running, succeeded`; received no lifecycle frames | Separate durable lifecycle hook passes |
| Current cancellation | Expected current AbortSignal aborted; received false | Accepted PATCH aborts current only |
| Stable text retry | Child/task IDs became undefined | Text-only retry keeps original IDs and partial |
| Recovery progress | Expected in-flight text observation; received empty list | Recovery supplies accepted snapshot hook |
| Context / retry reset | Trusted context and retry returned null | Owner/execution validation and same-child reset pass |
| Actual executor retry | Existing text child stayed failed | Child reset precedes polling and result completes under same ID |
| `/create` and Canvas replay | No callback/text on event or snapshot | Both watchers restore and replace text |
| `/create` hook and UI | Run had no snapshot; partial absent while running/failed/cancelled | Run updates and public partial rendering pass |
| SSE ordering | New event was followed by `activeAttemptId: old` | Latest snapshot carries new attempt |
| Route module registry | Cancellation through separately loaded module returned false | Process registry shares current controller |
| Explicit stale cancellation | Expected 409; received 200 | Stale attempt request rejected without mutation |

## Verification

Runtime used for checks: Node 22 at `/Users/jake/.nvm/versions/node/v22.23.2/bin`.

Focused regression command (19 files, **213 tests passed**):

```sh
PATH=/Users/jake/.nvm/versions/node/v22.23.2/bin:$PATH npm test -- \
  src/lib/agent-text-stream.test.ts \
  src/lib/server/agent-run-text-stream.test.ts \
  src/lib/server/agent-run-store.test.ts \
  src/lib/server/agent-run-public.test.ts \
  src/lib/server/text-task-attempt.test.ts \
  src/lib/server/text-task-runtime.test.ts \
  src/lib/server/text-task-stream-control.test.ts \
  src/lib/server/generation-task-recovery-service.test.ts \
  src/services/api/creative.test.ts \
  'src/app/(user)/create/use-create-agent.test.ts' \
  'src/app/(user)/create/components/creative-messages.test.tsx' \
  'src/app/(user)/canvas/components/canvas-agent-run-client.test.ts' \
  'src/app/(user)/canvas/components/canvas-agent-node-retry.test.ts' \
  'src/app/(user)/canvas/components/canvas-agent-chat-ui.test.tsx' \
  'src/app/api/text-tasks/[id]/route.test.ts' \
  'src/app/api/agent/runs/[id]/[action]/route.test.ts' \
  'src/app/api/agent/runs/[id]/events/route.test.ts' \
  'src/app/api/agent/runs/[id]/tasks/[taskId]/retry/route.test.ts' \
  src/lib/server/creative-runtime-store.test.ts
```

- New actual-executor regression: `npm test -- src/lib/server/agent-run-executor.test.ts -t 'restarts a failed text'`: **1 passed**.
- `npm run typecheck`: **passed**.
- ESLint of every changed/new source/test file from the web directory: **passed**.
- Prettier applied to changed/new source/test files. `git diff --check`: **passed**.

The complete `agent-run-executor.test.ts` run reports **65 passed, 4 failed**. These four existing routed chat/planning fixtures use function-call-shaped response bodies and were left unchanged at root's direction:

1. `lets the text model select a same-conversation media candidate for continuous creation`
2. `does not attach an old candidate when the text model plans a new subject`
3. `plans chat media without canvas ops, links the child task and registers a stable asset`
4. `emits an idempotent project handoff for chat without creating media tasks`

The first also fails when run alone; the failure is absent downstream creation after its planning fixture. No production planner behavior or those four tests were changed for Task 3.

## Remaining validation / limits

- Root/Task 4 owns aggregate build, full quality gates, UTF-8 release verification, and desktop/mobile browser checks including `/create` and Canvas. This subtask has component markup and jsdom hook coverage, not a completed real-browser layout matrix.
- Tests used in-memory/file-store test adapters, fake EventSource, and local stream/TCP fixtures. There were no configured upstream calls and no live-provider billing.
- The abort registry coordinates route/runtime module instances inside one process; durable cancellation remains the cross-process state authority.

## Review fix round 1 — integration and replay

All four review findings are addressed. This round used receiving-code-review, systematic-debugging, TDD, and verification-before-completion: controlled failing interleavings were reproduced before the corresponding production fixes, followed by focused and broader verification. No subagents or real providers were used.

### Corrections

1. **Cross-attempt reconciliation ordering.** The shared tracker records local observation checkpoints. An asynchronous API reconciliation captures its checkpoint before reading; if a newer observation overtakes it, the stale read cannot replace/retire the active attempt. Both watchers also ignore that read's obsolete terminal run status, so it cannot close the new attempt's stream. Ordered SSE snapshots use the current checkpoint. These are private client bookkeeping values, not new public fields or SSE IDs.
2. **Independent visible snapshot restoration.** Retained visible text merges by its own attempt/revision, independently of the active attempt's revision. Replaying retry start at revision 0 no longer prevents restoration of the old partial. Once the active attempt has nonempty text, an older attempt's visible snapshot cannot replace it.
3. **Durable terminal readiness.** TextTask GET and accepted cancellation PATCH remain publicly nonterminal until the existing persisted execution phase reaches `completed`. Task payload termination, writer flushing, authoritative attempt closure and AgentRun mirroring can therefore finish before parent polling observes terminal. Cancellation retains the active worker lease; another recovery worker cannot close the attempt before its writer has a chance to flush. Scheduler eligibility now includes terminal TextTasks whose execution phase is unfinished, so interruption between payload termination and publication is recoverable after lease expiry. No synthetic revision, process-only completion barrier, new polling interval or retry count was introduced.
4. **Interrupted recovery reconciliation.** Submission-interrupted, exception, already-terminal and cancelled recovery exits close any still-open authoritative terminal attempt and mirror its retained partial/terminal revision before releasing the completed phase. A failed ownership CAS cannot authorize closing a newer still-running attempt.

The durable readiness boundary also exposed the existing parent cancel handler's manual-reconfirm behavior. At root's direction this round adds automatic single-request cancellation for runs cancelling text children. The persisted paused parent receives a `cancel_requested` schedule; its recovery confirms/delivers outstanding cancellation intent, advances only cancelled/terminal children, checks their durable readiness, and finalizes the run. It cannot accidentally start an unsubmitted generation while trying to cancel it. Existing scheduler backoff/batching and SSE wakeups are reused, and old executor releases cannot overwrite the cancellation phase. Media-only cancellation response behavior and all media retry behavior remain unchanged.

### RED / GREEN evidence

| Regression | Observed RED before fix | GREEN evidence |
| --- | --- | --- |
| Delayed snapshot after new attempt event | Tracker adopted old attempt and stopped accepting current content | Shared tracker and API replay suites pass |
| Retry-start revision 0 followed by retained-partial snapshot | Missing retained partial; Canvas callback received no text | Helper and Canvas restore tests pass |
| Delayed failed API read after retry begins | Watcher closed before receiving new text | Both watcher reconciliation paths reject superseded termination; API running/failed variants pass |
| Public terminal before publication, unfinished terminal recovery, interrupted exit mirroring | Combined route/scheduler/recovery run: **10 failed, 32 passed**; raw terminal returned, terminal tasks not claimed, mirror not called | GET covers success/error/cancelled; recovery pauses publication and proves no completed lease release yet |
| Failure loses ownership to newer running attempt | Recovery still closed/mirrored it and completed its lease | Recovery rejects stale cleanup without closing, mirroring or releasing |
| Single cancellation needs automatic parent finalization | **2 failures**: paused cancellation not claimable and child publication never reached | One real cancel Route Handler call plus controlled recovery reaches final cancelled run only after the child publication promise resolves |
| Old worker release overwrites cancellation phase | Non-cancellation release cleared the persisted cancellation schedule | Scheduler requires cancellation-authorized release for that phase |
| Delayed cancellation delivery | Cancellation recovery called the generation runtime for a pending child | Recovery sends cancellation first; generation runtime is never invoked |

Additional controlled integration checks exercise native TextTask runtime success/error/cancelled publication pauses through the real public GET handler. The parent executor then verifies that the public nonterminal phase cannot terminate the run, and its terminal event follows the text publication readiness boundary.

### Final verification for this round

All commands ran from `web` using `PATH=/Users/jake/.nvm/versions/node/v22.23.2/bin:$PATH`.

- The 19-file focused command above, plus `src/lib/server/generation-task-store.test.ts` and `src/lib/server/generation-task-scheduler.test.ts`: **21 files, 265 tests passed**.
- `npm test -- src/lib/server/agent-run-executor.test.ts -t 'publication readiness|restarts a failed text'`: **4 passed**.
- Full `npm test -- src/lib/server/agent-run-executor.test.ts`: **68 passed, the same 4 baseline failures** listed above. Those tests and planner production behavior were not modified.
- `npm run typecheck`: **passed**.
- ESLint of all 21 changed TypeScript source/test files: **0 errors, 9 existing unused-variable warnings**. Their locations are outside this round's changed lines; they were left untouched.
- Prettier applied to changed files; `git diff --check`: **passed**.

The browser gap is unchanged: this round verifies EventSource consumers, components, public endpoints, real runtime interleavings and scheduler/recovery fixtures, but does not claim the desktop/390px/430px `/create` and Canvas live-browser matrix. Root/Task 4 owns that aggregate matrix and full release gates. PostgreSQL query contracts are covered with mocked query assertions; this round did not run a live PostgreSQL database or external upstream.
