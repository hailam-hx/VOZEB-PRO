import { refundUserPoints } from "@/lib/auth/store";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { fetchInternalApi, isInternalApiBaseUrl } from "@/lib/server/internal-origin";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { generationModelId } from "@/lib/server/generation-channel";
import { recordChannelRuntimeFailure, recordChannelRuntimeSuccess } from "@/lib/server/channel-runtime-health";
import { acceptTextTaskSnapshot, closeTextTaskAttempt, openTextTaskAttempt, getTextTask, transitionTextTask, type TextTask, type TextTaskConfig, type TextTaskSnapshotUpdate } from "@/lib/server/text-task-store";
import { updateTextTask } from "@/lib/server/text-task-store";
import type { AiTextMessage } from "@/types/ai";
import { hasSystemAiCharge, readSystemAiBilling, systemAiBillingHeaders, type SystemAiUsageContextDraft } from "@/lib/server/system-ai-billing";
import { generationSystemAiUsageContext } from "@/lib/server/generation-usage-context";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { buildProviderRequest, isProviderBusinessError, providerQueryPaths, readProviderString } from "@/lib/server/provider-task-config";
import { maintenanceWorkerContextHeaders } from "@/lib/server/maintenance-auth";
import { attachSystemAiUsageUpstreamTask, finishSystemAiTextAttempt, releaseUsageBillingForBusiness } from "@/lib/server/usage-billing-runtime";
import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError, generationSubmissionResponseError, generationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { resolveTextProtocol, type ResolvedTextProtocol } from "@/lib/server/text-protocol-resolver";
import { refundTextTask, textTaskRefundIdempotencyKey } from "@/lib/server/text-task-refund";
import { normalizeTextStream } from "@/lib/server/text-stream-protocol";
import { createTextSnapshotWriter, registerTextTaskAttempt, type TextTaskSnapshotHook, type TextTaskTimeoutPolicy } from "@/lib/server/text-task-stream-control";

configureServerProxyDispatcher();

const TEXT_RESULT_KEYS = ["output_text", "text", "content", "response", "result"];
const TASK_ID_KEYS = ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId"];
const TASK_STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
const FAILED_TASK_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired"]);
const PENDING_TASK_STATUSES = new Set(["", "pending", "queued", "running", "processing", "in_progress", "created", "submitted"]);

export type TextTaskStep = { state: "pending"; status: string; upstreamTaskId: string; createPath: string } | { state: "completed" } | { state: "failed"; error: string };

type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] };
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
};

type TextTaskRuntimeOptions = { onSnapshot?: TextTaskSnapshotHook; signal?: AbortSignal };
type AttemptRuntime = {
    control: ReturnType<typeof registerTextTaskAttempt>;
    writer: ReturnType<typeof createTextSnapshotWriter>;
    snapshot: TextTaskSnapshotUpdate;
    response?: Response;
    usagePayload?: unknown;
};

