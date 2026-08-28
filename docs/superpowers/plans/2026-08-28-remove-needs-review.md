# Remove `needs_review` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xóa hoàn toàn trạng thái `needs_review` và chức năng `接管待确认任务`; mọi kết quả upstream không xác định kết thúc thất bại, giải phóng điểm tạm giữ và không tạo tiêu hao.

**Architecture:** Thu gọn state machine tại nguồn bằng cách để từng runtime/recovery chuyển tình huống không xác định sang helper thất bại hiện có, sau đó xóa contract `needs_review` khỏi scheduler, store, API và UI. Billing xử lý mọi bằng chứng `unknown` bằng release idempotent; client chỉ còn nhận trạng thái thành công, thất bại, hủy hoặc đang chạy.

**Tech Stack:** Next.js Route Handlers, React, TypeScript, Vitest, PostgreSQL schema SQL, Ant Design, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-28-remove-needs-review-design.md`

## Global Constraints

- Không gửi lại request tạo media và không đổi binding/channel khi kết quả submit không xác định.
- Mọi thất bại mới phải ghi lý do cụ thể, kết thúc generation task và giải phóng billing hold.
- Không tạo consume record cho task thất bại.
- Không thêm migration hoặc lớp tương thích cho record `needs_review` cũ.
- Không thay đổi quy tắc quyết toán thành công hoặc hủy sau khi upstream đã nhận request.
- Không sửa file ngoài phạm vi và không làm mất thay đổi hiện có của người dùng.

---

### Task 1: Release ambiguous billing holds instead of retaining them

**Files:**
- Modify: `web/src/lib/server/usage-billing-runtime.ts:220-370`
- Modify: `web/src/lib/server/usage-billing-runtime.test.ts:390-510`
- Modify: `web/src/lib/server/points-wallet-service.ts:160-180`
- Modify: `web/src/services/api/admin-billing-commerce.ts:85-95`
- Modify: `web/src/app/api/admin/billing/usage/recovery/route.test.ts`
- Modify: `web/src/app/api/maintenance/usage-holds/run/route.test.ts`

**Interfaces:**
- Produces: `resolveSystemAiTextFailure()` states `safe_to_failover | released | closed` only.
- Produces: `recoverOrphanUsageHolds()` result `{ inspected, retained, settled, released }`.
- Consumes: existing `releaseUsageBilling()` and `finishPendingAttempts()`.

- [ ] **Step 1: Change billing tests to the desired terminal behavior**

Add/replace assertions showing ambiguous acceptance and unknown orphan evidence release the hold:

```ts
await expect(
    resolveSystemAiTextFailure({
        userId: "user-one",
        businessId: "runtime:unknown-transport",
        reason: "transport unknown",
        final: false,
        currentAttempt: { attemptNumber: 1, acceptance: "unknown" },
    }),
).resolves.toEqual({ state: "released" });

