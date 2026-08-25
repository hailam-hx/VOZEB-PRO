import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/services/api/points", () => ({ syncUserPointsFromHeaders: mocks.syncUserPointsFromHeaders }));

import { requestDramaAnalysis } from "./drama-analysis";

describe("drama analysis client balance sync", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("syncs exact charge-phase balance headers before returning content analysis", async () => {
        const headers = new Headers({ "x-vozeb-pro-balance-settled": "12.50000001", "x-vozeb-pro-balance-held": "2.00000000", "x-vozeb-pro-balance-available": "10.50000001" });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { shots: [] }, msg: "内容结构待审核" }), { status: 200, headers })),
        );

        await expect(requestDramaAnalysis<{ shots: unknown[] }>({ phase: "content", script: "第一场" })).resolves.toEqual({ shots: [] });
        expect(mocks.syncUserPointsFromHeaders.mock.calls[0]?.[0].get("x-vozeb-pro-balance-available")).toBe("10.50000001");
        expect(mocks.syncUserPointsFromHeaders.mock.calls[0]?.[1]).toBe("system");
    });

    it("syncs exact refund-phase balance headers before rejecting the failed analysis", async () => {
        const headers = new Headers({ "x-vozeb-pro-balance-settled": "15.00000001", "x-vozeb-pro-balance-held": "0", "x-vozeb-pro-balance-available": "15.00000001" });
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: 502, data: null, msg: "模型结果无效" }), { status: 502, headers })),
        );

        await expect(requestDramaAnalysis({ phase: "content", script: "第一场" })).rejects.toThrow("模型结果无效");
        expect(mocks.syncUserPointsFromHeaders.mock.calls[0]?.[0].get("x-vozeb-pro-balance-settled")).toBe("15.00000001");
        expect(mocks.syncUserPointsFromHeaders.mock.calls[0]?.[1]).toBe("system");
    });
});