export async function runTextTaskStep(task: TextTask, origin: string, cookie: string, options: TextTaskRuntimeOptions = {}): Promise<TextTaskStep> {
    const current = await getTextTask(task.id);
    if (!current || current.status === "success") return { state: "completed" };
    if (current.status === "error" || current.status === "cancelled") return { state: "failed", error: current.error || "文本任务已结束" };
    const running = current.status === "pending" ? await transitionTextTask(current, ["pending"], { status: "running" }) : current;
    if (!running) return { state: "failed", error: "文本任务状态已变化" };
    if (running.upstream?.id) return queryCustomTextTaskStep(running, origin, cookie, options);

    const candidates = [running.config, ...(running.candidateConfigs || [])];
    let latestError = "没有可用的文本渠道";
    for (const [index, config] of candidates.entries()) {
        const protocol = resolveTextProtocol({ model: config.model, apiFormat: config.apiFormat, advancedConfig: config.advancedConfig, throughSystemProxy: config.baseUrl.startsWith("/"), preserveNativeProtocol: true });
        const candidateTask = await openTextTaskAttempt((await getTextTask(task.id)) || running, config, protocol.kind, candidates.slice(index + 1));
        if (!candidateTask) return { state: "failed", error: "文本任务状态已变化" };
        await scheduleGenerationTask("text", task.id, {
            executionPhase: "submitting",
            channelId: config.channelId,
            provider: config.advancedConfig?.protocol || config.apiFormat,
            queryPath: config.advancedConfig?.queryPath,
            nextPollAt: Date.now(),
            lastUpstreamStatus: "submitting",
        });
        const runtime = createAttemptRuntime(candidateTask, protocol.supportsStreaming, options);
        try {
            runtime.control.signal.throwIfAborted();
            const result = protocol.kind === "custom" ? await createCustomTextTaskStep(candidateTask, origin, cookie, protocol, runtime) : await runNativeTextTask(candidateTask, origin, cookie, protocol, runtime);
            runtime.control.completed();
            if ("state" in result) {
                const billing = hasSystemAiCharge(result) ? { pointsCost: result.pointsCost, pointsRecordId: result.pointsRecordId, refunded: false } : undefined;
                await updateTextTask(task.id, { upstream: { id: result.upstreamTaskId, createPath: result.createPath }, billing });
                runtime.writer.push(runtime.snapshot);
                await runtime.writer.flush();
                runtime.control.signal.throwIfAborted();
                return { state: "pending", status: result.status, upstreamTaskId: result.upstreamTaskId, createPath: result.createPath };
            }
            runtime.snapshot = { ...runtime.snapshot, content: result.content, milestones: { ...runtime.snapshot.milestones, stream_completed: Date.now() } };
            runtime.writer.push(runtime.snapshot);
            await runtime.writer.flush();
            runtime.control.signal.throwIfAborted();
            return await completeTextTask(candidateTask, result.content, result);
        } catch (error) {
            runtime.control.completed();
            runtime.writer.push(runtime.snapshot);
            await runtime.writer.flush();
            const reason = runtime.control.signal.aborted ? runtime.control.signal.reason : error;
            const message = publicTextError(reason);
            latestError = message;
            const latest = await getTextTask(task.id);
            if (latest?.activeAttemptId !== candidateTask.activeAttemptId || latest?.status === "success") return latest?.status === "success" ? { state: "completed" } : { state: "failed", error: "文本任务状态已变化" };
            const cancelled = latest?.status === "cancelled" || (runtime.control.signal.aborted && !isTextRequestTimeout(reason));
            if (cancelled) return await cancelRunningTextTask(latest || candidateTask, runtime.response?.headers);
            if (runtime.response) await finishSystemAiTextAttempt(runtime.response.headers, { status: "failed", reason: message, payload: runtime.usagePayload });
            await closeTextTaskAttempt(task.id, candidateTask.activeAttemptId!, "failed", { error: message }, activeRevision(latest));
            if (config.channelId) recordChannelRuntimeFailure(config.channelId, "text", message);
            // Once public text exists, a provider change would overwrite an answer the user has seen.
            if (runtime.snapshot.content || (!protocol.supportsStreaming && !(error instanceof GenerationSubmissionSafeFailure)) || (error instanceof GenerationSubmissionUncertainError && !isTextRequestTimeout(reason)))
                return failTextTask((await getTextTask(task.id)) || candidateTask, message);
        } finally {
            await runtime.response?.body?.cancel().catch(() => undefined);
            runtime.control.dispose();
        }
    }
    return failTextTask((await getTextTask(task.id)) || running, latestError);
}

function createAttemptRuntime(task: TextTask, streaming: boolean, options: TextTaskRuntimeOptions): AttemptRuntime {
    const profile = task.config.capabilityProfile as { timeoutMs?: number; streamingTimeouts?: { connectMs?: number; firstByteMs?: number; firstTextMs?: number; idleMs?: number } } | undefined;
    const timeouts = profile?.streamingTimeouts;
    const policy: TextTaskTimeoutPolicy = {
        connectTimeoutMs: timeouts?.connectMs,
        firstByteTimeoutMs: timeouts?.firstByteMs,
        firstTextTimeoutMs: timeouts?.firstTextMs,
        idleTimeoutMs: timeouts?.idleMs,
        overallTimeoutMs: profile?.timeoutMs || resolveModelRequestTimeoutMs(task.config, "text"),
    };
    const control = registerTextTaskAttempt(task.id, task.activeAttemptId!, policy, streaming, options.signal);
    const attempt = task.attempts?.find((item) => item.id === task.activeAttemptId);
    return {
        control,
        writer: createTextSnapshotWriter((revision, snapshot) => acceptTextTaskSnapshot(task.id, task.activeAttemptId!, revision, snapshot), options.onSnapshot, attempt?.revision || 0),
        snapshot: { content: "", milestones: { ...attempt?.milestones, upstream_started: attempt?.milestones.upstream_started ?? Date.now() } },
    };
}

