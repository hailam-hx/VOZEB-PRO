import {
    isCreativeProjectHandoff,
    type CreativeAsset,
    type CreativeConversation,
    type CreativeConversationSource,
    type CreativeGenerationPreferences,
    type CreativeMessage,
    type CreativeProjectHandoff,
    type CreativeRunRequest,
} from "@/lib/creative-runtime-contract";
import { refreshUserPointsIfSystem } from "@/services/api/points";
import { ClientSessionExpiredError, stopIfClientSessionExpired, throwIfClientSessionExpired } from "@/services/api/session-expiration";
import type { VoiceSelection } from "@/lib/voice-selection";
import type { AppLocale } from "@/i18n/config";
import { agentRunCopy } from "@/lib/agent-run-copy";
import { createAgentTextTracker, type AgentTextState } from "@/lib/agent-text-stream";

export type CreativeAgentRun = {
    id: string;
    conversationId: string;
    inputMessageId: string;
    assistantMessageId: string;
    status: "planning" | "running" | "paused" | "completed" | "failed" | "cancelled";
    responseKind?: "conversation" | "generation";
    conversationReply?: string;
    surface?: CreativeRunRequest["surface"];
    projectId?: string;
    prompt?: string;
    referencedAssetIds?: string[];
    selectedSkillIds?: string[];
    requestedModelIds?: string[];
    generationPreferences?: CreativeGenerationPreferences;
    createdAt?: number;
    updatedAt?: number;
    assetIds: string[];
    tasks: Array<
        AgentTextState & {
            id: string;
            title: string;
            type?: "text" | "image" | "video" | "audio";
            model?: string;
            optimizedPrompt?: string;
            ratio?: string;
            quality?: string;
            seconds?: number;
            voice?: string;
            voiceSelection?: VoiceSelection;
            voiceName?: string;
            format?: string;
            generateAudio?: boolean;
            watermark?: boolean;
            speed?: number;
            count?: number;
            status: "ready" | "running" | "completed" | "failed" | "cancelled";
            error?: string;
        }
    >;
    cancellation?: { pendingCount: number };
};

type ApiResponse<T> = { code: number; data: T; msg: string };

export function listCreativeConversationPage(input: { surface?: CreativeConversation["surface"]; source?: CreativeConversationSource; projectId?: string; offset?: number; limit?: number } = {}) {
    const query = new URLSearchParams({ surface: input.surface || "chat", source: input.source || "agent", status: "active", limit: String(input.limit || 50), offset: String(input.offset || 0) });
    if (input.projectId) query.set("projectId", input.projectId);
    return request<{ conversations: CreativeConversation[]; hasMore: boolean }>(`/api/creative/conversations?${query}`);
}

export function listCreativeConversations(source: CreativeConversationSource = "agent") {
    return listCreativeConversationPage({ source, limit: 100 }).then((data) => data.conversations);
}

export function getCreativeConversation(conversationId: string) {
    return request<{ conversation: CreativeConversation }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}`).then((data) => data.conversation);
}

export function listCreativeMessages(conversationId: string, beforeSequence?: number, limit = 100) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (beforeSequence) query.set("beforeSequence", String(beforeSequence));
    return request<{ messages: CreativeMessage[] }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}/messages?${query}`).then((data) => data.messages);
}

