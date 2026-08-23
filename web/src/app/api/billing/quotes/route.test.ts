import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), readJsonBody: vi.fn(), quoteTopUpOrder: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/server/top-up-commerce-service", () => ({ quoteTopUpOrder: mocks.quoteTopUpOrder }));

import { POST } from "./route";

describe("POST /api/billing/quotes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        mocks.readJsonBody.mockResolvedValue({ customAmountVnd: "250000", userCouponId: "coupon-one" });
        mocks.quoteTopUpOrder.mockResolvedValue({ quote: { payableNativeAmount: "200000", creditAmount: "10" } });
    });

    it("quotes against the authenticated user's coupon", async () => {
        const response = await POST(new Request("http://localhost/api/billing/quotes", { method: "POST" }));
        expect(response.status).toBe(200);
        expect(mocks.quoteTopUpOrder).toHaveBeenCalledWith({ customAmountVnd: "250000", userCouponId: "coupon-one", userId: "user-one" });
        expect(await response.json()).toMatchObject({ code: 0, data: { quote: { payableNativeAmount: "200000", creditAmount: "10" } } });
    });
});