async function runNativeTextTask(task: TextTask, origin: string, cookie: string, protocol: ResolvedTextProtocol, runtime: AttemptRuntime) {
    if (protocol.kind === "custom") throw new Error("文本流协议无效");
    const config = task.config;
    const headers = taskHeaders(config, cookie, pointsIdempotencyKey(task, protocol));
    headers.set("content-type", "application/json");
    headers.set("accept", "text/event-stream");
    const messages = withSystemMessage(config, task.messages);
    let body: Record<string, unknown>;
    if (protocol.kind === "responses") body = { model: config.model, input: toResponseInput(messages), stream: true };
    else if (protocol.kind === "gemini") body = toGeminiBody(config, task.messages);
    else if (protocol.kind === "claude") {
        const system = messages
            .filter((message) => message.role === "system")
            .map((message) => readMessageText(message.content))
            .join("\n\n");
        body = { model: config.model, max_tokens: requiredTextOutputLimit(config), messages: toChatMessages(messages.filter((message) => message.role !== "system")), stream: true, ...(system ? { system } : {}) };
        if (!config.baseUrl.startsWith("/")) {
            headers.delete("authorization");
            headers.set("x-api-key", config.apiKey);
            headers.set("anthropic-version", "2023-06-01");
        }
    } else body = { model: config.model, messages: toChatMessages(messages), stream: true, stream_options: { include_usage: true } };
    const url = new URL(taskUrl(config, protocol.path, origin, protocol.kind === "gemini" ? "gemini" : config.apiFormat));
    if (protocol.kind === "gemini") {
        url.pathname = url.pathname.replace(/:generateContent$/i, ":streamGenerateContent");
        url.searchParams.set("alt", "sse");
    }
    const response = await fetchTextAttempt(config, url.href, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" }, runtime);
    for await (const event of normalizeTextStream(response, protocol.kind)) {
        runtime.control.signal.throwIfAborted();
        if (event.type === "error") throw new GenerationSubmissionSafeFailure(event.message, event.status);
        if (event.type === "usage") {
            runtime.snapshot = { ...runtime.snapshot, usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens } };
        }
        if (event.type === "text_delta" && event.text) {
            runtime.control.text();
            runtime.snapshot = { ...runtime.snapshot, content: runtime.snapshot.content + event.text, milestones: { ...runtime.snapshot.milestones, first_text: runtime.snapshot.milestones?.first_text ?? Date.now() } };
            runtime.writer.push(runtime.snapshot);
        }
    }
    if (!runtime.snapshot.content.trim()) throw new GenerationSubmissionSafeFailure("文本模型没有返回有效内容");
    return { content: runtime.snapshot.content, ...readBilling(response.headers), usageHeaders: response.headers };
}

async function fetchTextAttempt(config: TextTaskConfig, url: string, init: RequestInit, runtime: AttemptRuntime) {
    const response = await submissionFetch(config, url, { ...init, signal: runtime.control.signal });
    runtime.control.connected();
    runtime.response = response;
    if (!response.body) return response;
    const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                if (chunk.byteLength) {
                    runtime.control.byte();
                    runtime.snapshot = { ...runtime.snapshot, milestones: { ...runtime.snapshot.milestones, first_byte: runtime.snapshot.milestones?.first_byte ?? Date.now() } };
                }
                controller.enqueue(chunk);
            },
        }),
        { signal: runtime.control.signal },
    );
    runtime.response = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    return runtime.response;
}