expect(db.walletHolds).toEqual([expect.objectContaining({ status: "released" })]);
expect(db.usageCharges).toEqual([]);
```

Change recovery response tests to omit `needsReview`:

```ts
expect(result).toEqual({ inspected: 2, retained: 0, settled: 1, released: 1 });
```

- [ ] **Step 2: Run billing tests and verify RED**

Run:

```bash
cd web
pnpm exec vitest run src/lib/server/usage-billing-runtime.test.ts src/app/api/admin/billing/usage/recovery/route.test.ts src/app/api/maintenance/usage-holds/run/route.test.ts
```

Expected: FAIL because ambiguous holds are marked for review and the result DTO still contains `needsReview`.

- [ ] **Step 3: Implement idempotent release**

In `resolveSystemAiTextFailure`, close active holds on unknown acceptance after marking any pending attempt failed. In `finalizeUsageHold`, handle `unknown` exactly like `failed/not_received`:

```ts
if (evidence.state === "unknown" || evidence.state === "failed" || evidence.state === "not_received") {
    const reason = evidence.reason;
    await finishPendingAttempts(billingFromHold(hold), "failed", now);
    await releaseUsageBilling({ billing: billingFromHold(hold), reason, now });
    return { state: "released" as const };
}
```

Remove `markWalletHoldNeedsReview` if no caller remains. Remove the `needsReview` counter from recovery DTOs and admin client typing.

- [ ] **Step 4: Run focused tests**

Run the Step 2 command. Expected: all pass and no usage charge is created for released holds.

- [ ] **Step 5: Commit billing behavior**

```bash
git add web/src/lib/server/usage-billing-runtime.ts web/src/lib/server/usage-billing-runtime.test.ts web/src/lib/server/points-wallet-service.ts web/src/services/api/admin-billing-commerce.ts web/src/app/api/admin/billing/usage/recovery/route.test.ts web/src/app/api/maintenance/usage-holds/run/route.test.ts
git commit -m "fix(billing): release ambiguous generation holds"
```

### Task 2: Make text and image runtimes fail terminally

**Files:**
- Modify: `web/src/lib/server/text-task-runtime.ts:20-110,180-205`
- Modify: `web/src/lib/server/text-task-runtime.test.ts`
- Modify: `web/src/lib/server/image-task-runtime.ts:1-165`
- Modify: `web/src/lib/server/image-task-runtime.test.ts`
- Modify: `web/src/app/api/image-tasks/image-task-support.ts:315-340,765-785`
- Modify: `web/src/app/api/image-tasks/image-task-support.test.ts`
- Modify: `web/src/app/api/image-tasks/image-task-types.ts:45-65`

**Interfaces:**
- Produces: `TextTaskStep` with `pending | completed | failed` only.
- Produces: `ImageUpstreamStep` with `pending | result_ready | completed | failed` only.
- Consumes: existing `failTextTask()` and `markImageTaskFailed()`.

- [ ] **Step 1: Write failing runtime tests**

Change uncertain text submission and missing image query-contract tests to expect terminal failure:

```ts
await expect(runTextTaskStep(task, "http://internal", "")).resolves.toEqual({
    state: "failed",
    error: expect.stringContaining("无法确认"),
});

await expect(createImageTaskUpstreamStep(task, "http://internal", "https://public.example")).resolves.toMatchObject({
    state: "failed",
    error: expect.stringContaining("没有声明异步查询路径"),
});
```

Assert the task store updater is called with `status: "error"` and the schedule patch uses `executionPhase: "completed"`.

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```bash
cd web
pnpm exec vitest run src/lib/server/text-task-runtime.test.ts src/lib/server/image-task-runtime.test.ts src/app/api/image-tasks/image-task-support.test.ts
```

Expected: FAIL because runtime/support results still expose `needsReview`.

- [ ] **Step 3: Implement terminal failure paths**

Remove the `needsReview` property from image response types. Convert missing query contract into an explicit error result consumed by `createImageTaskUpstreamStep`; call the existing failure helper and schedule `completed`. Convert `GenerationSubmissionUncertainError`, unexpected text transport errors and missing upstream IDs into `failTextTask(...)` results.

The returned union must be equivalent to:

```ts
export type TextTaskStep =
    | { state: "pending"; status: string; upstreamTaskId: string; createPath: string }
    | { state: "completed" }
    | { state: "failed"; error: string };
