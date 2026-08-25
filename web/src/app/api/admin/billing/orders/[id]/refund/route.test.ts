import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    refundTopUpOrder: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ isAuthInputError: vi.fn((error) => Boolean(error && typeof error === "object" && "authStatus" in error)) }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "admin-one" })), safeRecordAuditLog: mocks.audit }));
vi.mock("@/lib/server/top-up-refund-service", () => ({ refundTopUpOrder: mocks.refundTopUpOrder }));
vi.mock("@/lib/server/billing-errors", () => ({ isBillingInputError: vi.fn(() => false) }));

import { POST } from "./route";

describe("POST /api/admin/billing/orders/:id/refund", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.manage"] });
        mocks.refundTopUpOrder.mockResolvedValue({ orderId: "order-one", applied: true, recoveredCreditAmount: "10" });
    });

    it("passes only refund fields to the billing service", async () => {
        const response = await POST(request({ reason: "用户申请", rawPayload: { unexpected: "nested-value" } }), context());

        expect(response.status).toBe(200);
        expect(mocks.refundTopUpOrder).toHaveBeenCalledWith("order-one", { kind: "full", reason: "用户申请", operatorUserId: "admin-one" });
        expect(JSON.stringify(mocks.refundTopUpOrder.mock.calls)).not.toContain("nested-value");
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/admin/billing/orders/order-one/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function context() {
    return { params: Promise.resolve({ id: "order-one" }) };
}
