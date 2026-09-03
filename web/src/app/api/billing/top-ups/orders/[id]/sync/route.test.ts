import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), syncTopUpOrderForUser: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ userId: "user-one" })), safeRecordAuditLog: mocks.audit }));
vi.mock("@/lib/server/top-up-payment-sync-service", () => ({ syncTopUpOrderForUser: mocks.syncTopUpOrderForUser }));

import { POST } from "./route";

describe("top-up payment sync route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.syncTopUpOrderForUser.mockResolvedValue({ order: { id: "order-one", orderNo: "VZ001", provider: "zalopay", status: "paid" }, syncStatus: "paid" });
    });

    it("syncs only the local order id for the current user", async () => {
        const request = new Request("http://localhost/api/billing/top-ups/orders/order-one/sync", { method: "POST" });
        const response = await POST(request, { params: Promise.resolve({ id: "order-one" }) });

        expect(mocks.syncTopUpOrderForUser).toHaveBeenCalledWith("user-one", "order-one");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ code: 0, data: { order: expect.objectContaining({ id: "order-one", status: "paid" }), syncStatus: "paid" }, msg: "" });
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("key");
    });

    it("rejects unauthenticated synchronization", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);

        const response = await POST(new Request("http://localhost/api/billing/top-ups/orders/order-one/sync", { method: "POST" }), { params: Promise.resolve({ id: "order-one" }) });

        expect(response.status).toBe(401);
        expect(mocks.syncTopUpOrderForUser).not.toHaveBeenCalled();
    });
});