```

- [ ] **Step 4: Run focused tests**

Run the Step 2 command. Expected: all pass, no schedule patch contains `needs_review`, and no image payload exposes `needsReview`.

- [ ] **Step 5: Commit runtime changes**

```bash
git add web/src/lib/server/text-task-runtime.ts web/src/lib/server/text-task-runtime.test.ts web/src/lib/server/image-task-runtime.ts web/src/lib/server/image-task-runtime.test.ts web/src/app/api/image-tasks/image-task-support.ts web/src/app/api/image-tasks/image-task-support.test.ts web/src/app/api/image-tasks/image-task-types.ts
git commit -m "fix(generation): fail uncertain text and image tasks"
```

### Task 3: Make Worker recovery and direct video creation terminal

**Files:**
- Modify: `web/src/lib/server/generation-task-recovery-service.ts`
- Modify: `web/src/lib/server/generation-task-recovery-service.test.ts`
- Modify: `web/src/app/api/video-generation-tasks/video-generation-route.ts:165-190`
- Modify: `web/src/app/api/video-generation-tasks/route.test.ts:160-210`
- Modify: `web/src/lib/server/agent-run-executor.test.ts:55-70`

**Interfaces:**
- Produces: recovery result `{ claimed, pending, resultReady, completed, failed, deferred }`.
- Produces: ambiguous direct video creation response with terminal error status.
- Consumes: task-specific failure helpers and `finalizeUsageBillingForBusiness()`.

- [ ] **Step 1: Write failing recovery and route tests**

Replace each manual-review expectation with failure and billing finalization assertions:

```ts
expect(result).toMatchObject({ claimed: 1, failed: 1 });
expect(mocks.releaseLease).toHaveBeenCalledWith(
    "video",
    "video-one",
    expect.any(String),
    expect.objectContaining({ executionPhase: "completed", nextPollAt: undefined }),
);
expect(mocks.finalizeUsageBillingForBusiness).toHaveBeenCalledOnce();
```

For the direct video route, expect an error response and a completed schedule instead of HTTP 202 with `needsReview: true`.

- [ ] **Step 2: Run recovery tests and verify RED**

Run:

```bash
cd web
pnpm exec vitest run src/lib/server/generation-task-recovery-service.test.ts src/app/api/video-generation-tasks/route.test.ts src/lib/server/agent-run-executor.test.ts
```

Expected: FAIL on `needsReview`/`needs_review` expectations.

- [ ] **Step 3: Collapse recovery branches**

Remove `"needs_review"` from `RecoveryResult`, remove its aggregate counter, and route these cases through failure helpers:

```ts
type RecoveryResult = "pending" | "result_ready" | "completed" | "failed" | "deferred";
```

When handler/query/submission evidence is missing, mark the business task failed first, finalize billing, then release the lease with `{ executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus }`. The direct video route must use the same terminal failure path and must not continue to another channel.

- [ ] **Step 4: Run focused tests**

Run the Step 2 command. Expected: all pass; response and worker summaries contain no review fields.

- [ ] **Step 5: Commit worker behavior**

```bash
git add web/src/lib/server/generation-task-recovery-service.ts web/src/lib/server/generation-task-recovery-service.test.ts web/src/app/api/video-generation-tasks/video-generation-route.ts web/src/app/api/video-generation-tasks/route.test.ts web/src/lib/server/agent-run-executor.test.ts
git commit -m "fix(worker): terminate uncertain generation tasks"
```

### Task 4: Remove public review state and Canvas review UI

**Files:**
- Delete: `web/src/services/api/generation-task-state.ts`
- Modify: `web/src/services/api/text.ts`
- Modify: `web/src/services/api/text.test.ts`
- Modify: `web/src/services/api/image.ts`
- Modify: `web/src/services/api/image.test.ts`
- Modify: `web/src/services/api/audio.ts`
- Modify: `web/src/services/api/audio.test.ts`
- Modify: `web/src/services/api/video-core.ts`
- Modify: `web/src/services/api/video-types.ts`
- Modify: `web/src/services/api/video.test.ts`
- Modify: `web/src/app/api/text-tasks/[id]/route.ts`
- Modify: `web/src/app/api/text-tasks/[id]/route.test.ts`
- Modify: `web/src/app/api/image-tasks/[id]/route.ts`
- Modify: `web/src/app/api/image-tasks/[id]/route.test.ts`
- Modify: `web/src/app/api/audio-tasks/[id]/route.ts`
- Modify: `web/src/app/api/audio-tasks/[id]/route.test.ts`
- Modify: `web/src/app/api/video-tasks/[id]/route.ts`
- Modify: `web/src/app/api/video-tasks/[id]/route.test.ts`
- Delete: `web/src/app/(user)/canvas/[id]/canvas-generation-review.ts`
- Delete: `web/src/app/(user)/canvas/[id]/canvas-generation-review.test.ts`
- Delete: `web/src/app/(user)/canvas/[id]/canvas-video-task-recovery.ts`
- Delete: `web/src/app/(user)/canvas/[id]/canvas-video-task-recovery.test.ts`
- Modify: `web/src/app/(user)/canvas/[id]/canvas-page-elements.tsx`
- Modify: `web/src/app/(user)/canvas/[id]/use-canvas-persistence-effects.tsx`
- Modify: `web/src/app/(user)/canvas/[id]/use-canvas-generation-actions.tsx`
- Modify: `web/src/app/(user)/canvas/[id]/use-canvas-node-media-actions.tsx`
- Modify: `web/src/app/(user)/canvas/components/canvas-node-content.tsx`
- Modify: `web/src/app/(user)/canvas/components/canvas-node.test.tsx`
- Modify: `web/src/app/(user)/canvas/types.ts`
- Modify: `web/src/lib/server/agent-run-execution.ts:1035-1060`

**Interfaces:**
- Produces: public task payloads without `needsReview` and `reviewReason`.
- Produces: Canvas node status `idle | success | loading | error | cancelled`.
- Consumes: ordinary terminal errors from task APIs.

- [ ] **Step 1: Change client and Canvas tests to terminal error behavior**

For each service test, return `{ status: "error", error: "上游创建结果无法确认" }` and assert the ordinary terminal error class/message. For Canvas, assert an uncertain video becomes an error node with retry behavior governed by `canRetry`, never a paused review node:

```ts
expect(markup).toContain("生成失败");
expect(markup).not.toContain("待人工确认");
```

- [ ] **Step 2: Run client/API/Canvas tests and verify RED**

Run:

```bash
cd web
pnpm exec vitest run src/services/api/text.test.ts src/services/api/image.test.ts src/services/api/audio.test.ts src/services/api/video.test.ts 'src/app/api/text-tasks/[id]/route.test.ts' 'src/app/api/image-tasks/[id]/route.test.ts' 'src/app/api/audio-tasks/[id]/route.test.ts' 'src/app/api/video-tasks/[id]/route.test.ts' 'src/app/(user)/canvas/components/canvas-node.test.tsx'
```

Expected: FAIL because review payloads, exception types and Canvas review nodes still exist.

- [ ] **Step 3: Remove public/client review contracts**

Delete review-only exception helpers and imports. Task routes always wake running tasks and return ordinary `status`, `error`, `canRetry`, and `executionPhase`. `pollTask()` treats `error` as `AgentChildTaskTerminalError`. Remove Canvas review constants, status, node renderer and pause/resume logic; use the existing error-node path.

- [ ] **Step 4: Run focused tests and typecheck**

Run the Step 2 command and `pnpm typecheck`. Expected: focused tests pass; remaining type errors identify only the admin takeover surface for Task 6.

- [ ] **Step 5: Commit public and Canvas cleanup**

```bash
git add -u -- web/src/services/api web/src/app/api/text-tasks 'web/src/app/api/image-tasks/[id]' web/src/app/api/audio-tasks web/src/app/api/video-tasks 'web/src/app/(user)/canvas' web/src/lib/server/agent-run-execution.ts
git commit -m "refactor(client): remove manual review task state"
```

### Task 5: Remove the administrator takeover feature

**Files:**
- Delete: `web/src/app/api/admin/generation-operations/[type]/[id]/review/route.ts`
- Delete: `web/src/app/api/admin/generation-operations/[type]/[id]/review/route.test.ts`
- Delete: `web/src/lib/server/generation-task-review-service.ts`
- Delete: `web/src/lib/server/generation-task-review-service.test.ts`
- Delete: `web/src/lib/server/generation-task-review-reason.ts`
- Delete: `web/src/lib/server/generation-task-review-reason.test.ts`
- Modify: `web/src/lib/admin-generation-operations.ts`
- Modify: `web/src/lib/server/generation-operations-service.ts`
- Modify: `web/src/lib/server/generation-operations-service.test.ts`
- Modify: `web/src/app/admin/generation-operations/components/generation-operations-client.tsx`
- Modify: `web/src/app/admin/generation-operations/components/generation-operation-task-details.tsx`
- Create: `web/src/app/admin/generation-operations/components/generation-operations-client.test.tsx`

**Interfaces:**
- Produces: `AdminGenerationTask` without `canReview`.
- Consumes: normal task status/error fields only.

- [ ] **Step 1: Write failing admin surface tests**

Update `generation-operations-service.test.ts` so a failed uncertain task maps to an ordinary failed item:

```ts
expect(result.items[0]).toMatchObject({
    status: "error",
    executionPhase: "completed",
    error: expect.stringContaining("无法确认"),
});
expect(result.items[0]).not.toHaveProperty("canReview");
```

Create `generation-operations-client.test.tsx` with a removal contract that fails while the UI exists:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation operations takeover removal", () => {
    it("does not expose the manual takeover action", () => {
        const source = readFileSync(new URL("./generation-operations-client.tsx", import.meta.url), "utf8");
        expect(source).not.toContain("接管待确认任务");
        expect(source).not.toContain("ShieldAlert");
    });
});
```

