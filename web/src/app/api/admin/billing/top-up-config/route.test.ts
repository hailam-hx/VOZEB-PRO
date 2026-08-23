import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), getConfig: vi.fn(), saveConfig: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/payment-config-store", () => ({ getPaymentRuntimeConfig: mocks.getConfig, saveTopUpPricingConfig: mocks.saveConfig }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: mocks.audit }));

import { GET, PATCH } from "./route";

describe("admin top-up pricing API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.read", "billing.manage"] });
        mocks.getConfig.mockResolvedValue({ topUp: { pricingVersion: "v1", customerFxVersion: "fx1", usdPerVnd: "0.00004" } });
        mocks.saveConfig.mockResolvedValue({ topUp: { pricingVersion: "v2", customerFxVersion: "fx2", usdPerVnd: "0.000041" } });
    });

    it("reads and saves server-owned exact pricing snapshots", async () => {
        expect(await (await GET()).json()).toMatchObject({ code: 0, data: { config: { pricingVersion: "v1" } } });
        const response = await PATCH(new Request("http://local/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pricingVersion: "v2", customerFxVersion: "fx2", usdPerVnd: "0.000041" }) }));
        expect(await response.json()).toMatchObject({ code: 0, data: { config: { pricingVersion: "v2", usdPerVnd: "0.000041" } } });
        expect(mocks.audit).toHaveBeenCalledOnce();
    });
});
