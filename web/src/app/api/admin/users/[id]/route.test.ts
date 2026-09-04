import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    updateUserByAdmin: vi.fn(),
    deleteAdminUserWithMediaCleanup: vi.fn(),
    isAuthInputError: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({
    updateUserByAdmin: mocks.updateUserByAdmin,
    isAuthInputError: mocks.isAuthInputError,
}));
vi.mock("@/lib/server/admin-user-deletion-service", () => ({
    deleteAdminUserWithMediaCleanup: mocks.deleteAdminUserWithMediaCleanup,
    AdminUserDeletionError: class AdminUserDeletionError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    },
}));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: vi.fn() }));

import { DELETE, PATCH } from "./route";

describe("admin user detail route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAuthInputError.mockReturnValue(false);
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["users.manage", "administrators.manage", "billing.manage"] });
        mocks.updateUserByAdmin.mockResolvedValue({ id: "user-one", username: "creator", role: "user", status: "active" });
        mocks.deleteAdminUserWithMediaCleanup.mockResolvedValue({ ok: true });
    });

    it("updates user fields with the current administrator permission", async () => {
        const response = await PATCH(request("PATCH", { role: "admin" }), context());

        expect(response.status).toBe(200);
        expect(mocks.updateUserByAdmin).toHaveBeenCalledWith("admin-one", "user-one", { role: "admin" });
        expect(await response.json()).toMatchObject({ code: 0, data: { user: { id: "user-one" } }, msg: "" });
    });

    it("deletes the user aggregate with the current administrator permission", async () => {
        const response = await DELETE(request("DELETE"), context());

        expect(response.status).toBe(200);
        expect(mocks.deleteAdminUserWithMediaCleanup).toHaveBeenCalledWith("admin-one", "user-one");
        expect(await response.json()).toEqual({ code: 0, data: { ok: true }, msg: "" });
    });

    it("returns an actionable conflict while provider voices still exist", async () => {
        const { AdminUserDeletionError } = await import("@/lib/server/admin-user-deletion-service");
        mocks.deleteAdminUserWithMediaCleanup.mockRejectedValue(new AdminUserDeletionError("请先删除该用户的声音档案", 409));

        const response = await DELETE(request("DELETE"), context());

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ code: 409, data: null, msg: "请先删除该用户的声音档案" });
    });

    it("rejects absolute balance changes outside the points ledger", async () => {
        const response = await PATCH(request("PATCH", { settledBalance: "1" }), context());

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ code: 400, data: null, msg: "请前往积分账务按增加或扣减调整余额" });
        expect(mocks.updateUserByAdmin).not.toHaveBeenCalled();
    });
});

function request(method: string, body?: unknown) {
    return new Request("http://localhost/api/admin/users/user-one", {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
}

function context() {
    return { params: Promise.resolve({ id: "user-one" }) };
}
