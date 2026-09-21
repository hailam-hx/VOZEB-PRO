import { createHash } from "node:crypto";

import { POST as createAudioTaskRequest } from "@/lib/server/audio-task-application";
import { GET as readAudioTaskRequest } from "@/app/api/audio-tasks/[id]/route";
import { POST as createImageTaskRequest } from "@/lib/server/image-task-application";
import { GET as readImageTaskRequest } from "@/app/api/image-tasks/[id]/route";
import { POST as createTextTaskRequest } from "@/lib/server/text-task-application";
import { GET as readTextTaskRequest } from "@/app/api/text-tasks/[id]/route";
import { POST as createVideoTaskRequest } from "@/lib/server/video-generation-application";
import { GET as readVideoTaskRequest } from "@/app/api/video-tasks/[id]/route";
import { agentTaskEntityId, bindDurableAgentToolCallGeneration, markDurableAgentToolCall, prepareDurableAgentToolCall } from "@/lib/server/agent-runtime-repository";
import type { AgentRunTask } from "@/lib/server/agent-run-store";

type GenerationType = AgentRunTask["type"];
type TaskPayload = { task?: { id?: string; status?: string; result?: unknown; error?: string } };

export class GenerationApplicationError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly outcome: "rejected" | "unknown" = "rejected",
        readonly errorCode?: string,
    ) {
        super(message);
    }
}

export async function createAgentGenerationTask(input: { type: GenerationType; origin: string; headers: HeadersInit; body: Record<string, unknown>; runId: string; planVersion: number; taskKey: string; idempotencyKey: string }) {
    const toolName = `${input.type}.generate`;
    const toolId = `agent-tool-${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 32)}`;
    const call = await prepareDurableAgentToolCall({
        id: toolId,
        runId: input.runId,
        taskId: agentTaskEntityId(`${input.runId}:plan:${input.planVersion}`, input.taskKey),
        toolName,
        idempotencyKey: input.idempotencyKey,
        input: input.body,
    });
    if (call.generationTaskId) return { task: { id: call.generationTaskId } } satisfies TaskPayload;
    if (call.status === "unknown") throw new GenerationApplicationError("生成请求的受理结果未知，等待人工或供应商对账", 409, "unknown");

    const request = new Request(`${input.origin}${createPath(input.type)}`, { method: "POST", headers: input.headers, body: JSON.stringify(input.body) });
    let response: Response;
    try {
        response = await createHandler(input.type)(request);
    } catch (error) {
        const message = error instanceof Error ? error.message : "生成任务创建结果未知";
        await markDurableAgentToolCall(call.id, "unknown", message);
        throw new GenerationApplicationError(message, 503, "unknown");
    }
    const payload = (await response.json().catch(() => ({}))) as TaskPayload & { error?: string; errorCode?: string };
    if (!response.ok) {
        const message = payload.error || "生成任务创建失败";
        await markDurableAgentToolCall(call.id, "failed", message);
        throw new GenerationApplicationError(message, response.status, "rejected", payload.errorCode);
    }
    const generationTaskId = payload.task?.id;
    if (!generationTaskId) {
        await markDurableAgentToolCall(call.id, "unknown", "生成任务未返回任务 ID");
        throw new GenerationApplicationError("生成任务未返回任务 ID", 502, "unknown");
    }
    await bindDurableAgentToolCallGeneration(call.id, generationTaskId);
    return payload;
}

export async function readAgentGenerationTask(input: { type: GenerationType; taskId: string; origin: string; headers: HeadersInit }) {
    const request = new Request(`${input.origin}${readPath(input.type, input.taskId)}`, { headers: input.headers });
    const response = await readHandler(input.type)(request, { params: Promise.resolve({ id: input.taskId }) });
    const payload = (await response.json().catch(() => ({}))) as TaskPayload & { error?: string; errorCode?: string };
    if (!response.ok) throw new GenerationApplicationError(payload.error || "生成任务查询失败", response.status, response.status >= 500 ? "unknown" : "rejected", payload.errorCode);
    return payload;
}

function createHandler(type: GenerationType): (request: Request) => Promise<Response> {
    return type === "image" ? createImageTaskRequest : type === "video" ? createVideoTaskRequest : type === "audio" ? createAudioTaskRequest : createTextTaskRequest;
}

function readHandler(type: GenerationType): (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> {
    return type === "image" ? readImageTaskRequest : type === "video" ? readVideoTaskRequest : type === "audio" ? readAudioTaskRequest : readTextTaskRequest;
}

function createPath(type: GenerationType) {
    return type === "video" ? "/api/video-generation-tasks" : `/api/${type}-tasks`;
}

function readPath(type: GenerationType, id: string) {
    return `/api/${type === "video" ? "video" : type}-tasks/${encodeURIComponent(id)}`;
}
