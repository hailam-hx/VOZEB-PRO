import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getAdminUsageAudit: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-usage-audit-service", () => ({ getAdminUsageAudit: mocks.getAdminUsageAudit }));

import { GET } from "./route";

describe("admin usage audit route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.read"] });
        mocks.getAdminUsageAudit.mockResolvedValue({ items: [], recovery: [], total: 0, page: 2, pageSize: 10, recoveryTotal: 43, recoveryPage: 3, recoveryPageSize: 15, zeroUsage: 0, negativeMargin: 0 });
    });

    it("passes independent bounded usage and recovery pagination", async () => {
        const response = await GET(new NextRequest("http://localhost/api/admin/billing/usage?page=2&pageSize=10&recoveryPage=3&recoveryPageSize=15"));

        expect(response.status).toBe(200);
        expect(mocks.getAdminUsageAudit).toHaveBeenCalledWith({ page: 2, pageSize: 10, recoveryPage: 3, recoveryPageSize: 15 });
        expect(await response.json()).toMatchObject({ code: 0, data: { recoveryTotal: 43, recoveryPage: 3 }, msg: "" });
    });
});
