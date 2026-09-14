import type { TextTask, TextTaskSnapshotUpdate } from "./text-task-store";

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
const controllers = new Map<string, AbortController>();

export function registerTextTaskAttempt(taskId: string, attemptId: string, policy: TextTaskTimeoutPolicy, streaming: boolean, parentSignal?: AbortSignal) {
    const key = `${taskId}\0${attemptId}`;
    const controller = new AbortController();
    controllers.set(key, controller);
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    const timers = new Map<Stage, ReturnType<typeof setTimeout>>();
    const clear = (stage: Stage) => {
        clearTimeout(timers.get(stage));
        timers.delete(stage);
    };
    const arm = (stage: Stage) => {
        clear(stage);
        const ms = policy[`${stage}TimeoutMs`];
        if (!Number.isFinite(ms) || Number(ms) <= 0) return;
        const timer = setTimeout(() => controller.abort(Object.assign(new Error("文本模型响应超时"), { name: "TimeoutError", stage })), ms);
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
