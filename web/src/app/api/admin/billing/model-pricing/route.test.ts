import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getAdminModelPricing: vi.fn(), saveAdminModelPricing: vi.fn(), applySuggestedSalePrices: vi.fn(), safeRecordAuditLog: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/admin-model-pricing-service", () => ({ getAdminModelPricing: mocks.getAdminModelPricing, saveAdminModelPricing: mocks.saveAdminModelPricing, applySuggestedSalePrices: mocks.applySuggestedSalePrices }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "finance" })), safeRecordAuditLog: mocks.safeRecordAuditLog }));

import { GET, PATCH, POST } from "./route";

describe("admin model pricing route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAdminModelPricing.mockResolvedValue({ models: [{ id: "image-pro" }] });
        mocks.saveAdminModelPricing.mockResolvedValue({ model: { id: "image-pro", name: "Image Pro", capability: "image", enabled: true, saleRateCard: { version: 1, components: [] }, bindings: [] } });
        mocks.applySuggestedSalePrices.mockResolvedValue({ applied: [{ modelId: "image-pro" }], skipped: [], batchOperationId: "batch-1", models: [{ id: "image-pro" }] });
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

    it("writes the specific provider override audit action with bounded metadata", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "finance", role: "admin", status: "active", adminPermissions: ["billing.manage"] });
        mocks.saveAdminModelPricing.mockResolvedValue({
            model: { id: "image-pro", bindings: [] },
            audit: {
                action: "admin.billing.provider_price.override",
                metadata: { modelId: "image-pro", bindingId: "binding-one", dimensionId: "image-output", oldValue: "80", newValue: "100", oldSource: "upstream", newSource: "manual", pricingPolicyVersion: "policy-v1", warningCodes: ["PRICING_DRIFT"] },
            },
        });

        await PATCH(
            new Request("http://localhost/api/admin/billing/model-pricing", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ modelId: "image-pro", dimensionCommand: { action: "set_manual", bindingId: "binding-one", dimensionId: "image-output", effectiveValue: "100" } }),
            }),
        );

        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: "admin.billing.provider_price.override",
                metadata: expect.not.objectContaining({ apiKey: expect.anything(), raw: expect.anything() }),
            }),
        );
    });

    it("accepts only preview identities and delegates approval with the authenticated actor", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "finance", username: "finance", role: "admin", status: "active", adminPermissions: ["billing.manage"] });
        const body = { modelIds: ["image-pro"], suggestedRevisions: { "image-pro": "suggested-v1" }, pricingPolicyVersion: "policy-v1" };

        const response = await POST(new Request("http://localhost/api/admin/billing/model-pricing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

        expect(mocks.applySuggestedSalePrices).toHaveBeenCalledWith(body, expect.objectContaining({ id: "finance", username: "finance", role: "admin" }));
        expect(await response.json()).toEqual({ code: 0, data: expect.objectContaining({ batchOperationId: "batch-1" }), msg: "建议售价已应用：1 个，跳过：0 个" });
        expect(mocks.safeRecordAuditLog).not.toHaveBeenCalled();
    });
});
