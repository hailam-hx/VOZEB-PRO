import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthSettings, fetchInternalApi, resolveLogicalModel, finishSystemAiTextAttempt, resolveSystemAiTextFailure } = vi.hoisted(() => ({
    getAuthSettings: vi.fn(),
    fetchInternalApi: vi.fn(),
    resolveLogicalModel: vi.fn(),
    finishSystemAiTextAttempt: vi.fn(),
    resolveSystemAiTextFailure: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ getAuthSettings }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModel }));
vi.mock("@/lib/server/structured-model-output", () => ({ strictJsonObjectText: (value: unknown) => (typeof value === "string" ? value : "") }));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ finishSystemAiTextAttempt, resolveSystemAiTextFailure }));

import { reviewCreativeOutputs } from "./creative-review-service";

const foundation = { complexity: "simple" as const, brief: { objective: "生成商品主图" }, direction: { summary: "干净、可信、突出产品" } };

describe("creative review service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAuthSettings.mockResolvedValue({ defaultModels: { textModel: "planner" } });
        resolveLogicalModel.mockReturnValue({ upstreamModel: "vendor-planner", channelId: "text-channel", channel: { id: "text-channel" }, binding: { id: "binding-text" }, capabilityProfile: { supportsIdempotency: true } });
        resolveSystemAiTextFailure.mockResolvedValue({ state: "safe_to_failover" });
    });

    it("returns an explicit unavailable result when no visual or text input exists", async () => {
        const review = await reviewCreativeOutputs({ origin: "http://localhost:3000", cookie: "session=1", userId: "user", foundation, tasks: [{ id: "video", title: "视频", type: "video", prompt: "生成视频", resultSummary: "已完成" }] });

        expect(review).toMatchObject({ mode: "unavailable", status: "unavailable" });
        expect(getAuthSettings).not.toHaveBeenCalled();
    });

    it("sends real images to the trusted logical model route", async () => {
        fetchInternalApi.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    output: [
                        {
                            type: "function_call",
                            name: "review_creative_outputs",
                            arguments: JSON.stringify({ mode: "visual", status: "passed", score: 92, summary: "主体和视觉方向一致", issues: [], retryTaskIds: [] }),
                        },
                    ],
                }),
                { status: 200, headers: { "Content-Type": "application/json", "x-vozeb-pro-points-cost": "2" } },
            ),
        );

        const review = await reviewCreativeOutputs({
            origin: "http://localhost:3000",
            cookie: "session=1",
            userId: "user",
            billingId: "record-one",
            foundation,
            tasks: [{ id: "image-1", title: "主图", type: "image", prompt: "生成主图", resultSummary: "已生成", imageUrls: ["data:image/png;base64,AA=="] }],
        });

        expect(review).toMatchObject({ mode: "visual", status: "passed", score: 92 });
        expect(fetchInternalApi).toHaveBeenCalledWith("http://localhost:3000/api/ai/system/text-channel/responses", expect.objectContaining({ body: expect.stringContaining('"type":"input_image"') }));
        expect(JSON.parse(fetchInternalApi.mock.calls[0][1].body).model).toBe("vendor-planner");
        const headers = new Headers(fetchInternalApi.mock.calls[0][1].headers);
        expect(headers.get("x-vozeb-pro-logical-model")).toBe("planner");
        expect(headers.get("x-vozeb-pro-points-idempotency-key")).toMatch(/^creative-review:[a-f0-9]{32}$/);
        expect(headers.get("x-vozeb-pro-billing-user-id")).toBe("user");
        expect(headers.get("x-vozeb-pro-billing-binding-id")).toBe("binding-text");
        expect(finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "succeeded" });
    });

    it("voids an invalid structured review and preserves the result as unavailable", async () => {
        fetchInternalApi.mockResolvedValueOnce(
            new Response(JSON.stringify({ output: [{ type: "function_call", name: "review_creative_outputs", arguments: JSON.stringify({ status: "passed" }) }] }), {
                status: 200,
                headers: { "Content-Type": "application/json", "x-vozeb-pro-points-cost": "3", "x-vozeb-pro-points-record-id": "points-review-3" },
            }),
        );

        const review = await reviewCreativeOutputs({
            origin: "http://localhost:3000",
            cookie: "session=1",
            userId: "user",
            foundation,
            tasks: [{ id: "image-1", title: "主图", type: "image", prompt: "生成主图", resultSummary: "已生成", imageUrls: ["data:image/png;base64,AA=="] }],
        });

        expect(review).toMatchObject({ status: "unavailable" });
        expect(finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "failed" });
        expect(resolveSystemAiTextFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", final: true }));
    });

    it("voids malformed review JSON", async () => {
        fetchInternalApi.mockResolvedValueOnce(
            new Response(JSON.stringify({ output: [{ type: "function_call", name: "review_creative_outputs", arguments: "{" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json", "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "points-review-free" },
            }),
        );

        const review = await reviewCreativeOutputs({
            origin: "http://localhost:3000",
            cookie: "session=1",
            userId: "user",
            foundation,
            tasks: [{ id: "image-1", title: "主图", type: "image", prompt: "生成主图", resultSummary: "已生成", imageUrls: ["data:image/png;base64,AA=="] }],
        });

        expect(review.status).toBe("unavailable");
        expect(finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "failed" });
    });
});
