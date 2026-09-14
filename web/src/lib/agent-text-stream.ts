export type AgentTextSnapshot = { attemptId: string; revision: number; content: string; status: "streaming" | "completed" | "failed" | "cancelled" };
export type AgentTextState = { activeAttemptId?: string; textRevision?: number; textStatus?: AgentTextSnapshot["status"]; visibleTextSnapshot?: AgentTextSnapshot };
export type AgentTextEvent = AgentTextSnapshot & { runId: string; taskId: string; parentTaskId: string };

export function agentTextStatusText(state: AgentTextState, fallback: string, locale?: AppLocale) {
    const copy = agentRunCopy(locale);
    const status = fallback === "cancelled" || fallback === "failed" ? fallback : state.textStatus || fallback;
    if (status === "failed") return copy.failed;
    if (status === "cancelled") return copy.cancelled;
    if (status === "completed") return "";
    return state.visibleTextSnapshot?.attemptId !== state.activeAttemptId ? copy.retryingTasks : copy.finishing;
}

export function applyAgentTextEvent<T extends AgentTextState>(state: T, value: unknown): T {
    if (!value || typeof value !== "object") return state;
    const event = value as AgentTextEvent;
    if (event.attemptId !== state.activeAttemptId || !Number.isSafeInteger(event.revision) || event.revision <= (state.textRevision ?? -1) || typeof event.content !== "string" || !["streaming", "completed", "failed", "cancelled"].includes(event.status))
        return state;
    const { attemptId, revision, content, status } = event;
    return { ...state, textRevision: revision, textStatus: status, ...(content ? { visibleTextSnapshot: { attemptId, revision, content, status } } : {}) };
}

export function createAgentTextTracker(runId: string, onChange?: (parentTaskId: string, state: AgentTextState) => void) {
    const states = new Map<string, AgentTextState>();
    const retired = new Map<string, Set<string>>();
    const publish = (id: string, next: AgentTextState) => {
        const current = states.get(id);
        if (next === current) return;
        if (current?.activeAttemptId && current.activeAttemptId !== next.activeAttemptId) {
            const ids = retired.get(id) || new Set<string>();
            ids.add(current.activeAttemptId);
            retired.set(id, ids);
        }
        states.set(id, next);
        onChange?.(id, next);
    };
    return {
        event(value: unknown, started = false) {
            if (!value || typeof value !== "object") return;
            const event = value as AgentTextEvent;
            if (event.runId !== runId || typeof event.parentTaskId !== "string" || typeof event.attemptId !== "string" || retired.get(event.parentTaskId)?.has(event.attemptId)) return;
            const current = states.get(event.parentTaskId);
            const base = !current || (started && current.activeAttemptId !== event.attemptId) ? { ...current, activeAttemptId: event.attemptId, textRevision: -1 } : current;
            const next = applyAgentTextEvent(base, event);
            if (next !== base) publish(event.parentTaskId, next);
        },
        restore(tasks?: Array<AgentTextState & { id: string; type?: string; status?: string }>) {
            for (const task of tasks || []) {
                if (task.type !== "text" || !task.activeAttemptId || retired.get(task.id)?.has(task.activeAttemptId)) continue;
                const current = states.get(task.id);
                if (current?.activeAttemptId === task.activeAttemptId && (current.textRevision ?? -1) >= (task.textRevision ?? -1)) continue;
                const { activeAttemptId, textRevision, visibleTextSnapshot } = task;
                const textStatus = task.textStatus || (task.status === "failed" || task.status === "cancelled" || task.status === "completed" ? task.status : "streaming");
                publish(task.id, { activeAttemptId, textRevision, textStatus, visibleTextSnapshot: visibleTextSnapshot || current?.visibleTextSnapshot });
            }
        },
    };
}
import { agentRunCopy } from "@/lib/agent-run-copy";
import type { AppLocale } from "@/i18n/config";
