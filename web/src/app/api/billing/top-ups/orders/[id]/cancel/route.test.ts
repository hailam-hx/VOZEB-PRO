import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), cancelTopUpOrderForUser: vi.fn(), safeRecordAuditLog: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: mocks.safeRecordAuditLog }));
vi.mock("@/lib/server/top-up-commerce-service", () => ({
    cancelTopUpOrderForUser: mocks.cancelTopUpOrderForUser,
}));
vi.mock("@/lib/server/billing-errors", () => ({
    isBillingInputError: vi.fn((error) => Boolean(error && typeof error === "object" && "status" in error)),
}));

import { POST } from "./route";

describe("POST /api/billing/top-ups/orders/[id]/cancel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user", role: "user" });
        mocks.cancelTopUpOrderForUser.mockResolvedValue({ id: "order", orderNo: "VZ001", status: "canceled" });
    });

    it("cancels the current user's pending order", async () => {
        const response = await POST(new Request("http://localhost/api/billing/top-ups/orders/order/cancel", { method: "POST" }), { params: Promise.resolve({ id: "order" }) });

        expect(response.status).toBe(200);
        expect(mocks.cancelTopUpOrderForUser).toHaveBeenCalledWith("user", "order");
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "top_up.order.cancel" }));
    });
});
