import { afterEach, describe, expect, it, vi } from "vitest";
import * as control from "./text-task-stream-control";
import type { TextTask, TextTaskSnapshotUpdate } from "./text-task-store";

describe("text snapshot writer", () => {
    it("keeps one write in flight and flushes only the latest pending snapshot", async () => {
        let finish!: () => void;
        const blocked = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const contents: string[] = [];
        const revisions: number[] = [];
        const accepted: string[] = [];
        const writer = control.createTextSnapshotWriter(
            async (revision: number, update: TextTaskSnapshotUpdate) => {
                contents.push(update.content);
                revisions.push(revision);
                if (contents.length === 1) await blocked;
                return { visibleTextSnapshot: { attemptId: "attempt", revision: revision + 1, content: update.content, updatedAt: 1 } } as TextTask;
            },
            async (task: TextTask) => {
                accepted.push(task.visibleTextSnapshot!.content);
            },
        );
        writer.push({ content: "一" });
        writer.push({ content: "一二" });
        writer.push({ content: "一二三" });
        expect(contents).toEqual(["一"]);
        let flushed = false;
        const flush = writer.flush().then(() => {
            flushed = true;
        });
        await Promise.resolve();
        expect(flushed).toBe(false);
        finish();
        await flush;
        expect(contents).toEqual(["一", "一二三"]);
        expect(revisions).toEqual([0, 1]);
        expect(accepted).toEqual(["一", "一二三"]);
    });

    it("discards a stale attempt without publishing or treating CAS rejection as failure", async () => {
        const accepted: TextTask[] = [];
        const writer = control.createTextSnapshotWriter(
            async () => null,
            async (task: TextTask) => {
                accepted.push(task);
            },
        );
        writer.push({ content: "迟到" });
        await writer.flush();
        expect(accepted).toEqual([]);
    });

    it("flushes a snapshot queued while the previous drain is resolving", async () => {
        const contents: string[] = [];
        const writer = control.createTextSnapshotWriter(
            async (_revision, update) => {
                contents.push(update.content);
                return { visibleTextSnapshot: { content: update.content } } as TextTask;
            },
            (task) => {
                if (task.visibleTextSnapshot!.content === "一") queueMicrotask(() => queueMicrotask(() => writer.push({ content: "二" })));
            },
        );
        writer.push({ content: "一" });
        await writer.flush();
        expect(contents).toEqual(["一", "二"]);
    });
});

describe("attempt scoped cancellation and configured timeouts", () => {
    afterEach(() => vi.useRealTimers());

    it("shares the attempt registry across separately loaded route modules", async () => {
        const attempt = control.registerTextTaskAttempt("cross-route-task", "attempt", {}, true);
        try {
            vi.resetModules();
            const routeControl = await import("./text-task-stream-control");
            expect(routeControl.cancelTextTaskAttempt("cross-route-task", "attempt")).toBe(true);
            expect(attempt.signal.aborted).toBe(true);
        } finally {
            attempt.dispose();
        }
    });

    it("cancels only the identified attempt and unregisters it on dispose", () => {
        const one = control.registerTextTaskAttempt("task", "one", {}, true);
        const two = control.registerTextTaskAttempt("task", "two", {}, true);
        expect(control.cancelTextTaskAttempt("task", "one")).toBe(true);
        expect(one.signal.aborted).toBe(true);
        expect(two.signal.aborted).toBe(false);
        one.dispose();
        two.dispose();
        expect(control.cancelTextTaskAttempt("task", "two")).toBe(false);
    });

    it.each(["connect", "firstByte", "firstText", "idle", "overall"] as const)("enforces configured %s timeout", async (stage) => {
        vi.useFakeTimers();
        const attempt = control.registerTextTaskAttempt("task", stage, { [`${stage}TimeoutMs`]: 80 }, true);
        if (stage === "idle") attempt.byte();
        await vi.advanceTimersByTimeAsync(80);
        expect(attempt.signal.aborted).toBe(true);
        expect(attempt.signal.reason).toMatchObject({ name: "TimeoutError", stage });
        attempt.dispose();
    });

    it("clears reached stages, resets idle on bytes, and ignores streaming stages for Custom", async () => {
        vi.useFakeTimers();
        const streamed = control.registerTextTaskAttempt("task", "stream", { connectTimeoutMs: 20, firstByteTimeoutMs: 20, firstTextTimeoutMs: 20, idleTimeoutMs: 30 }, true);
        streamed.connected();
        streamed.byte();
        streamed.text();
        await vi.advanceTimersByTimeAsync(20);
        streamed.byte();
        await vi.advanceTimersByTimeAsync(20);
        expect(streamed.signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(10);
        expect(streamed.signal.reason).toMatchObject({ stage: "idle" });
        streamed.dispose();
        const buffered = control.registerTextTaskAttempt("task", "custom", { firstByteTimeoutMs: 1, firstTextTimeoutMs: 1, idleTimeoutMs: 1 }, false);
        buffered.byte();
        await vi.advanceTimersByTimeAsync(1000);
        expect(buffered.signal.aborted).toBe(false);
        buffered.dispose();
    });
});