- [ ] **Step 2: Run admin tests and verify RED**

Run:

```bash
cd web
pnpm exec vitest run src/lib/server/generation-operations-service.test.ts src/app/admin/generation-operations/components/generation-operations-client.test.tsx
```

Expected: FAIL because `canReview`, the shield button and modal still exist.

- [ ] **Step 3: Delete takeover code and simplify UI**

Delete the route/services/tests listed above. Remove `Modal`, `ShieldAlert`, review state, handlers, review tag and review buttons from `generation-operations-client.tsx`. Always render `<StatusTag status={task.status} />`. Remove `needs_review` from `executionPhaseLabel()`.

- [ ] **Step 4: Run focused tests and typecheck**

Run the Step 2 command and `pnpm typecheck`. Expected: pass with no imports or routes referencing the deleted takeover code.

- [ ] **Step 5: Commit admin removal**

```bash
git add -u -- web/src/app/admin/generation-operations web/src/app/api/admin/generation-operations web/src/lib/admin-generation-operations.ts web/src/lib/server/generation-operations-service.ts web/src/lib/server/generation-operations-service.test.ts web/src/lib/server/generation-task-review-service.ts web/src/lib/server/generation-task-review-service.test.ts web/src/lib/server/generation-task-review-reason.ts web/src/lib/server/generation-task-review-reason.test.ts
git add -- web/src/app/admin/generation-operations/components/generation-operations-client.test.tsx
git commit -m "refactor(admin): remove generation task takeover"
```

