import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthSettings } from "@/lib/auth/store";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { requestStructuredText } from "@/lib/server/text-planning-runtime";
import { finishSystemAiTextAttempt, resolveSystemAiTextFailure } from "@/lib/server/usage-billing-runtime";
import { optimizeCreativePrompt } from "./prompt-optimization-service";

vi.mock("@/lib/auth/store", () => ({ getAuthSettings: vi.fn() }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModelCandidates: vi.fn() }));
vi.mock("@/lib/server/text-planning-runtime", () => ({
    rankTextPlanningCandidates: <T>(items: T[]) => items,
    requestStructuredText: vi.fn(),
    TextPlanningRequestError: class TextPlanningRequestError extends Error {
        requestAcceptance = "response" as const;
    },
}));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ finishSystemAiTextAttempt: vi.fn(), resolveSystemAiTextFailure: vi.fn() }));

const candidate = {
    channelId: "text-channel",
    upstreamModel: "grok-4.5",
    channel: { id: "text-channel", name: "文本渠道", baseUrl: "https://example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["grok-4.5"], enabled: true },
    binding: { id: "binding-text" },
    capabilityProfile: { supportsIdempotency: true },
};

describe("prompt optimization service", () => {
    beforeEach(() => {
        vi.mocked(getAuthSettings)
            .mockReset()
            .mockResolvedValue({ defaultModels: { textModel: "planner" } } as Awaited<ReturnType<typeof getAuthSettings>>);
        vi.mocked(resolveLogicalModelCandidates)
            .mockReset()
            .mockReturnValue([candidate] as ReturnType<typeof resolveLogicalModelCandidates>);
        vi.mocked(requestStructuredText).mockReset();
        vi.mocked(finishSystemAiTextAttempt).mockReset();
        vi.mocked(resolveSystemAiTextFailure).mockReset().mockResolvedValue({ state: "safe_to_failover" });
    });

    it("uses the default text model once and returns a valid public prompt", async () => {
        vi.mocked(requestStructuredText).mockResolvedValue({ arguments: JSON.stringify({ optimizedPrompt: "生成一张清晰的国风角色海报，保留青色长袍。" }), headers: new Headers(), protocol: "chat", elapsedMs: 10 });

        const result = await optimizeCreativePrompt({ origin: "http://localhost:3000", cookie: "session=1", userId: "user-one", requestId: "request-one", prompt: "做个国风角色海报 青衣", mode: "image" });

        expect(result).toBe("生成一张清晰的国风角色海报，保留青色长袍。");
        expect(requestStructuredText).toHaveBeenCalledTimes(1);
        expect(requestStructuredText).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "做个国风角色海报 青衣" })]),
            }),
        );
        expect(new Headers(vi.mocked(requestStructuredText).mock.calls[0]![0].headers).get("x-vozeb-pro-logical-model")).toBe("planner");
        const billingHeaders = new Headers(vi.mocked(requestStructuredText).mock.calls[0]![0].headers);
        expect(billingHeaders.get("x-vozeb-pro-billing-user-id")).toBe("user-one");
        expect(billingHeaders.get("x-vozeb-pro-billing-binding-id")).toBe("binding-text");
        expect(billingHeaders.get("x-vozeb-pro-provider-idempotency-key")).toContain(":attempt:1:text-channel:grok-4.5");
        expect(finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "succeeded" });
    });

    it("fails and releases an invalid priced response instead of accepting hidden or empty output", async () => {
        vi.mocked(requestStructuredText).mockResolvedValue({
            arguments: JSON.stringify({ explanation: "内部分析" }),
            headers: new Headers({ "x-vozeb-pro-points-cost": "3", "x-vozeb-pro-points-record-id": "points-one" }),
            protocol: "chat",
            elapsedMs: 10,
        });

        await expect(optimizeCreativePrompt({ origin: "http://localhost:3000", cookie: "session=1", userId: "user-one", requestId: "request-one", prompt: "优化这句话", mode: "agent" })).rejects.toThrow("默认文本模型没有返回有效提示词");
        expect(finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "failed" });
        expect(resolveSystemAiTextFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", final: true }));
    });

    it("fails clearly when no default text binding is available", async () => {
        vi.mocked(resolveLogicalModelCandidates).mockReturnValue([]);

        await expect(optimizeCreativePrompt({ origin: "http://localhost:3000", cookie: "", userId: "user-one", requestId: "request-one", prompt: "优化这句话", mode: "agent" })).rejects.toMatchObject({ status: 503 });
        expect(requestStructuredText).not.toHaveBeenCalled();
    });
});
