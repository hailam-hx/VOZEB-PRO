import { describe, expect, it } from "vitest";

import { publicAgentRun, publicAgentRunEvent } from "./agent-run-public";
import { AGENT_PLAN_SCHEMA_VERSION } from "./agent-run-audit";

describe("publicAgentRun", () => {
    it("never includes an unknown upstream diagnostic in a public task", () => {
        const raw = "Authorization: Bearer provider-secret; SQL SELECT * FROM users at /srv/private/provider.ts";
        const run = publicAgentRun({
            id: "unsafe-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "生成语音",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "audio", title: "语音", type: "audio", prompt: "生成语音", count: 1, dependencies: [], status: "failed", attempts: 1, error: raw }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run.tasks[0]).toMatchObject({ error: "生成任务失败" });
        expect(JSON.stringify(run)).not.toContain("provider-secret");
        const event = publicAgentRunEvent({ id: "unsafe-event", runId: "unsafe-run", type: "task.failed", data: { taskId: "audio", error: raw, providerResponse: { authorization: "provider-secret" } }, createdAt: 2 });
        expect(JSON.stringify(event)).not.toContain("provider-secret");
        const waiting = publicAgentRunEvent({ id: "waiting-event", runId: "unsafe-run", type: "task.waiting", data: { taskId: "audio", error: raw }, createdAt: 2 });
        expect(JSON.stringify(waiting)).not.toContain("provider-secret");
    });

    it("classifies insufficient balance as permanent without exposing billing diagnostics", () => {
        const run = publicAgentRun({
            id: "balance-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "生成图片",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "image", title: "图片", type: "image", prompt: "生成图片", count: 1, dependencies: [], status: "failed", attempts: 1, error: "积分不足；ledger /srv/private/billing.ts" }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run.tasks[0]).toMatchObject({ errorCode: "INSUFFICIENT_BALANCE", retryable: false });
        expect(JSON.stringify(run)).not.toContain("/srv/private");
    });

    it("marks a planning failure caused by insufficient balance as non-retryable", () => {
        const run = publicAgentRun({
            id: "planner-balance",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "生成视频",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [],
            plannerFailure: { message: "积分不足；ledger /srv/private/billing.ts", failedAt: 2 },
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run).toMatchObject({ failure: { errorCode: "INSUFFICIENT_BALANCE", retryable: false } });
        expect(JSON.stringify(run)).not.toContain("/srv/private");
    });
    it("classifies planner timeouts without exposing diagnostics", () => {
        const run = publicAgentRun({
            id: "planner-timeout",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "生成语音",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [],
            plannerFailure: { message: "provider timeout; Bearer private-token at /srv/private/planner.ts", failedAt: 2 },
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run).toMatchObject({ failure: { errorCode: "REQUEST_TIMEOUT", retryable: true } });
        expect(JSON.stringify(run)).not.toContain("private-token");
    });
    it("publishes a missing text output limit as a configuration error without leaking planner diagnostics", () => {
        const run = publicAgentRun({
            id: "planner-output-limit",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "你好",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [],
            plannerFailure: { message: "文本预留缺少可证明的最大输出 token; Bearer private-token", failedAt: 2 },
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run).toMatchObject({ failure: { errorCode: "TEXT_OUTPUT_LIMIT_UNCONFIGURED", retryable: false } });
        expect(JSON.stringify(run)).not.toContain("private-token");
    });
    it.each([
        ["reference_url_not_public", "REFERENCE_ASSET_UNAVAILABLE", false],
        ["INVALID_ASSET", "INVALID_ASSET", false],
        ["UNSUPPORTED_CAPABILITY", "UNSUPPORTED_CAPABILITY", false],
        ["UPSTREAM_BAD_REQUEST", "UPSTREAM_BAD_REQUEST", false],
        ["RATE_LIMIT", "RATE_LIMIT", true],
        ["UPSTREAM_UNAVAILABLE", "UPSTREAM_UNAVAILABLE", true],
        ["NETWORK_ERROR", "NETWORK_ERROR", true],
    ] as const)("publishes %s as %s with retryable=%s", (errorCode, expectedCode, retryable) => {
        const run = publicAgentRun({
            id: "failure-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "生成语音",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "audio", title: "语音", type: "audio", prompt: "生成语音", count: 1, dependencies: [], status: "failed", attempts: 1, errorCode, error: "provider Bearer private-token at /srv/private/provider.ts" }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run.tasks[0]).toMatchObject({ errorCode: expectedCode, retryable });
        expect(JSON.stringify(run)).not.toContain("private-token");
        expect(JSON.stringify(run)).not.toContain("/srv/private");
    });
    it("keeps a permanent submission outcome non-retryable even when its diagnostic mentions a timeout", () => {
        const run = publicAgentRun({
            id: "unknown-submit",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "生成图片",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "image", title: "图片", type: "image", prompt: "生成图片", count: 1, dependencies: [], status: "failed", attempts: 1, errorCode: "SUBMISSION_UNKNOWN", error: "provider timeout with unknown billing outcome" }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        expect(run.tasks[0]).toMatchObject({ errorCode: "SUBMISSION_UNKNOWN", retryable: false });
    });
    it("exposes only user-facing Run and task fields", () => {
        const publicRun = publicAgentRun({
            id: "run",
            userId: "user-secret",
            conversationId: "conversation",
            clientRequestId: "request-secret",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "@图片1 用户原始需求",
            publicPrompt: "图片1 用户原始需求",
            snapshot: { private: true },
            referencedAssetIds: ["asset-one"],
            selectedSkillIds: ["skill-one"],
            requestedModelIds: ["video-pro"],
            assetIds: ["result-one"],
            status: "failed",
            executionId: "execution-secret",
            tasks: [
                {
                    id: "video",
                    title: "视频",
                    type: "video",
                    model: "video-pro",
                    prompt: "电影感海边日落运镜，人物动作自然流畅\n\n统一创作约束：\n内部执行提示词-secret",
                    count: 1,
                    ratio: "16:9",
                    quality: "2160",
                    seconds: 60,
                    generateAudio: false,
                    watermark: true,
                    dependencies: [],
                    status: "failed",
                    attempts: 1,
                    taskId: "child-secret",
                    childTasks: [{ id: "child-secret", status: "failed", attempt: 1, result: { raw: "secret" } }],
                    result: { raw: "secret" },
                    error: "The request failed because content[1] is restricted. Request id: private-request-id",
                    errorCode: "video_input_copyright_restricted",
                },
            ],
            foundation: { complexity: "simple", brief: { objective: "secret" }, direction: { summary: "secret" } },
            plannerAudit: {
                schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
                mode: "model",
                logicalModelId: "planner-secret",
                channelId: "channel-secret",
                upstreamModel: "upstream-secret",
                protocol: "chat",
                pointsCost: 2,
                skills: [
                    {
                        id: "skill-one",
                        name: "Skill",
                        description: "secret-skill-description",
                        plannerSummary: "secret-skill-summary",
                        instructions: "secret-skill-instructions",
                        enabled: true,
                        keywords: ["secret-keyword"],
                        workspaces: ["image"],
                        action: "generate",
                        requiresReference: false,
                        defaultConfig: { quality: "secret-quality" },
                        sourceCommit: "commit-secret",
                    },
                ],
            },
            planningCycle: 2,
            plannerAttempts: [
                {
                    attemptNo: 2,
                    planningCycle: 2,
                    logicalModelId: "planner-attempt-secret",
                    channelId: "channel-attempt-secret",
                    upstreamModel: "upstream-attempt-secret",
                    protocol: "chat",
                    status: "failed",
                    requestAcceptance: "response",
                    startedAt: 1,
                    completedAt: 2,
                    elapsedMs: 1,
                    error: "planner-error-secret",
                },
            ],
            plannerFailure: { message: "planner-failure-secret", failedAt: 2 },
            review: { mode: "visual", status: "needs_revision", summary: "secret", issues: [], retryTaskIds: [] },
            reviewed: true,
            cancellation: { requestedAt: 1, pendingChildTaskIds: ["child-secret"], lastError: "secret" },
            createdAt: 1,
            updatedAt: 2,
        });
        const serialized = JSON.stringify(publicRun);

        expect(publicRun).toMatchObject({
            prompt: "图片1 用户原始需求",
            cancellation: { pendingCount: 1 },
            tasks: [{ id: "video", model: "video-pro", optimizedPrompt: "电影感海边日落运镜，人物动作自然流畅", seconds: 60, generateAudio: false, watermark: true, status: "failed", error: "生成任务失败", errorCode: "video_input_copyright_restricted" }],
        });
        expect(serialized).not.toContain("内部执行提示词-secret");
        expect(serialized).not.toContain("@图片1");
        expect(serialized).not.toContain("execution-secret");
        expect(serialized).not.toContain("child-secret");
        expect(serialized).not.toContain("user-secret");
        expect(serialized).not.toContain("request-secret");
        expect(serialized).not.toContain('"foundation"');
        expect(serialized).not.toContain("planner-secret");
        expect(serialized).not.toContain("planner-attempt-secret");
        expect(serialized).not.toContain("planner-error-secret");
        expect(serialized).not.toContain("planner-failure-secret");
        expect(serialized).not.toContain('"planningCycle"');
        expect(serialized).not.toContain('"plannerAttempts"');
        expect(serialized).not.toContain('"plannerFailure"');
        expect(serialized).not.toContain("commit-secret");
        expect(serialized).not.toContain("secret-skill-instructions");
        expect(serialized).not.toContain('"review"');
        expect(serialized).not.toContain('"result"');
        expect(serialized).not.toContain("private-request-id");
    });

    it("keeps the stable copyright code but removes raw provider diagnostics from dispatch SSE", () => {
        const event = publicAgentRunEvent({
            id: "copyright",
            runId: "run",
            type: "task.dispatch.failed",
            data: {
                taskId: "video",
                status: "failed",
                errorCode: "video_input_copyright_restricted",
                error: "The request failed because content[1] is restricted. Request id: private-request-id",
            },
            createdAt: 1,
        });

        expect(event.data).toMatchObject({ taskId: "video", status: "failed", errorCode: "video_input_copyright_restricted", error: "生成任务失败" });
        expect(JSON.stringify(event)).not.toContain("private-request-id");
    });

    it("sanitizes unknown task failure errors in public SSE events", () => {
        const event = publicAgentRunEvent({
            id: "unknown-image-failure",
            runId: "run",
            type: "task.failed",
            data: {
                taskId: "image",
                status: "failed",
                error: "POST http://localhost:3000/internal/provider failed with request private-request-id",
            },
            createdAt: 1,
        });

        expect(event.data).toMatchObject({ taskId: "image", status: "failed", error: "生成渠道暂时无法连接，请稍后重试或联系管理员。" });
        expect(JSON.stringify(event)).not.toContain("localhost");
        expect(JSON.stringify(event)).not.toContain("private-request-id");
    });

    it("classifies persisted manual-model compatibility failures for client localization", () => {
        const raw = "手动选择的模型「gpt-image-2.5-flare」当前不可用或不支持已保存的生成参数";
        const run = publicAgentRun({
            id: "manual-model-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "generate an image",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "image", title: "Image", type: "image", model: "gpt-image-2.5-flare", prompt: "generate an image", count: 1, dependencies: [], status: "failed", attempts: 1, error: raw }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });
        const event = publicAgentRunEvent({ id: "manual-model-event", runId: "manual-model-run", type: "task.failed", data: { taskId: "image", error: raw }, createdAt: 2 });

        expect(run.tasks[0]).toMatchObject({ error: "生成任务失败", errorCode: "manual_model_unavailable_or_incompatible" });
        expect(event.data).toMatchObject({ error: "生成任务失败", errorCode: "manual_model_unavailable_or_incompatible" });
        expect(JSON.stringify(run)).not.toContain("手动选择的模型");
        expect(JSON.stringify(event)).not.toContain("手动选择的模型");
    });

    it("classifies a provider minimum image-size rejection without exposing its request id", () => {
        const raw = "The parameter `size` specified in the request is not valid: image size must be at least 3686400 pixels. Request id: private-image-size-request";
        const run = publicAgentRun({
            id: "image-size-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "generate an image",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "image", title: "Image", type: "image", model: "doubao-seedream-5-0-260128", prompt: "generate an image", count: 1, dependencies: [], status: "failed", attempts: 1, error: raw }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(run.tasks[0]).toMatchObject({ error: "生成任务失败", errorCode: "image_size_below_provider_minimum" });
        expect(JSON.stringify(run)).not.toContain("3686400");
        expect(JSON.stringify(run)).not.toContain("private-image-size-request");
    });

    it("derives a safe duration code for an already-persisted video rejection", () => {
        const raw =
            "The parameter `content[1]` specified in the request is not valid: the parameter video duration (seconds) specified in the request must be less than or equal to 30.2 for model doubao-seedance-2-5 in r2v. Request id: private-duration-request";
        const run = publicAgentRun({
            id: "duration-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "edit this video",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [
                {
                    id: "video",
                    title: "Video",
                    type: "video",
                    prompt: "edit this video",
                    count: 1,
                    dependencies: [],
                    status: "failed",
                    attempts: 1,
                    error: raw,
                },
            ],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(run.tasks[0]).toMatchObject({ errorCode: "video_reference_duration_exceeded", error: "生成任务失败" });
        expect(JSON.stringify(run)).not.toContain("private-duration-request");
    });

    it("restores a safe aspect-ratio code for an already-persisted video rejection", () => {
        const raw = "Error while downloading image, error: expected the aspect ratio to be between 0.39 and 2.50, but received image with aspect ratio: 2.65 instead Request id: private-aspect-request";
        const run = publicAgentRun({
            id: "aspect-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "make a video from this image",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "video", title: "Video", type: "video", prompt: "make a video", count: 1, dependencies: [], status: "failed", attempts: 1, error: raw }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(run.tasks[0]).toMatchObject({ errorCode: "video_reference_aspect_ratio_unsupported", error: "生成任务失败" });
        expect(JSON.stringify(run)).not.toContain("private-aspect-request");
        const event = publicAgentRunEvent({ id: "aspect-event", runId: "aspect-run", type: "task.dispatch.failed", data: { taskId: "video", error: raw }, createdAt: 2 });
        expect(event.data).toMatchObject({ errorCode: "video_reference_aspect_ratio_unsupported", error: "生成任务失败" });
        expect(JSON.stringify(event)).not.toContain("private-aspect-request");
    });

    it("restores a safe output-content code and removes provider request IDs from terminal events", () => {
        const raw = "The request failed because the output video may contain sensitive information. Request id: private-output-request";
        const run = publicAgentRun({
            id: "output-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "make a video",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "video", title: "Video", type: "video", prompt: "make a video", count: 1, dependencies: [], status: "failed", attempts: 1, error: raw }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(run.tasks[0]).toMatchObject({ errorCode: "video_output_sensitive_content", error: "生成任务失败" });
        expect(JSON.stringify(run)).not.toContain("private-output-request");
        for (const type of ["task.failed", "task.child.failed"] as const) {
            const event = publicAgentRunEvent({ id: type, runId: "output-run", type, data: { taskId: "video", error: raw }, createdAt: 2 });
            expect(event.data).toMatchObject({ errorCode: "video_output_sensitive_content", error: "生成任务失败" });
            expect(JSON.stringify(event)).not.toContain("private-output-request");
        }
    });

    it("restores a safe overlong-text code for persisted video failures and terminal events", () => {
        const raw = "task failed with status: FAIL, message: create gen_video task failed. ret:-2,msg:invalid params, content[0].text too long: 13836 > 7000 characters (2013)";
        const run = publicAgentRun({
            id: "long-text-run",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "make a video",
            referencedAssetIds: [],
            assetIds: [],
            status: "failed",
            tasks: [{ id: "video", title: "Video", type: "video", prompt: "make a video", count: 1, dependencies: [], status: "failed", attempts: 1, error: raw }],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(run.tasks[0]).toMatchObject({ errorCode: "video_text_too_long", error: "生成任务失败" });
        expect(JSON.stringify(run)).not.toContain("13836");
        for (const type of ["task.failed", "task.child.failed"] as const) {
            const event = publicAgentRunEvent({ id: type, runId: "long-text-run", type, data: { taskId: "video", error: raw }, createdAt: 2 });
            expect(event.data).toMatchObject({ errorCode: "video_text_too_long", error: "生成任务失败" });
            expect(JSON.stringify(event)).not.toContain("13836");
        }
    });

    it("removes review details and internal Canvas planning nodes from SSE events", () => {
        expect(publicAgentRunEvent({ id: "1", runId: "run", type: "run.review.needs_revision", data: { review: { summary: "secret" } }, createdAt: 1 }).data).toBeUndefined();
        const event = publicAgentRunEvent({
            id: "2",
            runId: "run",
            type: "canvas.ops",
            data: {
                reply: "开始生成",
                ops: [
                    { type: "add_node", id: "brief-run", nodeType: "brief", metadata: { agentBrief: { objective: "secret" } } },
                    { type: "connect_nodes", fromNodeId: "brief-run", toNodeId: "task-run-0" },
                    { type: "add_node", id: "task-run-0", nodeType: "task", metadata: { prompt: "internal-secret", model: "image-pro" } },
                ],
            },
            createdAt: 1,
        });

        expect(event.data).toEqual({ reply: "开始生成", ops: [{ type: "add_node", id: "task-run-0", nodeType: "task", metadata: { model: "image-pro" } }] });
    });

    it("replaces internal planner failures in public SSE events with a generic message", () => {
        const event = publicAgentRunEvent({ id: "3", runId: "run", type: "run.failed", data: { message: "文本模型返回了无效 JSON", plannerFailure: "secret" }, createdAt: 1 });

        expect(event.data).toEqual({ message: "Agent 执行失败" });
        expect(JSON.stringify(event)).not.toContain("无效 JSON");
        expect(JSON.stringify(event)).not.toContain("plannerFailure");
    });

    it("localizes sanitized failures without exposing their internal cause", () => {
        const event = publicAgentRunEvent({ id: "3-vi", runId: "run", type: "run.failed", data: { message: "secret", responseLocale: "vi" }, createdAt: 1 });

        expect(event.data).toEqual({ message: "Agent thực thi thất bại" });
        expect(JSON.stringify(event)).not.toContain("secret");
    });

    it("keeps only already-published conversation text in a partial stream failure event", () => {
        const event = publicAgentRunEvent({ id: "4", runId: "run", type: "run.failed", data: { message: "Xin chào một phần", partialConversation: true, plannerFailure: "secret" }, createdAt: 1 });

        expect(event.data).toEqual({ message: "Xin chào một phần" });
        expect(JSON.stringify(event)).not.toContain("plannerFailure");
    });

    it("includes public conversation content in run snapshots for refresh and reconnect", () => {
        const run = publicAgentRun({
            id: "run-conversation",
            userId: "user",
            conversationId: "conversation",
            clientRequestId: "request",
            surface: "chat",
            inputMessageId: "input",
            assistantMessageId: "assistant",
            prompt: "hello",
            referencedAssetIds: [],
            assetIds: [],
            status: "running",
            responseKind: "conversation",
            conversationReply: "Hello so far",
            tasks: [],
            reviewed: false,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(run).toMatchObject({ responseKind: "conversation", conversationReply: "Hello so far" });
    });
});
