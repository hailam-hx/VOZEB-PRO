import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), receive: vi.fn(), close: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "admin-one" })), safeRecordAuditLog: mocks.audit }));
vi.mock("@/lib/server/top-up-admin-order-service", () => ({ receiveManualTopUpOrder: mocks.receive, closeManualTopUpOrder: mocks.close }));

import { POST as closeOrder } from "./close/route";
import { POST as receiveOrder } from "./receive/route";

describe("admin manual top-up order action routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.manage"] });
        mocks.receive.mockResolvedValue({ orderId: "order-one", orderNo: "VZ001", applied: true, duplicate: false, creditAmount: "10" });
        mocks.close.mockResolvedValue({ orderId: "order-one", orderNo: "VZ001", applied: true, duplicate: false });
    });

    it("confirms manual receipt with billing management permission and audits the result", async () => {
        const response = await receiveOrder(request("receive"), context());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ code: 0, data: { orderId: "order-one", orderNo: "VZ001", applied: true, duplicate: false, creditAmount: "10" }, msg: "收款已确认" });
        expect(mocks.receive).toHaveBeenCalledWith("order-one", "admin-one");
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.billing.order.receive", status: "success", target: { type: "top_up_order", id: "order-one" } }));
    });

    it("closes a pending manual order without calling payment settlement and audits the result", async () => {
        const response = await closeOrder(request("close"), context());

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ code: 0, data: { orderId: "order-one", orderNo: "VZ001", applied: true, duplicate: false }, msg: "订单已关闭" });
        expect(mocks.close).toHaveBeenCalledWith("order-one");
        expect(mocks.receive).not.toHaveBeenCalled();
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.billing.order.close", status: "success", target: { type: "top_up_order", id: "order-one" } }));
    });

    it("rejects both mutations without billing management permission", async () => {
        mocks.currentUser.mockResolvedValue({ id: "viewer", role: "admin", status: "active", adminPermissions: ["billing.read"] });

        expect((await receiveOrder(request("receive"), context())).status).toBe(403);
        expect((await closeOrder(request("close"), context())).status).toBe(403);
        expect(mocks.receive).not.toHaveBeenCalled();
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("records a failure audit when receipt confirmation fails", async () => {
        mocks.receive.mockRejectedValue(new Error("settlement failed"));

        const response = await receiveOrder(request("receive"), context());

        expect(response.status).toBe(500);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.billing.order.receive", status: "failure", metadata: { error: "settlement failed" } }));
    });
});

function request(action: string) {
    return new Request(`http://localhost/api/admin/billing/orders/order-one/${action}`, { method: "POST" });
}

function context() {
    return { params: Promise.resolve({ id: "order-one" }) };
}
