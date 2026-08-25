import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    recoverOrphanUsageHolds: vi.fn(),
    inspectPersistedUsageHold: vi.fn(),
    safeRecordAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ recoverOrphanUsageHolds: mocks.recoverOrphanUsageHolds, inspectPersistedUsageHold: mocks.inspectPersistedUsageHold }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "admin" })), safeRecordAuditLog: mocks.safeRecordAuditLog }));

import { POST } from "./route";

describe("admin usage recovery route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAuthSettings.mockResolvedValue({ dataLifecycle: { maintenanceBatchSize: 50 } });
        mocks.recoverOrphanUsageHolds.mockResolvedValue({ inspected: 2, retained: 0, settled: 1, released: 1, needsReview: 0 });
    });

    it("requires billing management permission", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.read"] });

        const response = await POST(new Request("http://localhost/api/admin/billing/usage/recovery", { method: "POST" }));

        expect(response.status).toBe(403);
        expect(mocks.recoverOrphanUsageHolds).not.toHaveBeenCalled();
    });

    it("reuses the bounded worker recovery and persisted task inspector", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.manage"] });

        const response = await POST(new Request("http://localhost/api/admin/billing/usage/recovery", { method: "POST" }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.recoverOrphanUsageHolds).toHaveBeenCalledWith({ limit: 50, inspect: mocks.inspectPersistedUsageHold });
        expect(payload).toEqual({ code: 0, data: { inspected: 2, retained: 0, settled: 1, released: 1, needsReview: 0 }, msg: "已检查 2 个用量预留" });
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.usage_hold.recover", metadata: payload.data }));
    });
});