function publicTextError(error: unknown) {
    if (isTextRequestTimeout(error)) return "文本模型响应超时";
    return error instanceof GenerationSubmissionSafeFailure ? toSafeGenerationErrorMessage(error, "文本生成失败") : "文本生成中断，请重试";
}

async function createCustomTextTaskStep(task: TextTask, origin: string, cookie: string, protocol: ResolvedTextProtocol, runtime: AttemptRuntime) {
    const config = task.config;
    const createPath = protocol.path;
    const messages = toChatMessages(withSystemMessage(config, task.messages));
    const prompt = messages
        .filter((message) => message.role === "user")
        .map((message) => readMessageText(message.content))
        .filter(Boolean)
        .join("\n\n");
    const values = { model: config.model, prompt, input: prompt, text: prompt, messages };
    let payload: Record<string, unknown>;
    try {
        payload = buildProviderRequest(protocol.requestTemplate!, values, values);
    } catch (error) {
        throw new GenerationSubmissionSafeFailure(error instanceof Error ? error.message : "自定义文本请求模板无效");
    }
    const headers = taskHeaders(config, cookie, pointsIdempotencyKey(task, protocol));
    headers.set("content-type", "application/json");
    const response = await fetchTextAttempt(config, taskUrl(config, createPath, origin), { method: "POST", headers, body: JSON.stringify(payload), cache: "no-store" }, runtime);
    if (!response.ok) {
        const message = await readFetchError(response, "自定义文本接口调用失败");
        const responseError = generationSubmissionResponseError(response.status, message);
        if (responseError instanceof GenerationSubmissionUncertainError) await persistTextResponseBilling(task, response.headers);
        throw responseError;
    }
    const data = await parseTextSubmissionJson<unknown>(task, response);
    runtime.usagePayload = data;
    if (isProviderBusinessError(data)) {
        throw new GenerationSubmissionSafeFailure("自定义文本接口返回失败");
    }
    const content = readProviderString(data, protocol.resultField, TEXT_RESULT_KEYS);
    if (content) return { content, ...readBilling(response.headers), usageHeaders: response.headers, usagePayload: data };
    const taskId = readProviderString(data, undefined, TASK_ID_KEYS);
    if (taskId && config.advancedConfig?.queryPath) {
        await attachSystemAiUsageUpstreamTask(response.headers, taskId);
        return { state: "pending" as const, status: "submitted", upstreamTaskId: taskId, createPath, ...readBilling(response.headers) };
    }
    throw new GenerationSubmissionUncertainError("自定义文本接口没有按配置返回内容或任务 ID");
}

async function queryCustomTextTaskStep(task: TextTask, origin: string, cookie: string, options: TextTaskRuntimeOptions): Promise<TextTaskStep> {
    const config = task.config;
    const upstream = task.upstream;
    if (!upstream?.id) return failTextTask(task, "文本任务缺少上游任务 ID");
    const runtime = createAttemptRuntime(task, false, options);
    try {
        let lastError = "";
        for (const path of providerQueryPaths(config.advancedConfig, upstream.id, [])) {
            const response = await fetchTextAttempt(config, taskUrl(config, path, origin), { headers: taskHeaders(config, cookie), cache: "no-store" }, runtime);
            if (!response.ok) {
                lastError = await readFetchError(response, "自定义文本任务查询失败");
                continue;
            }
            const data = (await response.json().catch(() => null)) as unknown;
            runtime.control.signal.throwIfAborted();
            runtime.control.completed();
            if (!data || isProviderBusinessError(data)) return failTextTask(task, "自定义文本任务查询失败");
            const content = readProviderString(data, config.advancedConfig?.resultField, TEXT_RESULT_KEYS);
            if (content) {
                runtime.writer.push({ content, milestones: { ...runtime.snapshot.milestones, stream_completed: Date.now() } });
                await runtime.writer.flush();
                runtime.control.signal.throwIfAborted();
                return await completeTextTask(task, content, task.billing || {});
            }
            const status = readProviderString(data, config.advancedConfig?.statusField, TASK_STATUS_KEYS).toLowerCase();
            if (FAILED_TASK_STATUSES.has(status)) return failTextTask(task, "自定义文本任务执行失败");
            if (PENDING_TASK_STATUSES.has(status)) return { state: "pending", status: status || "processing", upstreamTaskId: upstream.id, createPath: upstream.createPath };
            return failTextTask(task, "自定义文本任务已结束但没有返回内容");
        }
        throw new Error(lastError || "自定义文本任务查询失败");
    } catch (error) {
        await runtime.writer.flush();
        if (runtime.control.signal.aborted && !isTextRequestTimeout(runtime.control.signal.reason)) return cancelRunningTextTask((await getTextTask(task.id)) || task, runtime.response?.headers);
        // An uncertain polling response cannot authorize a second upstream submission.
        throw error;
    } finally {
        await runtime.response?.body?.cancel().catch(() => undefined);
        runtime.control.dispose();
    }
}

