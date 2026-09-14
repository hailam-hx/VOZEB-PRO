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
