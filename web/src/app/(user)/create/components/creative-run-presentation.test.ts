import { describe, expect, it } from "vitest";

import type { CreativeAgentRun } from "@/services/api/creative";

import { creativeRunDuration, creativeRunPresentation } from "./creative-run-presentation";

const zhCopy = {
    labels: { mode: "类型", model: "模型", size: "尺寸", ratio: "比例", quality: "画质", definition: "清晰度", duration: "时长", voice: "音色", format: "格式", count: "数量", status: "状态" },
    modes: { image: "图片生成", video: "视频生成", audio: "音频生成" },
    qualities: { auto: "智能", high: "高画质", medium: "标准", low: "快速" },
    statuses: { planning: "规划中", running: "生成中", paused: "已暂停", completed: "已完成", cancelled: "已取消", failed: "失败" },
    seconds: (value: number) => `${value}秒`,
    resultCount: (value: number) => `${value}个结果`,
};

describe("creativeRunPresentation", () => {
    it("shows public final video parameters without internal planning fields", () => {
        const run: CreativeAgentRun = {
            id: "run-one",
            conversationId: "conversation-one",
            inputMessageId: "user-one",
            assistantMessageId: "assistant-one",
            status: "completed",
            prompt: "让参考图自然动起来",
            requestedModelIds: ["seedance"],
            generationPreferences: { mode: "video", video: { size: "16:9", quality: "720P", seconds: 10, referenceMode: "first_frame" } },
            assetIds: [],
            tasks: [{ id: "task-one", title: "生成视频", type: "video", model: "seedance", ratio: "16:9", quality: "720P", seconds: 10, count: 1, status: "completed" }],
        };

        expect(creativeRunPresentation(run, new Map([["seedance", "Seedance 2.0"]]), zhCopy)).toEqual([
            { key: "mode", label: "类型", value: "视频生成" },
            { key: "model", label: "模型", value: "Seedance 2.0" },
            { key: "size", label: "比例", value: "16:9" },
            { key: "quality", label: "清晰度", value: "720P" },
            { key: "seconds", label: "时长", value: "10秒" },
            { key: "status", label: "状态", value: "已完成" },
        ]);
    });

    it("falls back to explicit preferences while planning", () => {
        const run = {
            id: "run-two",
            conversationId: "conversation-one",
            inputMessageId: "user-two",
            assistantMessageId: "assistant-two",
            status: "planning",
            generationPreferences: { mode: "image", image: { size: "3:4", quality: "high" } },
            assetIds: [],
            tasks: [],
        } satisfies CreativeAgentRun;

        expect(creativeRunPresentation(run, new Map(), zhCopy)).toEqual([
            { key: "mode", label: "类型", value: "图片生成" },
            { key: "size", label: "尺寸", value: "3:4" },
            { key: "quality", label: "画质", value: "高画质" },
            { key: "status", label: "状态", value: "规划中" },
        ]);
    });

    it("formats the persisted run duration without inventing a timeout", () => {
        expect(creativeRunDuration({ createdAt: 1_000, updatedAt: 66_000 } as CreativeAgentRun)).toBe("1分钟5秒");
        expect(creativeRunDuration({ createdAt: 1_000, updatedAt: 1_200 } as CreativeAgentRun)).toBe("1秒");
        expect(creativeRunDuration({ createdAt: 2_000, updatedAt: 1_000 } as CreativeAgentRun)).toBe("");
    });
});