export async function queryCancelledTextTaskUpstreamStep(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const upstream = task.upstream;
    if (!upstream?.id) return { state: "terminal" as const, status: "missing_upstream_id" };
    let lastError = "";
    for (const path of providerQueryPaths(config.advancedConfig, upstream.id, [])) {
        const response = await taskFetch(config, taskUrl(config, path, origin), { headers: taskHeaders(config, cookie), cache: "no-store" });
        if (!response.ok) {
            lastError = await readFetchError(response, "自定义文本任务查询失败");
            continue;
        }
        const data = (await response.json().catch(() => null)) as unknown;
        if (!data || isProviderBusinessError(data)) return { state: "terminal" as const, status: "failed" };
        if (readProviderString(data, config.advancedConfig?.resultField, TEXT_RESULT_KEYS)) return { state: "terminal" as const, status: "completed" };
        const status = readProviderString(data, config.advancedConfig?.statusField, TASK_STATUS_KEYS).toLowerCase();
        if (FAILED_TASK_STATUSES.has(status)) return { state: "terminal" as const, status };
        if (PENDING_TASK_STATUSES.has(status)) return { state: "pending" as const, status: status || "processing" };
        return { state: "terminal" as const, status: status || "completed" };
    }
    throw new Error(lastError || "自定义文本任务查询失败");
}

