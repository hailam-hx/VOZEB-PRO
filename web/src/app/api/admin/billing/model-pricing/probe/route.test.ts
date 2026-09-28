import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), probeAdminDflopModelCapability: vi.fn(), safeRecordAuditLog: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-model-pricing-service", () => ({ probeAdminDflopModelCapability: mocks.probeAdminDflopModelCapability }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "finance" })), safeRecordAuditLog: mocks.safeRecordAuditLog }));

import { POST } from "./route";

describe("admin model capability probe route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.probeAdminDflopModelCapability.mockResolvedValue({ model: { id: "gpt-6" }, probe: { outcome: "unsupported" } });
    });

    it("requires both billing and upstream management permissions", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "finance", role: "admin", status: "active", adminPermissions: ["billing.manage"] });

        const response = await POST(new Request("http://localhost/api/admin/billing/model-pricing/probe", { method: "POST", body: JSON.stringify({ modelId: "gpt-6", bindingId: "dflop:gpt-6" }) }));

        expect(response.status).toBe(403);
        expect(mocks.probeAdminDflopModelCapability).not.toHaveBeenCalled();
    });

    it("runs one explicit probe and records a bounded audit entry", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.manage", "upstream.manage"] });
        const body = { modelId: "gpt-6", bindingId: "dflop:gpt-6" };

        const response = await POST(new Request("http://localhost/api/admin/billing/model-pricing/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

        expect(mocks.probeAdminDflopModelCapability).toHaveBeenCalledWith(body);
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.billing.provider_capability.probe", metadata: expect.not.objectContaining({ apiKey: expect.anything() }) }));
        expect(await response.json()).toMatchObject({ code: 0, data: { probe: { outcome: "unsupported" } } });
    });
});