export function listCreativeAssets(conversationId: string) {
    return request<{ assets: CreativeAsset[] }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}/assets`).then((data) => data.assets);
}

export function createCreativeConversation(input: { surface: "chat" | "canvas" | "drama"; source?: CreativeConversation["source"]; projectId?: string; title?: string }) {
    return request<{ conversation: CreativeConversation }>("/api/creative/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    }).then((data) => data.conversation);
}

export function uploadCreativeAsset(conversationId: string, file: File) {
    const body = new FormData();
    body.set("conversationId", conversationId);
    body.set("file", file);
    return request<{ asset: CreativeAsset }>("/api/creative/assets", { method: "POST", body }).then((data) => data.asset);
}

export function createCreativeAgentRun(input: CreativeRunRequest) {
    return request<{ run: CreativeAgentRun; conversation?: CreativeConversation; created: boolean }>("/api/agent/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export function controlCreativeAgentRun(runId: string, action: "cancel" | "pause" | "resume" | "retry", expectedConversationId?: string) {
    return request<{ run: CreativeAgentRun }>(`/api/agent/runs/${encodeURIComponent(runId)}/${action}`, {
        method: "POST",
        ...(expectedConversationId ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: expectedConversationId }) } : {}),
    });
}

export function getCreativeAgentRun(runId: string) {
    return request<{ run: CreativeAgentRun }>(`/api/agent/runs/${encodeURIComponent(runId)}`).then((data) => data.run);
}

export function listCreativeAgentRuns(surface: CreativeRunRequest["surface"] = "chat", input: { activeOnly?: boolean; limit?: number; projectId?: string; conversationId?: string } = {}) {
    const query = new URLSearchParams({ surface });
    if (input.activeOnly) query.set("status", "active");
    if (input.limit) query.set("limit", String(input.limit));
    if (input.projectId) query.set("projectId", input.projectId);
    if (input.conversationId) query.set("conversationId", input.conversationId);
    return request<{ runs: CreativeAgentRun[] }>(`/api/agent/runs?${query}`).then((data) => data.runs);
}

export function retryCreativeAgentTask(runId: string, taskId: string, expectedConversationId?: string) {
    return retryCreativeAgentTasks(runId, [taskId], expectedConversationId);
}

export function retryCreativeAgentTasks(runId: string, taskIds: string[], expectedConversationId?: string) {
    const [taskId] = taskIds;
    if (!taskId) return Promise.reject(new Error("请选择需要重试的失败任务"));
    return request<{ run: CreativeAgentRun }>(`/api/agent/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(expectedConversationId ? { conversationId: expectedConversationId } : {}), taskIds }),
    }).then((data) => data.run);
}

export function updateCreativeConversation(conversationId: string, patch: { title?: string; status?: CreativeConversation["status"] }) {
    return request<{ conversation: CreativeConversation }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    }).then((data) => data.conversation);
}

export function deleteCreativeConversations(conversationIds: string[]) {
    return request<{ deleted: number }>("/api/creative/conversations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: conversationIds }),
    });
}

type CreativeRunHandlers = {
    onProgress: (text: string) => void;
    onConversation?: (content: string) => void;
    onTerminal: (status: "completed" | "failed" | "cancelled", text?: string) => void;
    onConnectionError: (message: string) => void;
    onProjectHandoff?: (handoff: CreativeProjectHandoff) => void;
    onStatus?: (status: CreativeAgentRun["status"]) => void;
    onTaskCompleted?: (progress?: CreativeTaskProgress) => void;
    onTextTask?: (parentTaskId: string, state: AgentTextState) => void;
};

export type CreativeTaskProgress = {
    taskId?: string;
    title: string;
    completedCount: number;
    failedCount: number;
    totalCount: number;
};

