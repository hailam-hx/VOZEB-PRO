import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    listPublicUsersPage: vi.fn(),
    createUserByAdmin: vi.fn(),
    isAuthInputError: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser, serializeCurrentUser: vi.fn((user) => user) }));
vi.mock("@/lib/auth/store", () => ({
    createUserByAdmin: mocks.createUserByAdmin,
    isAuthInputError: mocks.isAuthInputError,
    listPublicUsersPage: mocks.listPublicUsersPage,
}));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: vi.fn() }));

import { GET, POST } from "./route";

describe("admin users route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAuthInputError.mockReturnValue(false);
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["users.read", "users.manage", "administrators.manage"], username: "admin" });
        mocks.listPublicUsersPage.mockResolvedValue({
            users: [{ id: "user-one", username: "creator" }],
            total: 51,
            page: 2,
            pageSize: 20,
            summary: { total: 80, active: 70, disabled: 10, admins: 2, activeAdmins: 2, totalSettledBalance: "3200" },
        });
        mocks.createUserByAdmin.mockResolvedValue({ id: "user-two", username: "new-user", role: "user", status: "active" });
    });

    it("creates a user with the current administrator permission", async () => {
        const response = await POST(
            new Request("http://localhost/api/admin/users", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: "new-user", password: "new-password" }),
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.createUserByAdmin).toHaveBeenCalledOnce();
        expect(await response.json()).toMatchObject({ code: 0, data: { user: { id: "user-two" } }, msg: "" });
    });

    it("requires an authenticated administrator", async () => {
        mocks.getCurrentUser.mockResolvedValueOnce(null);
        const unauthenticated = await GET(request());
        expect(unauthenticated.status).toBe(401);
        expect(await unauthenticated.json()).toEqual({ code: 401, data: null, msg: "请先登录" });

        mocks.getCurrentUser.mockResolvedValueOnce({ id: "user-one", role: "user" });
        const forbidden = await GET(request());
        expect(forbidden.status).toBe(403);
        expect(await forbidden.json()).toEqual({ code: 403, data: null, msg: "当前管理员没有查看用户的职责权限" });
        expect(mocks.listPublicUsersPage).not.toHaveBeenCalled();
    });

    it("wraps collection read failures in the shared response envelope", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        mocks.listPublicUsersPage.mockRejectedValueOnce(new Error("database unavailable"));

        const response = await GET(request());

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ code: 500, data: null, msg: "加载用户失败" });
        expect(log).toHaveBeenCalledOnce();
        log.mockRestore();
    });

    it("passes pagination, search, role and status to the server list", async () => {
        const response = await GET(request("?page=2&pageSize=20&keyword=%E7%AE%A1%E7%90%86%E5%91%98&role=admin&status=active"));

        expect(response.status).toBe(200);
        expect(mocks.listPublicUsersPage).toHaveBeenCalledWith({ page: 2, pageSize: 20, keyword: "管理员", role: "admin", status: "active" });
        expect(await response.json()).toMatchObject({ code: 0, data: { total: 51, page: 2, summary: { total: 80, totalSettledBalance: "3200" } }, msg: "" });
    });
});

function request(search = "") {
    return new Request(`http://localhost/api/admin/users${search}`) as never;
}
