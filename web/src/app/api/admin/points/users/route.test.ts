import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), searchAdminPointUsers: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-points-service", () => ({ searchAdminPointUsers: mocks.searchAdminPointUsers }));

import { GET } from "./route";

describe("admin points user lookup route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.searchAdminPointUsers.mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 20 });
    });

    it("allows billing managers to search by public account identity without users.read", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.manage"] });

        const response = await GET(new Request("http://localhost/api/admin/points/users?keyword=0001&page=2&pageSize=10"));

        expect(response.status).toBe(200);
        expect(mocks.searchAdminPointUsers).toHaveBeenCalledWith({ keyword: "0001", page: 2, pageSize: 10 });
    });
});