export function watchCreativeAgentRun(runId: string, handlers: CreativeRunHandlers, locale: AppLocale = "zh-CN") {
    const copy = agentRunCopy(locale);
    const source = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
    let settled = false;
    let connectionInterrupted = false;
    let reconciliation: Promise<void> | null = null;
    let conversationContent = "";
    const textTasks = createAgentTextTracker(runId, handlers.onTextTask);
    const read = (event: Event) => {
        let parsed: { data?: Record<string, unknown>; status?: string; responseKind?: string; conversationReply?: string; tasks?: CreativeAgentRun["tasks"] };
        try {
            parsed = JSON.parse((event as MessageEvent<string>).data) as { data?: Record<string, unknown>; status?: string; responseKind?: string; conversationReply?: string };
        } catch {
            return null;
        }
        return parsed;
    };
    const finish = (status: "completed" | "failed" | "cancelled", text?: string) => {
        if (settled) return;
        settled = true;
        source.close();
        void refreshUserPointsIfSystem("system");
        handlers.onTerminal(status, conversationContent || text);
    };
    const publishConversation = (content?: string) => {
        const normalized = text(content);
        if (!normalized || normalized === conversationContent) return;
        conversationContent = normalized;
        if (handlers.onConversation) handlers.onConversation(normalized);
        else handlers.onProgress(normalized);
    };
    const publishStatus = (message: string) => {
        if (!conversationContent) handlers.onProgress(message);
    };
    const stopObservation = (message: string) => {
        if (settled) return;
        settled = true;
        source.close();
        handlers.onConnectionError(conversationContent ? "" : message);
    };
    const reconcileRun = async () => {
        if (await stopIfClientSessionExpired()) {
            stopObservation(copy.loginExpired);
            return;
        }
        try {
            const run = await getCreativeAgentRun(runId);
            if (settled) return;
            handlers.onStatus?.(run.status);
            textTasks.restore(run.tasks);
            publishConversation(run.conversationReply);
            if (run.status === "completed") return finish("completed", run.conversationReply);
            if (run.status === "failed") return finish("failed", run.conversationReply || run.tasks.find((task) => task.status === "failed")?.error || copy.failed);
            if (run.status === "cancelled") return finish("cancelled", copy.cancelled);
            publishStatus(run.status === "paused" ? copy.pausedInBackground : copy.runningInBackground);
        } catch (error) {
            if (settled) return;
            if (error instanceof ClientSessionExpiredError) {
                stopObservation(copy.loginExpired);
                return;
            }
            publishStatus(copy.unknownBackground);
        }
    };
    const listen = (type: string, callback: (payload: { data?: Record<string, unknown>; status?: string; responseKind?: string; conversationReply?: string; tasks?: CreativeAgentRun["tasks"] }) => void) =>
        source.addEventListener(type, (event) => {
            if (settled) return;
            const payload = read(event);
            if (payload) callback(payload);
        });

    listen("run.planning", () => publishStatus(copy.planning));
    listen("task.attempt.started", ({ data }) => textTasks.event(data, true));
    listen("task.text.updated", ({ data }) => textTasks.event(data));
    listen("skills.selected", () => publishStatus(copy.matching));
    listen("run.conversation.updated", ({ data }) => publishConversation(text(data?.content)));
    listen("run.planned", ({ data }) => {
        void refreshUserPointsIfSystem("system");
        publishStatus(text(data?.reply) || copy.finishing);
    });
    listen("task.running", ({ data }) => publishStatus(taskRunningText(text(data?.title), locale)));
    listen("task.waiting", ({ data }) => publishStatus(text(data?.error) || taskWaitingText(text(data?.title), locale)));
    listen("task.child.completed", ({ data }) => {
        void refreshUserPointsIfSystem("system");
        const progress = taskProgress(data, locale);
        publishStatus(taskProgressText(progress, locale));
        handlers.onTaskCompleted?.(progress);
    });
    listen("task.child.failed", ({ data }) => publishStatus(taskProgressText(taskProgress(data, locale), locale)));
    listen("task.completed", ({ data }) => {
        void refreshUserPointsIfSystem("system");
        publishStatus(text(data?.message) || taskCompletedText(text(data?.title), locale));
        handlers.onTaskCompleted?.();
    });
    listen("project.handoff", ({ data }) => {
        if (isCreativeProjectHandoff(data?.projectHandoff || data)) handlers.onProjectHandoff?.((data?.projectHandoff || data) as CreativeProjectHandoff);
    });
    listen("run.review.retry", () => publishStatus(copy.finishing));
    listen("run.review.passed", () => {
        void refreshUserPointsIfSystem("system");
        publishStatus(copy.finishing);
    });
    listen("run.review.unavailable", () => {
        void refreshUserPointsIfSystem("system");
        publishStatus(copy.finishing);
    });
    listen("run.cancel.requested", () => publishStatus(copy.cancelRequested));
    listen("run.cancel.pending", () => publishStatus(copy.cancelPending));
    listen("run.completed", ({ data }) => finish("completed", text(data?.reply)));
    listen("run.failed", ({ data }) => finish("failed", text(data?.message) || copy.failed));
    listen("run.cancelled", () => finish("cancelled", copy.cancelled));
    listen("run.snapshot", (payload) => {
        textTasks.restore(payload.tasks);
        if (payload.status && ["planning", "running", "paused", "completed", "failed", "cancelled"].includes(payload.status)) handlers.onStatus?.(payload.status as CreativeAgentRun["status"]);
        publishConversation(payload.conversationReply);
        if (payload.status === "completed") finish("completed", payload.conversationReply);
        if (payload.status === "failed") finish("failed", payload.conversationReply || copy.failed);
        if (payload.status === "cancelled") finish("cancelled", copy.cancelled);
        if (payload.status === "paused") publishStatus(copy.paused);
    });
    source.onopen = () => {
        if (connectionInterrupted && !settled) publishStatus(copy.restored);
        connectionInterrupted = false;
    };
    source.onerror = () => {
        if (settled) return;
        connectionInterrupted = true;
        publishStatus(copy.reconnecting);
        reconciliation ||= reconcileRun().finally(() => {
            reconciliation = null;
        });
    };
    return () => {
        settled = true;
        source.close();
    };
}

