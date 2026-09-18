import type { TextTask, TextTaskSnapshotUpdate } from "./text-task-store";
import { structuredRootError, textStreamDiagnosticsEnabled } from "./text-stream-diagnostics";

export type TextTaskTimeoutPolicy = Partial<Record<`${"connect" | "firstByte" | "firstText" | "idle" | "overall"}TimeoutMs`, number>>;
export type TextTaskSnapshotHook = (task: TextTask) => void | Promise<void>;

export function createTextSnapshotWriter(write: (revision: number, update: TextTaskSnapshotUpdate) => Promise<TextTask | null>, onAccepted?: TextTaskSnapshotHook, initialRevision = 0) {
    let revision = initialRevision;
    let pending: TextTaskSnapshotUpdate | undefined;
    let inFlight: Promise<void> | undefined;
    let stopped = false;
    let failure: unknown;
    const drain = async () => {
        while (pending && !stopped) {
            const update = pending;
            pending = undefined;
            const accepted = await write(revision, update);
            if (!accepted) {
                stopped = true;
                pending = undefined;
                return;
            }
            revision += 1;
            if (update.content) await onAccepted?.(accepted);
        }
    };
    const start = () => {
        inFlight = drain()
            .catch((error) => {
                failure = error;
                stopped = true;
            })
            .finally(() => {
                inFlight = undefined;
                if (pending && !stopped) start();
            });
    };
    return {
        push(update: TextTaskSnapshotUpdate) {
            if (stopped) return;
            pending = update;
            if (!inFlight) start();
        },
        async flush() {
            while (inFlight) await inFlight;
            if (failure) throw failure;
        },
    };
}

type Stage = "connect" | "firstByte" | "firstText" | "idle" | "overall";
const registry = globalThis as typeof globalThis & { __vozebProTextTaskControllers?: Map<string, AbortController> };
const controllers = (registry.__vozebProTextTaskControllers ??= new Map<string, AbortController>());

export function registerTextTaskAttempt(taskId: string, attemptId: string, policy: TextTaskTimeoutPolicy, streaming: boolean, parentSignal?: AbortSignal, context?: { runId?: string; parentTaskId?: string }) {
    const key = `${taskId}\0${attemptId}`;
    const controller = new AbortController();
    const startedAt = Date.now();
    controllers.set(key, controller);
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    const timers = new Map<Stage, ReturnType<typeof setTimeout>>();
    if (context && textStreamDiagnosticsEnabled()) console.info("Text task timeout diagnostic", { ...context, taskId, attemptId, event: "registered", policy, streaming, parentSignalAttached: Boolean(parentSignal), registeredAt: startedAt });
    const reportAbort = (source: "timeout" | "cancellation" | "application" | "parent", reason: unknown) => {
        if (!context || !textStreamDiagnosticsEnabled()) return;
        const details = reason && typeof reason === "object" && !Array.isArray(reason) ? (reason as Record<string, unknown>) : undefined;
        console.warn("Text task abort diagnostic", {
            ...context,
            taskId,
            attemptId,
            source,
            ...(typeof details?.stage === "string" ? { stage: details.stage } : {}),
            ...(typeof details?.timeoutMs === "number" ? { timeoutMs: details.timeoutMs } : {}),
            elapsedMs: Date.now() - startedAt,
            reason: structuredRootError(reason),
        });
    };
    const onControllerAbort = () => {
        const reason = controller.signal.reason;
        const details = reason && typeof reason === "object" && !Array.isArray(reason) ? (reason as Record<string, unknown>) : undefined;
        reportAbort(typeof details?.stage === "string" ? "timeout" : reason instanceof Error && reason.name === "AbortError" ? "cancellation" : "application", reason);
    };
    const onParentAbort = () => reportAbort("parent", parentSignal?.reason);
    controller.signal.addEventListener("abort", onControllerAbort, { once: true });
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    if (parentSignal?.aborted) onParentAbort();
    const clear = (stage: Stage) => {
        clearTimeout(timers.get(stage));
        timers.delete(stage);
    };
    const arm = (stage: Stage) => {
        clear(stage);
        const ms = policy[`${stage}TimeoutMs`];
        if (!Number.isFinite(ms) || Number(ms) <= 0) return;
        const timer = setTimeout(() => controller.abort(Object.assign(new Error("文本模型响应超时"), { name: "TimeoutError", source: "text_task_runtime", stage, timeoutMs: ms, timedOutAt: Date.now() })), ms);
        timer.unref?.();
        timers.set(stage, timer);
    };
    arm("overall");
    arm("connect");
    if (streaming) {
        arm("firstByte");
        arm("firstText");
    }
    return {
        signal,
        connected: () => clear("connect"),
        byte() {
            if (streaming) {
                clear("firstByte");
                arm("idle");
            }
        },
        text: () => clear("firstText"),
        completed() {
            for (const stage of timers.keys()) clear(stage);
        },
        dispose() {
            for (const stage of timers.keys()) clear(stage);
            controller.signal.removeEventListener("abort", onControllerAbort);
            parentSignal?.removeEventListener("abort", onParentAbort);
            if (controllers.get(key) === controller) controllers.delete(key);
        },
    };
}

export function cancelTextTaskAttempt(taskId: string, attemptId: string) {
    const controller = controllers.get(`${taskId}\0${attemptId}`);
    if (!controller) return false;
    controller.abort(new DOMException("任务已取消", "AbortError"));
    return true;
}
