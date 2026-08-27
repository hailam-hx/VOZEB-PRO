// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";
import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { useCanvasGenerationActions } from "./use-canvas-generation-actions";

afterEach(() => cleanup());

describe("useCanvasGenerationActions capability preflight", () => {
    it("returns before running state, placeholders and task creation when the current model rejects the persisted size", async () => {
        const sourceNode: CanvasNodeData = {
            id: "config-node",
            type: CanvasNodeType.Config,
            title: "生成配置",
            position: { x: 0, y: 0 },
            width: 360,
            height: 240,
            metadata: { generationMode: "image", composerContent: "生成海报", model: "image-model", size: "4097x17", quality: "auto" },
        };
        const setRunningNodeId = vi.fn();
        const setNodes = vi.fn();
        const startGenerationRequest = vi.fn(() => new AbortController());
        const error = vi.fn();
        const state = {
            message: { error, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
            projectId: "project",
            containerRef: { current: null },
            effectiveConfig: configWithImageCapability(profile({ aspectRatios: ["1:1"], maxBatchSize: 1 })),
            isAiConfigReady: () => true,
            openConfigDialog: vi.fn(),
            currentProject: null,
            setNodes,
            setConnections: vi.fn(),
            size: { width: 1200, height: 800 },
            setSelectedNodeIds: vi.fn(),
            setSelectedConnectionId: vi.fn(),
            setRunningNodeId,
            projectLoaded: true,
            setDialogNodeId: vi.fn(),
            assistantCollapsed: true,
            setAssistantCollapsed: vi.fn(),
            assistantMounted: false,
            setAssistantMounted: vi.fn(),
            assistantClosing: false,
            setAssistantClosing: vi.fn(),
            nodesRef: { current: [sourceNode] },
            connectionsRef: { current: [] },
            generateNodeRef: { current: null },
            agentCloseTimerRef: { current: null },
            autoOpenedAgentRef: { current: true },
        };
        const tasks = {
            startGenerationRequest,
            finishGenerationRequest: vi.fn(),
            completeVideoTask: vi.fn(),
            startAndCompleteImageTask: vi.fn(),
            completeTextTask: vi.fn(),
            completeAudioTask: vi.fn(),
        };
        const { result } = renderHook(() => useCanvasGenerationActions({ state: state as never, tasks: tasks as never, interactions: { screenToCanvas: vi.fn(), applyAgentOps: vi.fn() } as never }), { wrapper });

        await act(() => result.current.handleGenerateNode(sourceNode.id, "image", "生成海报"));

        expect(error).toHaveBeenCalledWith(expect.stringContaining("当前模型不支持此参数"));
        expect(setRunningNodeId).not.toHaveBeenCalled();
        expect(setNodes).not.toHaveBeenCalled();
        expect(startGenerationRequest).not.toHaveBeenCalled();
    });
});

function wrapper({ children }: { children: ReactNode }) {
    return (
        <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
            {children}
        </NextIntlClientProvider>
    );
}

function configWithImageCapability(generationParameters: LogicalModelGenerationParameters): AiConfig {
    return {
        ...defaultConfig,
        channels: [{ id: "channel", name: "Channel", baseUrl: "/api/ai/system/channel", apiKey: "system", apiFormat: "openai", models: ["image-upstream"] }],
        logicalModels: [
            {
                id: "image-model",
                name: "Image model",
                capability: "image",
                enabled: true,
                bindings: [{ id: "binding", channelId: "channel", upstreamModel: "image-upstream", enabled: true, priority: 0, generationParameters }],
            },
        ],
        models: ["image-model"],
        imageModels: ["image-model"],
        imageModel: "image-model",
        model: "image-model",
        size: "auto",
        quality: "auto",
        canvasImageCount: "auto",
    };
}

function profile(overrides: Partial<LogicalModelGenerationParameters> = {}): LogicalModelGenerationParameters {
    return {
        referenceInputs: [],
        aspectRatios: [],
        pixelSizes: [],
        supportsCustomSize: false,
        qualities: [],
        resolutions: [],
        durationSeconds: [],
        videoReferenceModes: [],
        voices: [],
        formats: [],
        ...overrides,
    };
}
