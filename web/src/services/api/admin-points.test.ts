import { beforeEach, describe, expect, it, vi } from "vitest";

import { adjustAdminPoints, listAdminPoints, searchAdminPointsUsers } from "./admin-points";

describe("admin points API client", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("serializes ledger filters without empty query values", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { items: [], total: 0, page: 2, pageSize: 20, summary: { settledBalance: "0", heldBalance: "0", availableBalance: "0", recordCount: 0 } }, msg: "" }), { status: 200 }));

        await listAdminPoints({ page: 2, pageSize: 20, userId: "user-one", type: "", direction: "debit" });

        expect(fetchMock).toHaveBeenCalledWith("/api/admin/points?page=2&pageSize=20&userId=user-one&direction=debit", { cache: "no-store" });
    });

    it("posts a stable adjustment payload", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ code: 0, data: { applied: true, record: { id: "record-one", amount: "1.25", balanceAfter: "2.5" }, snapshot: { settledBalance: "2.5", heldBalance: "0", availableBalance: "2.5" } }, msg: "" }), {
                status: 200,
            }),
        );
        const input = { userId: "user-one", operation: "increase" as const, amount: "1.25", reason: "补偿", requestId: "request-0001" };

        await adjustAdminPoints(input);

        expect(fetchMock).toHaveBeenCalledWith("/api/admin/points/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store" });
    });

    it("uses the finance-scoped user lookup", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { users: [], total: 0, page: 1, pageSize: 20 }, msg: "" }), { status: 200 }));

        await searchAdminPointsUsers("0001");

        expect(fetchMock).toHaveBeenCalledWith("/api/admin/points/users?keyword=0001&page=1&pageSize=20", { cache: "no-store" });
    });
});