### Task 6: Remove the core execution-phase contract

**Files:**
- Modify: `web/src/lib/server/generation-task-scheduler.ts:1-12,285-310`
- Modify: `web/src/lib/server/generation-task-store.ts:1020-1045`
- Modify: `web/src/lib/server/database/schema.ts:250-270`
- Modify: `web/src/lib/server/generation-task-store.test.ts:100-175`
- Create: `web/src/lib/server/database/schema-generation-task-phase.test.ts`

**Interfaces:**
- Produces: `GenerationTaskExecutionPhase` without `"needs_review"`.
- Produces: schema CHECK constraint accepting only active phases, Agent review phases and `completed`.
- Consumes: the terminal-failure runtime/API behavior from Tasks 1–5.

- [ ] **Step 1: Write failing state-contract tests**

Delete store tests that rely on legacy review records. Add this schema contract:

```ts
import { describe, expect, it } from "vitest";
import { POSTGRESQL_SCHEMA_SQL } from "./schema";

describe("generation task execution phase schema", () => {
    it("does not register the removed needs_review phase", () => {
        expect(POSTGRESQL_SCHEMA_SQL).not.toContain("'needs_review'");
    });
});
```

Add a `generation-task-store.test.ts` case that creates and round-trips a terminal uncertain task with `{ status: "error", executionPhase: "completed" }` and verifies it remains terminal.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd web
pnpm exec vitest run src/lib/server/database/schema-generation-task-phase.test.ts src/lib/server/generation-task-store.test.ts
```

Expected: the schema test fails because the CHECK constraint still contains `needs_review`.

- [ ] **Step 3: Remove the phase from production contracts**

Delete `"needs_review"` from `GenerationTaskExecutionPhase`, both phase guards, and the PostgreSQL CHECK list. Do not add fallback mapping:

```ts
export type GenerationTaskExecutionPhase =
    | "created"
    | "submitting"
    | "submitted"
    | "polling"
    | "result_ready"
    | "persisting"
    | "cancel_requested"
    | "cancel_polling"
    | "review_pending"
    | "reviewing"
    | "review_unavailable"
    | "completed";