function readMessageText(content: AiTextMessage["content"]) {
    if (typeof content === "string") return content;
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

async function completeTextTask(task: TextTask, content: string, billing: { pointsRemaining?: number; pointsCost?: number; pointsRecordId?: string; usageHeaders?: Headers; usagePayload?: unknown }): Promise<TextTaskStep> {
    const current = await getTextTask(task.id);
    if (!current || current.status === "cancelled") {
        if (current?.status === "cancelled" && current.billing?.pointsRecordId) await refundTextTask(current);
        else if (hasSystemAiCharge(billing)) await refundUserPoints(task.userId, generationModelId(task.config), billing.pointsCost, "text", 1, textTaskRefundIdempotencyKey(task), billing.pointsRecordId);
        return current ? cancelRunningTextTask(current, billing.usageHeaders) : { state: "failed", error: "文本任务已取消" };
    }
    if (current.activeAttemptId !== task.activeAttemptId) return { state: "failed", error: "文本任务状态已变化" };
    const completed = await transitionTextTask(current, ["running"], {
        status: "success",
        result: { content: content || "没有返回内容" },
        pointsRemaining: billing.pointsRemaining,
        messages: [],
        config: clearSecret(current.config),
        billing: hasSystemAiCharge(billing) ? { pointsCost: billing.pointsCost, pointsRecordId: billing.pointsRecordId, refunded: false } : current.billing,
    });
    if (completed) {
        await closeTextTaskAttempt(task.id, task.activeAttemptId!, "succeeded", { pointsCost: billing.pointsCost, pointsRecordId: billing.pointsRecordId }, activeRevision(current));
        await updateTextTask(task.id, { config: clearSecret(current.config), candidateConfigs: [] });
        if (current.config.channelId) recordChannelRuntimeSuccess(current.config.channelId, "text");
    }
    if (!completed && hasSystemAiCharge(billing)) await refundUserPoints(task.userId, generationModelId(task.config), billing.pointsCost, "text", 1, textTaskRefundIdempotencyKey(task), billing.pointsRecordId);
    if (completed && billing.usageHeaders) await finishSystemAiTextAttempt(billing.usageHeaders, { status: "succeeded", payload: billing.usagePayload });
    return completed ? { state: "completed" } : { state: "failed", error: "文本任务状态已变化" };
}

async function failTextTask(task: TextTask, error: string): Promise<TextTaskStep> {
    const current = (await getTextTask(task.id)) || task;
    if (current.status === "success") return { state: "completed" };
    if (current.status === "cancelled") return { state: "failed", error: current.error || "文本任务已取消" };
    if (current.billing?.pointsRecordId && !current.billing.refunded) {
        await refundUserPoints(current.userId, generationModelId(current.config), current.billing.pointsCost, "text", 1, undefined, current.billing.pointsRecordId);
        await updateTextTask(current.id, { billing: { ...current.billing, refunded: true } });
    }
    const message = toSafeGenerationErrorMessage(error, "文本生成失败");
    if (current.activeAttemptId) await closeTextTaskAttempt(task.id, current.activeAttemptId, "failed", { error: message, pointsCost: current.billing?.pointsCost, pointsRecordId: current.billing?.pointsRecordId }, activeRevision(current));
    await transitionTextTask(current, ["pending", "running"], { status: "error", error: message, messages: [], config: clearSecret(current.config), billing: current.billing ? { ...current.billing, refunded: true } : undefined });
    await updateTextTask(current.id, { config: clearSecret(current.config), candidateConfigs: [] });
    await releaseUsageBillingForBusiness(current.userId, `text-task:${current.id}`, message);
    return { state: "failed", error: message };
}

export function markTextTaskFailed(task: TextTask, error: string) {
    return failTextTask(task, error);
}

async function cancelRunningTextTask(task: TextTask, headers?: Headers): Promise<TextTaskStep> {
    const cancelled = task.status === "cancelled" ? task : await transitionTextTask(task, ["pending", "running"], { status: "cancelled", error: "任务已取消", messages: [], config: clearSecret(task.config) });
    if (!cancelled) return { state: "failed", error: "文本任务状态已变化" };
    const closed = await closeTextTaskAttempt(task.id, task.activeAttemptId!, "cancelled", { error: "任务已取消" }, activeRevision(task));
    if (closed) {
        if (headers) await finishSystemAiTextAttempt(headers, { status: "canceled", reason: "任务已取消" });
        else await releaseUsageBillingForBusiness(task.userId, `text-task:${task.id}`, "任务已取消");
        await updateTextTask(task.id, { config: clearSecret(task.config), candidateConfigs: [] });
    }
    return { state: "failed", error: "任务已取消" };
}

function activeRevision(task: TextTask | null) {
    return task?.attempts?.find((attempt) => attempt.id === task.activeAttemptId)?.revision;
}

function clearSecret(config: TextTaskConfig): TextTaskConfig {
    return { ...config, apiKey: "" };
}

function withSystemMessage(config: TextTaskConfig, messages: AiTextMessage[]) {
    const systemPrompt = (config.systemPrompt || "").trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: AiTextMessage[]): ResponseInputItem[] {
    return messages.map((message) => ({ role: message.role, content: toResponseContent(message.content) }));
}

function toResponseContent(content: AiTextMessage["content"]): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toChatMessages(messages: AiTextMessage[]) {
    return messages.map((message) => ({ role: message.role, content: message.content }));
}

function toGeminiBody(config: TextTaskConfig, messages: AiTextMessage[]) {
    const systemText = [(config.systemPrompt || "").trim(), ...messages.flatMap((message) => (message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    return {
        contents: messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) })),
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    };
}

function toGeminiParts(content: AiTextMessage["content"]): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: AiTextMessage["content"]) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

