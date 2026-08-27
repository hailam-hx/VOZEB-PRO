import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), listAdminPointLedger: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-points-service", () => ({ listAdminPointLedger: mocks.listAdminPointLedger }));

import { GET } from "./route";

describe("admin points ledger route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listAdminPointLedger.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, summary: { settledBalance: "0", heldBalance: "0", availableBalance: "0", recordCount: 0 } });
    });

    it("requires an authenticated administrator", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);

        const response = await GET(new Request("http://localhost/api/admin/points"));

        expect(response.status).toBe(401);
        expect(mocks.listAdminPointLedger).not.toHaveBeenCalled();
    });

    it("allows a finance reader and forwards bounded ledger filters", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.read"] });

        const response = await GET(new Request("http://localhost/api/admin/points?page=2&pageSize=30&userId=user-one&type=admin-adjust&direction=debit&startAt=2026-08-01T00%3A00%3A00.000Z&endBefore=2026-09-01T00%3A00%3A00.000Z"));

        expect(response.status).toBe(200);
        expect(mocks.listAdminPointLedger).toHaveBeenCalledWith({ page: 2, pageSize: 30, userId: "user-one", type: "admin-adjust", direction: "debit", startAt: "2026-08-01T00:00:00.000Z", endBefore: "2026-09-01T00:00:00.000Z" });
        expect(await response.json()).toMatchObject({ code: 0, data: { summary: { recordCount: 0 } }, msg: "" });
    });

    it("rejects an administrator without finance read or manage permission", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["users.read"] });

        const response = await GET(new Request("http://localhost/api/admin/points"));

        expect(response.status).toBe(403);
        expect(mocks.listAdminPointLedger).not.toHaveBeenCalled();
    });
});
