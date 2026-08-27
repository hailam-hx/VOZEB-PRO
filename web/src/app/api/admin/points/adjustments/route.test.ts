import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    adjustAdminPointBalance: vi.fn(),
    safeRecordAuditLog: vi.fn(),
    auditActorFromRequest: vi.fn(() => ({ userId: "admin-one", username: "finance" })),
    isAuthInputError: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ isAuthInputError: mocks.isAuthInputError }));
vi.mock("@/lib/server/admin-points-service", () => ({ adjustAdminPointBalance: mocks.adjustAdminPointBalance }));
vi.mock("@/lib/server/audit-log-store", () => ({ safeRecordAuditLog: mocks.safeRecordAuditLog, auditActorFromRequest: mocks.auditActorFromRequest }));

import { POST } from "./route";

describe("admin points adjustment route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isAuthInputError.mockReturnValue(false);
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.manage"] });
        mocks.adjustAdminPointBalance.mockResolvedValue({
            applied: true,
            record: { id: "record-one", userId: "user-one", operatorUserId: "admin-one", type: "admin-adjust", amount: "-1.25", balanceAfter: "8.75", description: "冲正", createdAt: "2026-08-26T00:00:00.000Z" },
            snapshot: { settledBalance: "8.75", heldBalance: "2", availableBalance: "6.75" },
        });
    });

    it("requires an authenticated administrator", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);

        const response = await POST(request({ userId: "user-one", operation: "increase", amount: "1", reason: "补偿", requestId: "request-unauthorized" }));

        expect(response.status).toBe(401);
        expect(mocks.adjustAdminPointBalance).not.toHaveBeenCalled();
        expect(mocks.safeRecordAuditLog).not.toHaveBeenCalled();
    });

    it("applies a delta with the current administrator and records an audit event", async () => {
        const response = await POST(request({ userId: "user-one", operation: "decrease", amount: "1.25", reason: "冲正", requestId: "request-0001" }));

        expect(response.status).toBe(200);
        expect(mocks.adjustAdminPointBalance).toHaveBeenCalledWith({ actorUserId: "admin-one", targetUserId: "user-one", operation: "decrease", amount: "1.25", reason: "冲正", requestId: "request-0001" });
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: "admin.points.adjust",
                target: { type: "user", id: "user-one" },
                metadata: expect.objectContaining({ pointRecordId: "record-one", operation: "decrease", amount: "1.25", balanceAfter: "8.75", reason: "冲正" }),
            }),
        );
        expect(await response.json()).toMatchObject({ code: 0, data: { applied: true, snapshot: { availableBalance: "6.75" } }, msg: "" });
    });

    it("does not let a finance reader mutate balances", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.read"] });

        const response = await POST(request({ userId: "user-one", operation: "increase", amount: "1", reason: "补偿", requestId: "request-0002" }));

        expect(response.status).toBe(403);
        expect(mocks.adjustAdminPointBalance).not.toHaveBeenCalled();
    });

    it("returns a domain conflict and audits the failed adjustment", async () => {
        const conflict = Object.assign(new Error("扣减后结算余额不能低于当前预留积分"), { status: 409 });
        mocks.adjustAdminPointBalance.mockRejectedValueOnce(conflict);
        mocks.isAuthInputError.mockImplementation((error) => error === conflict);

        const response = await POST(request({ userId: "user-one", operation: "decrease", amount: "9", reason: "冲正", requestId: "request-0003" }));

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ code: 409, data: null, msg: "扣减后结算余额不能低于当前预留积分" });
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.points.adjust", status: "failure", metadata: expect.objectContaining({ reason: "冲正", error: "扣减后结算余额不能低于当前预留积分" }) }));
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/admin/points/adjustments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