async function readFetchError(response: Response, fallback: string) {
    await response.body?.cancel();
    return readStatusError(response.status, fallback);
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、账号权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}，状态码 ${status}` : fallback;
}

function taskUrl(config: TextTaskConfig, path: string, origin: string, apiFormat = config.apiFormat) {
    const apiBase = normalizeApiBaseUrl(config.baseUrl, apiFormat, origin);
    return `${apiBase}${path}`;
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", origin: string) {
    const absoluteBase = baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
    const normalized = absoluteBase.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (isInternalSystemProxyBase(normalized)) return normalized;
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function isInternalSystemProxyBase(value: string) {
    try {
        return /^\/api\/ai\/system\/[^/]+$/i.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

export function taskHeaders(config: TextTaskConfig, cookie: string, pointsIdempotencyKey?: string | SystemAiUsageContextDraft) {
    const headers = new Headers();
    const internal = config.baseUrl.startsWith("/");
    const workerHeaders = maintenanceWorkerContextHeaders(cookie);
    if (internal && workerHeaders) Object.entries(workerHeaders).forEach(([key, value]) => headers.set(key, value));
    else if (internal && cookie) headers.set("cookie", cookie);
    if (internal) {
        Object.entries(systemAiBillingHeaders(generationModelId(config), pointsIdempotencyKey, config.model)).forEach(([key, value]) => headers.set(key, value));
        if (typeof pointsIdempotencyKey === "object" && pointsIdempotencyKey.providerIdempotencyKey) {
            headers.set("Idempotency-Key", pointsIdempotencyKey.providerIdempotencyKey);
            headers.set("X-Client-Request-Id", pointsIdempotencyKey.providerIdempotencyKey);
        }
    }
    if (!internal && config.apiFormat === "gemini") headers.set("x-goog-api-key", config.apiKey);
    else if (!internal) headers.set("authorization", `Bearer ${config.apiKey}`);
    return headers;
}

function taskFetch(config: TextTaskConfig, url: string, init: RequestInit) {
    const nextInit = {
        ...init,
        signal: init.signal || AbortSignal.timeout(resolveModelRequestTimeoutMs(config, "text")),
    };
    return isInternalApiBaseUrl(config.baseUrl) ? fetchInternalApi(url, nextInit) : fetchSafeOutbound(url, nextInit);
}

async function submissionFetch(config: TextTaskConfig, url: string, init: RequestInit) {
    try {
        return await taskFetch(config, url, init);
    } catch (error) {
        if (isTextRequestTimeout(error)) throw new GenerationSubmissionSafeFailure("文本模型响应超时，正在切换备用模型", 504);
        throw generationSubmissionUncertainError(error, toSafeGenerationErrorMessage(error, "文本任务创建结果未知"));
    }
}

function isTextRequestTimeout(error: unknown) {
    if (!(error instanceof Error)) return false;
    return error.name === "TimeoutError" || /timeout|timed out|aborted due to timeout/i.test(error.message);
}

async function parseTextSubmissionJson<T>(task: TextTask, response: Response): Promise<T> {
    try {
        return (await response.json()) as T;
    } catch {
        await persistTextResponseBilling(task, response.headers);
        throw new GenerationSubmissionUncertainError("文本接口响应不是有效 JSON");
    }
}

async function persistTextResponseBilling(task: TextTask, headers: Headers) {
    const billing = readSystemAiBilling(headers);
    if (hasSystemAiCharge(billing)) await updateTextTask(task.id, { billing: { pointsCost: billing.pointsCost, pointsRecordId: billing.pointsRecordId, refunded: false } });
}

function pointsIdempotencyKey(task: TextTask, protocol: ResolvedTextProtocol) {
    const providerKey = `text-task:${task.id}:attempt:${task.attemptNo || 1}:${protocol.kind}`;
    return generationSystemAiUsageContext(task.config, "text", providerKey, task.userId) || providerKey;
}

function requiredTextOutputLimit(config: TextTaskConfig) {
    const limit = config.capabilityProfile?.maxOutputTokens;
    if (!Number.isSafeInteger(limit) || Number(limit) < 1) throw new GenerationSubmissionSafeFailure("文本模型缺少最大输出 token 配置");
    return limit;
}

function readPointsRemaining(headers: Headers) {
    const value = Number(headers.get("x-vozeb-pro-points-remaining"));
    return Number.isFinite(value) ? value : undefined;
}

function readBilling(headers: Headers) {
    return {
        pointsRemaining: readPointsRemaining(headers),
        ...readSystemAiBilling(headers),
    };
}
