import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getAdminModelPricing: vi.fn(), saveAdminModelPricing: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-model-pricing-service", () => ({ getAdminModelPricing: mocks.getAdminModelPricing, saveAdminModelPricing: mocks.saveAdminModelPricing }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "finance" })), safeRecordAuditLog: vi.fn() }));

import { GET, PATCH } from "./route";

describe("admin model pricing route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAdminModelPricing.mockResolvedValue({ models: [{ id: "image-pro" }] });
        mocks.saveAdminModelPricing.mockResolvedValue({ model: { id: "image-pro", name: "Image Pro", capability: "image", enabled: true, saleRateCard: { version: 1, components: [] }, bindings: [] } });
    });

    it("allows a finance administrator to read and edit pricing without upstream-management permission", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "finance", role: "admin", status: "active", adminPermissions: ["billing.read", "billing.manage"] });
        const getResponse = await GET();
        const body = { modelId: "image-pro", saleRateCard: { version: 1, components: [{ id: "count", dimension: "count", unitPrice: "2.5" }] }, bindings: [] };
        const patchResponse = await PATCH(new Request("http://localhost/api/admin/billing/model-pricing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

        expect(await getResponse.json()).toEqual({ code: 0, data: { models: [{ id: "image-pro" }] }, msg: "" });
        expect(mocks.saveAdminModelPricing).toHaveBeenCalledWith(body);
        expect(await patchResponse.json()).toMatchObject({ code: 0, data: { model: { id: "image-pro" } }, msg: "模型计价已保存" });
    });

    it("does not grant pricing edits to an upstream-only administrator", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "upstream", role: "admin", status: "active", adminPermissions: ["upstream.manage"] });

        expect((await PATCH(new Request("http://localhost/api/admin/billing/model-pricing", { method: "PATCH", body: "{}" }))).status).toBe(403);
        expect(mocks.saveAdminModelPricing).not.toHaveBeenCalled();
    });
});
