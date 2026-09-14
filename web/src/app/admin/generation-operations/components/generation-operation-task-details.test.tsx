/** @vitest-environment jsdom */

import { App } from "antd";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminGenerationTask } from "@/lib/admin-generation-operations";
import { GenerationRequestSummary, GenerationTaskRuntimeSummary } from "./generation-operation-task-details";

const roots: Array<ReturnType<typeof createRoot>> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(async () => {
    await act(async () => {
        while (roots.length) roots.pop()?.unmount();
    });
    document.body.replaceChildren();
});

describe("generation operation task details", () => {
    it("shows the prompt, failure and planner attempt timeline as separate admin diagnostics", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        roots.push(root);
        const task = plannerFailureTask();

        await act(async () =>
            root.render(
                <App>
                    <GenerationRequestSummary task={task} />
                    <GenerationTaskRuntimeSummary task={task} />
                </App>,
            ),
        );

        expect(host.textContent).toContain("请求摘要");
        expect(host.textContent).toContain("写剧本一个女跳舞");
        expect(host.textContent).toContain("失败原因");
        expect(host.textContent).toContain("文本模型返回了无效 JSON");
        expect(host.textContent).toContain("规划尝试");
        expect(host.textContent).toContain("第 1 轮 · 尝试 1 · 主路由");
        expect(host.textContent).toContain("DFLOP OpenAI → gpt-5.6-sol");
        expect(host.textContent).toContain("Chat Completions · 320 毫秒 · 已收到响应");
        expect(host.textContent).toContain("TTFB 100 毫秒 · TTFT 180 毫秒 · 结果 生成计划");
        expect(host.textContent).toContain("失败阶段：规划结算");
        expect(host.textContent).toContain("规划结算：失败 · 尝试 1 · ledger_unavailable · 可重试");
        expect(host.textContent).toContain("Agent 时序 请求→上游 120 毫秒 · Planner TTFB 100 毫秒 · Planner 320 毫秒");
    });

    it.each(["chat", "claude"] as const)("shows persisted %s text attempt timing, usage and error details only in generation operations", async (protocol) => {
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        roots.push(root);
        const task: AdminGenerationTask = {
            ...plannerFailureTask(),
            id: "text-task",
            type: "text",
            attempts: [
                {
                    attemptNo: 1,
                    model: "writer",
                    upstreamModel: "writer-v2",
                    status: "failed",
                    startedAt: 1_000,
                    completedAt: 5_000,
                    protocol,
                    transport: "stream",
                    error: "上游流中断",
                    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
                    latency: { firstByteMs: 120, firstTextMs: 240, streamMs: 3_600, finalizationMs: 400, totalMs: 4_000 },
                    transportDiagnostic: {
                        connectionTermination: "socket_reset",
                        framesReceived: 42,
                        bytesReceived: 8192,
                        finishReason: "stop",
                        terminalSeen: true,
                        doneMarkerSeen: false,
                        usageSeen: true,
                        rootError: { name: "TypeError", message: "terminated", cause: { name: "SocketError", code: "UND_ERR_SOCKET", errno: -54, syscall: "read" } },
                    },
                },
            ],
        };

        await act(async () =>
            root.render(
                <App>
                    <GenerationTaskRuntimeSummary task={task} />
                </App>,
            ),
        );

        expect(host.textContent).toContain("文本尝试");
        expect(host.textContent).toContain(`流式 · ${protocol === "claude" ? "Claude" : "Chat Completions"}`);
        expect(host.textContent).toContain("首字节 120 毫秒 · 首段文本 240 毫秒 · 流 3.6 秒");
        expect(host.textContent).toContain("用量 输入 120 · 输出 80 · 合计 200 Token");
        expect(host.textContent).toContain("传输 Socket 重置 · 42 帧 · 8192 字节 · finish stop · terminal 是 · [DONE] 否 · usage 是");
        expect(host.textContent).toContain("根错误 TypeError: terminated · cause SocketError · UND_ERR_SOCKET · errno -54 · syscall read");
        expect(host.textContent).toContain("上游流中断");
    });
});

function plannerFailureTask(): AdminGenerationTask {
    return {
        id: "agent-run",
        userId: "user",
        username: "",
        displayName: "用户",
        type: "agent",
        status: "error",
        model: "gpt-5.6-sol",
        channelId: "DFLOP OpenAI",
        leaseExpired: false,
        prompt: "写剧本一个女跳舞",
        error: "文本模型返回了无效 JSON",
        durationMs: 320,
        pointsCost: 0,
        plannerAttempts: [
            {
                attemptNo: 1,
                planningCycle: 1,
                logicalModelId: "gpt-5.6-sol",
                channelId: "DFLOP OpenAI",
                upstreamModel: "gpt-5.6-sol",
                protocol: "chat",
                status: "failed",
                requestAcceptance: "response",
                startedAt: 1000,
                completedAt: 1320,
                elapsedMs: 320,
                firstByteMs: 100,
                firstContentMs: 180,
                resultKind: "generation",
                error: "文本模型返回了无效 JSON",
            },
        ],
        plannerFailure: { message: "文本模型返回了无效 JSON", failedAt: 1320 },
        planningFinalization: { planningCycle: 1, status: "failed", attemptNumber: 1, errorCode: "ledger_unavailable", error: "结算账本暂时不可用", retryable: true, updatedAt: 1330 },
        failureStage: "planner_settlement",
        agentTiming: { requestToPlannerUpstreamMs: 120, plannerTtfbMs: 100, plannerDurationMs: 320 },
        createdAt: 1000,
        updatedAt: 1320,
        canCancel: false,
    };
}
