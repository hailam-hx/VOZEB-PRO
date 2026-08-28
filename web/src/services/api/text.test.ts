import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(), syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/stores/use-config-store", () => ({
    resolveModelRequestConfig: vi.fn((config: Record<string, unknown>, model: string) => ({ ...config, model, apiSource: "system" })),
}));

import type { AiConfig } from "@/stores/use-config-store";
import { waitForTextGenerationTask } from "./text";

describe("文本任务轮询", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stops polling when an uncertain upstream submission fails", async () => {
        const fetchMock = vi.fn(async () => Response.json({ task: { id: "text-failed", status: "error", model: "text-model", error: "文本提交结果无法确认" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(waitForTextGenerationTask({ apiSource: "system" } as AiConfig, { id: "text-failed", status: "running", model: "text-model" })).rejects.toThrow("文本提交结果无法确认");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
