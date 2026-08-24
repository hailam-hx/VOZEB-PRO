import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getAdminUsageAttempts: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-usage-audit-service", () => ({ getAdminUsageAttempts: mocks.getAdminUsageAttempts }));

import { GET } from "./route";

describe("admin usage provider attempts route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.read"] });
        mocks.getAdminUsageAttempts.mockResolvedValue({ items: [{ id: "attempt-failed", status: "failed", nativeCostAmount: "2.5", costUsd: "0.25" }], total: 3, page: 2, pageSize: 1 });
    });

    it("returns a bounded page including failed provider attempts", async () => {
        const response = await GET(new NextRequest("http://localhost/api/admin/billing/usage/charge-one/attempts?page=2&pageSize=1"), { params: Promise.resolve({ id: "charge-one" }) });

        expect(response.status).toBe(200);
        expect(mocks.getAdminUsageAttempts).toHaveBeenCalledWith("charge-one", { page: 2, pageSize: 1 });
        expect(await response.json()).toEqual({ code: 0, data: { items: [{ id: "attempt-failed", status: "failed", nativeCostAmount: "2.5", costUsd: "0.25" }], total: 3, page: 2, pageSize: 1 }, msg: "" });
    });
});
