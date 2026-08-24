import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), readJsonBody: vi.fn(), createTopUpOrder: vi.fn(), listTopUpOrdersForUser: vi.fn(), safeRecordAuditLog: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/server/top-up-commerce-service", () => ({ createTopUpOrder: mocks.createTopUpOrder, listTopUpOrdersForUser: mocks.listTopUpOrdersForUser }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: mocks.safeRecordAuditLog }));

import { POST } from "./route";

describe("POST /api/billing/top-ups/orders", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one", role: "user" });
        mocks.readJsonBody.mockResolvedValue({ presetId: "starter", provider: "stripe" });
        mocks.createTopUpOrder.mockResolvedValue({ id: "order-one", orderNo: "VZ1", presetId: "starter", provider: "stripe", paymentAmount: { kind: "fiat", currency: "VND", amountMinor: "250000", minorUnitExponent: 0 }, currency: "VND" });
    });

    it("passes only checkout selection fields plus the authenticated user", async () => {
        const response = await POST(new Request("http://localhost/api/billing/top-ups/orders", { method: "POST" }));

        expect(response.status).toBe(201);
        expect(mocks.createTopUpOrder).toHaveBeenCalledWith({ presetId: "starter", provider: "stripe", userId: "user-one" });
    });

    it.each(["creditAmount", "customerFx", "currencyExponent", "nominalUsdValue", "paidUsdValue", "pricingVersion", "paymentAmount", "costUsd", "marginUsd"])("rejects forged server-authoritative %s", async (field) => {
        mocks.readJsonBody.mockResolvedValue({ presetId: "starter", provider: "stripe", [field]: field === "currencyExponent" ? 2 : "forged" });

        const response = await POST(new Request("http://localhost/api/billing/top-ups/orders", { method: "POST" }));

        expect(response.status).toBe(400);
        expect(mocks.createTopUpOrder).not.toHaveBeenCalled();
    });
});