async function request<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, cache: "no-store" });
    throwIfClientSessionExpired(response);
    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !payload || payload.code !== 0) throw new Error(payload?.msg || "请求失败");
    return payload.data;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function taskProgress(data?: Record<string, unknown>, locale: AppLocale = "zh-CN"): CreativeTaskProgress {
    return {
        taskId: text(data?.taskId) || undefined,
        title: text(data?.title) || defaultTaskTitle(locale),
        completedCount: count(data?.completedCount),
        failedCount: count(data?.failedCount),
        totalCount: Math.max(1, count(data?.totalCount)),
    };
}

function taskProgressText(progress: CreativeTaskProgress, locale: AppLocale) {
    if (locale === "vi") return `“${progress.title}” đã hoàn tất ${progress.completedCount}/${progress.totalCount}${progress.failedCount ? `, thất bại ${progress.failedCount}` : ""}`;
    if (locale === "en") return `“${progress.title}” completed ${progress.completedCount}/${progress.totalCount}${progress.failedCount ? `, ${progress.failedCount} failed` : ""}`;
    return `「${progress.title}」已完成 ${progress.completedCount}/${progress.totalCount}${progress.failedCount ? `，失败 ${progress.failedCount}` : ""}`;
}

function defaultTaskTitle(locale: AppLocale) {
    return locale === "vi" ? "Tác vụ sáng tạo" : locale === "en" ? "Creative task" : "创作任务";
}

function taskRunningText(title: string, locale: AppLocale) {
    const taskTitle = title || defaultTaskTitle(locale);
    return locale === "vi" ? `Đang xử lý “${taskTitle}”` : locale === "en" ? `Processing “${taskTitle}”` : `正在处理「${taskTitle}」`;
}

function taskWaitingText(title: string, locale: AppLocale) {
    const taskTitle = title || defaultTaskTitle(locale);
    return locale === "vi"
        ? `“${taskTitle}” vẫn đang được xử lý ở upstream; hệ thống sẽ tiếp tục khôi phục`
        : locale === "en"
          ? `“${taskTitle}” is still processing upstream; the system will continue recovery`
          : `「${taskTitle}」仍在上游处理中，系统会继续恢复`;
}

function taskCompletedText(title: string, locale: AppLocale) {
    const taskTitle = title || defaultTaskTitle(locale);
    return locale === "vi" ? `“${taskTitle}” đã hoàn tất` : locale === "en" ? `“${taskTitle}” is complete` : `「${taskTitle}」已完成`;
}

function count(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
