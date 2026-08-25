import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getTopUpFinancialSummary: vi.fn(),
    isBillingInputError: vi.fn(() => false),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/top-up-reporting", () => ({ getTopUpFinancialSummary: mocks.getTopUpFinancialSummary }));
vi.mock("@/lib/server/billing-errors", () => ({ isBillingInputError: mocks.isBillingInputError }));

import { GET } from "./route";

describe("admin billing summary route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTopUpFinancialSummary.mockResolvedValue({ currencies: [{ currency: "VND", paidNativeAmount: "250000", refundedNativeAmount: "0", paidOrders: 1, refundedOrders: 0 }], paidUsdValue: "10", refundedUsdValue: "0", nominalUsdValue: "10" });
    });

    it("requires an administrator", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });

        const response = await GET(new NextRequest("http://localhost/api/admin/billing/summary"));

        expect(response.status).toBe(403);
        expect(mocks.getTopUpFinancialSummary).not.toHaveBeenCalled();
    });

    it("passes an optional date window to the summary service", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.read"] });

        const response = await GET(new NextRequest("http://localhost/api/admin/billing/summary?startDate=2026-07-01&endDate=2026-07-31"));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.getTopUpFinancialSummary).toHaveBeenCalledWith({ startDate: "2026-07-01", endDate: "2026-07-31" });
        expect(payload.data.summary.paidUsdValue).toBe("10");
    });
});
