import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    refundUserPoints: vi.fn(),
    normalizeDramaContentAnalysis: vi.fn(),
    requestStructuredText: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings, isAuthInputError: vi.fn(() => false), refundUserPoints: mocks.refundUserPoints }));
vi.mock("@/lib/server/drama-analysis", () => ({
    describeDramaAnalysisCandidate: vi.fn(() => ({})),
    describeDramaModelOutput: vi.fn(() => ({})),
    dramaContentTool: { name: "analyze_drama_content", description: "content", parameters: {} },
    dramaVisualTool: { name: "design_drama_visuals", description: "visual", parameters: {} },
    hasUsableDramaToolArguments: vi.fn(() => true),
    normalizeDramaContentAnalysis: mocks.normalizeDramaContentAnalysis,
    normalizeDramaVisualAnalysis: vi.fn(),
}));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://internal") }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModelCandidates: vi.fn(() => [{ channel: { id: "channel-one" }, upstreamModel: "text-upstream" }]) }));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/server/text-planning-runtime", () => ({ rankTextPlanningCandidates: vi.fn((items) => items), requestStructuredText: mocks.requestStructuredText }));

import { POST } from "./route";

describe("drama analysis balance projection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getAuthSettings.mockResolvedValue({ defaultModels: { textModel: "logical-text" }, generationDefaults: { videoSeconds: 5 } });
        mocks.normalizeDramaContentAnalysis.mockReturnValue({ characters: [], scenes: [], shots: [{ id: "shot-one" }] });
        mocks.requestStructuredText.mockResolvedValue({
            arguments: "{}",
            protocol: "chat",
            elapsedMs: 1,
            headers: new Headers({
                "x-vozeb-pro-balance-settled": "12345678901234567890.12345678",
                "x-vozeb-pro-balance-held": "0.00000001",
                "x-vozeb-pro-balance-available": "12345678901234567890.12345677",
                "x-vozeb-pro-points-cost": "1.5",
                "x-vozeb-pro-points-record-id": "record-one",
            }),
        });
        mocks.refundUserPoints.mockResolvedValue({ settledBalance: "12345678901234567890.12345678", heldBalance: "0.00000001", availableBalance: "12345678901234567890.12345677" });
    });

    it("copies exact charge-phase settled, held, and available balances", async () => {
        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("12345678901234567890.12345678");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("0.00000001");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("12345678901234567890.12345677");
        expect(response.headers.has("x-vozeb-pro-points-remaining")).toBe(false);
    });

    it("returns exact refunded balances when charged model output cannot be normalized", async () => {
        mocks.normalizeDramaContentAnalysis.mockImplementationOnce(() => {
            throw new Error("invalid drama output");
        });
        mocks.refundUserPoints.mockResolvedValueOnce({ settledBalance: "99999999999999999999.00000001", heldBalance: "12.00000000", availableBalance: "99999999999999999987.00000001" });

        const response = await POST(request());

        expect(response.status).toBe(502);
        expect(mocks.refundUserPoints).toHaveBeenCalledWith("user-one", "logical-text", 1.5, "text", 1, undefined, "record-one");
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("99999999999999999999.00000001");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("12.00000000");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("99999999999999999987.00000001");
    });
});

function request() {
    return new Request("http://localhost/api/drama/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "content", script: "第一场" }) });
}
