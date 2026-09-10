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
                error: "文本模型返回了无效 JSON",
            },
        ],
        plannerFailure: { message: "文本模型返回了无效 JSON", failedAt: 1320 },
        createdAt: 1000,
        updatedAt: 1320,
        canCancel: false,
    };
}
