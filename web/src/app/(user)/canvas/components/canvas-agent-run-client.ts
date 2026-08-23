import type { CanvasAgentOp } from "../utils/canvas-agent-ops";
import type { CanvasAgentRunStage, CanvasAgentStableStageKey } from "./canvas-agent-progress";
import { getCreativeAgentRun } from "@/services/api/creative";
import { ClientSessionExpiredError, stopIfClientSessionExpired } from "@/services/api/session-expiration";

type RunHandlers = {
    onPlan: (ops: CanvasAgentOp[], reply: string) => void;
    onAssistant: (text: string, detail?: { nodeIds?: string[]; taskType?: "text" | "image" | "video" | "audio"; runId?: string; taskId?: string; title?: string }) => void;
    onStage: (stage: CanvasAgentRunStage) => void;
    onPaused: (paused: boolean) => void;
    onOps: (ops: CanvasAgentOp[]) => void;
};

export type CanvasAgentRunTranslate = (key: string, values?: Record<string, string | number>) => string;

export function watchCanvasAgentRun(runId: string, handlers: RunHandlers, options: { signal?: AbortSignal; translate?: CanvasAgentRunTranslate } = {}) {
    if (options.signal?.aborted) return Promise.resolve();
    const t = options.translate || defaultCanvasAgentRunTranslate;
    return new Promise<void>((resolve, reject) => {
        const stream = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
        let appliedPlan = false;
        let connectionInterrupted = false;
        let reconciliation: Promise<void> | null = null;
        let settled = false;
        let paused: boolean | undefined;
        let latestStageKey: CanvasAgentStableStageKey = "planning";
        let latestOutput: { nodeIds?: string[]; taskType?: "text" | "image" | "video" | "audio" } | undefined;
        const completedOutputNodeIds = new Set<string>();
        let latestFailedTask: { taskId: string; title?: string } | undefined;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            stream.close();
            options.signal?.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve();
        };
        const abort = () => finish();
        options.signal?.addEventListener("abort", abort, { once: true });
        const listen = (type: string, listener: (event: Event) => void) =>
            stream.addEventListener(type, (event) => {
                if (!settled) listener(event);
            });
        const read = <T>(event: Event) => JSON.parse((event as MessageEvent<string>).data) as T;
        const setPaused = (value: boolean) => {
            if (paused === value) return;
            paused = value;
            handlers.onPaused(value);
        };
        const reportStage = (stage: CanvasAgentRunStage) => {
            if (stage.key !== "reconnecting") latestStageKey = stage.key;
            handlers.onStage(stage);
        };
        const reconcileRun = async () => {
            if (await stopIfClientSessionExpired()) {
                reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: t("sessionExpired") });
                finish();
                return;
            }
            try {
                const run = await getCreativeAgentRun(runId);
                if (settled) return;
                if (run.status === "completed") {
                    handlers.onAssistant(t("runCompleted"), latestOutput);
                    finish();
                    return;
                }
                if (run.status === "cancelled") {
                    handlers.onAssistant(t("runCancelled"));
                    finish();
                    return;
                }
                if (run.status === "failed") {
                    const failed = run.tasks.find((task) => task.status === "failed");
                    if (!latestFailedTask && failed) handlers.onAssistant(t("taskFailed", { title: failed.title || t("taskName") }), { runId, taskId: failed.id, title: failed.title || t("taskFailedTitle") });
                    else if (!latestFailedTask) handlers.onAssistant(t("agentFailed"), { runId, title: t("agentFailed") });
                    finish();
                    return;
                }
                setPaused(run.status === "paused");
                reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: t(run.status === "paused" ? "pausedReconnect" : "runningReconnect") });
            } catch (error) {
                if (settled) return;
                if (error instanceof ClientSessionExpiredError) {
                    reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: t("sessionExpired") });
                    finish();
                    return;
                }
                reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: t("statusUnavailable") });
            }
        };

        listen("run.planning", () => reportStage({ key: "planning", text: t("planning") }));
        listen("skills.selected", () => reportStage({ key: "skills", text: t("skills") }));
        listen("canvas.ops", (event) => {
            const payload = read<{ data?: { ops?: CanvasAgentOp[]; reply?: string } }>(event);
            if (!appliedPlan && payload.data?.ops?.length) {
                appliedPlan = true;
                handlers.onPlan(payload.data.ops, payload.data.reply || t("planAdded"));
            }
            reportStage({ key: "plan", text: t("planReady") });
        });
        listen("task.running", (event) => {
            const payload = read<{ data?: { title?: string; attempts?: number; ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            reportStage({ key: "executing", text: t(payload.data?.attempts ? "executingAttempt" : "executing", { title: payload.data?.title || t("taskName"), attempts: payload.data?.attempts || 1 }) });
        });
        listen("task.created", (event) => {
            const payload = read<{ data?: { ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
        });
        listen("task.child.completed", (event) => {
            const payload = read<{ data?: ChildTaskEventData }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            for (const nodeId of payload.data?.outputNodeIds || []) completedOutputNodeIds.add(nodeId);
            latestOutput = { nodeIds: Array.from(completedOutputNodeIds), taskType: payload.data?.type };
            const progress = childProgressText(payload.data, t);
            reportStage({ key: "executing", text: progress });
            handlers.onAssistant(progress, latestOutput);
        });
        listen("task.child.failed", (event) => {
            const payload = read<{ data?: ChildTaskEventData }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            const progress = childProgressText(payload.data, t);
            reportStage({ key: "executing", text: progress });
            handlers.onAssistant(progress, latestOutput);
        });
        listen("task.completed", (event) => {
            const payload = read<{ data?: { message?: string; title?: string; outputNodeIds?: string[]; type?: "text" | "image" | "video" | "audio"; ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            latestOutput = { nodeIds: payload.data?.outputNodeIds, taskType: payload.data?.type };
            handlers.onAssistant(payload.data?.message || t("taskCompleted", { title: payload.data?.title || t("taskName") }), latestOutput);
        });
        listen("task.failed", (event) => {
            const payload = read<{ data?: { taskId?: string; title?: string; error?: string; ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            if (!payload.data?.taskId) return;
            latestFailedTask = { taskId: payload.data.taskId, title: payload.data.title };
            handlers.onAssistant(t("taskFailed", { title: payload.data.title || t("taskName") }), { taskType: undefined, nodeIds: [], ...latestFailedTask, runId });
        });
        listen("task.retry.requested", (event) => {
            const payload = read<{ data?: { ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
        });
        listen("run.review.retry", () => reportStage({ key: "reviewing", text: t("reviewRetry") }));
        listen("run.review.passed", () => reportStage({ key: "finalizing", text: t("finalizing") }));
        listen("run.review.unavailable", () => reportStage({ key: "finalizing", text: t("reviewUnavailable") }));
        listen("run.completed", (event) => {
            const payload = read<{ data?: { reply?: string } }>(event);
            handlers.onAssistant(payload.data?.reply || t("runAllCompleted"), latestOutput);
            finish();
        });
        listen("run.failed", (event) => {
            if (!latestFailedTask) handlers.onAssistant(t("agentFailed"), { runId, title: t("agentFailed") });
            finish();
        });
        listen("run.cancelled", (event) => {
            const payload = read<{ data?: { ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            handlers.onAssistant(t("runCancelled"));
            finish();
        });
        listen("run.paused", () => {
            setPaused(true);
            reportStage({ key: "paused", text: t("paused") });
        });
        listen("run.resumed", () => {
            setPaused(false);
            reportStage({ key: "executing", text: t("resumed") });
        });
        listen("run.snapshot", (event) => {
            const payload = read<{ status?: string; tasks?: Array<{ id?: string; title?: string; status?: string; error?: string }> }>(event);
            if (payload.status === "cancelled") {
                handlers.onAssistant(t("runCancelled"));
                finish();
            }
            if (payload.status === "completed") {
                handlers.onAssistant(t("runCompleted"));
                finish();
            }
            if (payload.status === "failed") {
                const failed = payload.tasks?.find((task) => task.status === "failed" && task.id);
                if (!latestFailedTask && failed?.id) handlers.onAssistant(t("taskFailed", { title: failed.title || t("taskName") }), { runId, taskId: failed.id, title: failed.title || t("taskFailedTitle") });
                else if (!latestFailedTask) handlers.onAssistant(t("agentFailed"), { runId, title: t("agentFailed") });
                finish();
            }
            if (payload.status === "paused") setPaused(true);
            if (payload.status === "planning" || payload.status === "running") setPaused(false);
        });
        stream.onopen = () => {
            if (connectionInterrupted && !settled) reportStage({ key: latestStageKey, text: t("connectionRestored") });
            connectionInterrupted = false;
        };
        stream.onerror = () => {
            if (settled) return;
            connectionInterrupted = true;
            reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: t("connectionInterrupted") });
            reconciliation ||= reconcileRun().finally(() => {
                reconciliation = null;
            });
        };
    });
}

type ChildTaskEventData = {
    title?: string;
    type?: "text" | "image" | "video" | "audio";
    completedCount?: number;
    failedCount?: number;
    totalCount?: number;
    outputNodeIds?: string[];
    ops?: CanvasAgentOp[];
};

function childProgressText(data: ChildTaskEventData | undefined, t: CanvasAgentRunTranslate) {
    const completed = nonNegativeCount(data?.completedCount);
    const failed = nonNegativeCount(data?.failedCount);
    const total = Math.max(1, nonNegativeCount(data?.totalCount));
    return t(failed ? "childProgressFailed" : "childProgress", { title: data?.title || t("taskName"), completed, total, failed });
}

function defaultCanvasAgentRunTranslate(key: string, values: Record<string, string | number> = {}) {
    const title = String(values.title || "Creative task");
    const copy: Record<string, string> = {
        sessionExpired: "Your session expired. The task may still be running in the background; sign in again to continue.",
        runCompleted: "The Agent task is complete and the results are ready.",
        runCancelled: "The Agent task was cancelled.",
        taskName: "Creative task",
        taskFailedTitle: "Creative task failed",
        taskFailed: `${title} failed. Please try again later.`,
        agentFailed: "Agent failed. Please try again later.",
        pausedReconnect: "The task is saved in the background and is currently paused.",
        runningReconnect: "The task is still running in the background. Reconnecting…",
        statusUnavailable: "Live status is temporarily unavailable. The task will continue in the background.",
        planning: "Understanding the request and reviewing the Canvas",
        skills: "Selecting suitable creative skills",
        planAdded: "The creative plan was added to the Canvas and is running in the background.",
        planReady: "The execution plan is ready. Preparing tasks…",
        executing: `Running ${title}`,
        executingAttempt: `Running ${title} (attempt ${values.attempts || 1})`,
        taskCompleted: `${title} is complete. Continuing…`,
        reviewRetry: "Improvements were found. Generating again…",
        finalizing: "Review complete. Preparing results…",
        reviewUnavailable: "Preparing completed results…",
        runAllCompleted: "The creative plan and background tasks are complete.",
        paused: "Task paused",
        resumed: "Task resumed and is continuing",
        connectionRestored: "Connection restored. The task is continuing.",
        connectionInterrupted: "Connection interrupted. Checking the background task status…",
        childProgress: `${title}: ${values.completed || 0}/${values.total || 1} complete`,
        childProgressFailed: `${title}: ${values.completed || 0}/${values.total || 1} complete, ${values.failed || 0} failed`,
    };
    return copy[key] || key;
}

function nonNegativeCount(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