```

- [ ] **Step 4: Run tests and typecheck**

Run the Step 2 command and `pnpm typecheck`. Expected: both pass because all generation-task consumers were normalized in Tasks 1–5.

- [ ] **Step 5: Commit the core contract**

```bash
git add web/src/lib/server/generation-task-scheduler.ts web/src/lib/server/generation-task-store.ts web/src/lib/server/database/schema.ts web/src/lib/server/generation-task-store.test.ts web/src/lib/server/database/schema-generation-task-phase.test.ts
git commit -m "refactor(generation): remove needs review phase contract"
```

### Task 7: Prove complete removal and run release gates

**Files:**
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Modify: `docs/content/docs/overview/production-readiness.mdx`
- Modify: `docs/content/docs/business/commercial-launch.mdx`
- Modify: `docs/content/docs/progress/todo.mdx`

**Interfaces:**
- Produces: documentation matching the terminal-failure state machine.
- Consumes: all behavior completed in Tasks 1–6.

- [ ] **Step 1: Add a removal scan as the final failing check**

Run:

```bash
rg -n 'needs_review|needsReview|GenerationTaskNeedsReview|canReview|接管待确认任务|待人工确认' web/src web/scripts
```

Expected before cleanup: matches remain in code/tests/docs covered by this plan.

- [ ] **Step 2: Update documentation and reject plan drift**

The code scan must already be empty after Tasks 1–6; if it is not, stop and move each matching file into the task that owns its runtime, client, admin or schema responsibility before continuing. In the four listed docs, replace manual-takeover guidance with: uncertain submission is terminally failed; Worker does not resubmit; the active hold is released; no consumption record is created.

- [ ] **Step 3: Verify the removal scan**

Run the Step 1 command. Expected: exit code 1 and no output for `web/src` or `web/scripts`.

- [ ] **Step 4: Run focused regression**

Run:

```bash
cd web
pnpm exec vitest run src/lib/server/usage-billing-runtime.test.ts src/lib/server/text-task-runtime.test.ts src/lib/server/image-task-runtime.test.ts src/lib/server/generation-task-recovery-service.test.ts src/lib/server/generation-operations-service.test.ts src/services/api/text.test.ts src/services/api/image.test.ts src/services/api/audio.test.ts src/services/api/video.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all pass with no warning/error output.

- [ ] **Step 5: Run full release gates**

Run in `web` with Node 22:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
node scripts/release-check.mjs
```

Run related Playwright coverage for 后台 → 生成运维 and Canvas at desktop, 390px and 430px using semantic clicks only. Confirm no shield action/modal, failed tasks remain readable, and no horizontal overflow.

- [ ] **Step 6: Check UTF-8 and mojibake**

Strictly decode changed text files as UTF-8 and scan for `�`, `锟斤拷`, `Ã`, and `Â`. Expected: no decode failure and no mojibake marker introduced by this change.

- [ ] **Step 7: Commit docs and final cleanup**

```bash
git add -- docs/content/docs/progress/pending-test.mdx docs/content/docs/overview/production-readiness.mdx docs/content/docs/business/commercial-launch.mdx docs/content/docs/progress/todo.mdx
git diff --cached --check
git commit -m "docs: update terminal generation failure guidance"
```
