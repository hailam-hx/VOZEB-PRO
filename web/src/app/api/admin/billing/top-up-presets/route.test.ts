import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), list: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/top-up-commerce-service", () => ({ listTopUpPresets: mocks.list, saveTopUpPreset: mocks.save }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: mocks.audit }));

import { GET, POST } from "./route";

describe("admin top-up preset API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["billing.read", "billing.manage"] });
    });

    it("lists and saves presets through the commerce envelope", async () => {
        mocks.list.mockResolvedValue([{ id: "starter" }]);
        mocks.save.mockResolvedValue({ id: "starter", nominalNativeAmount: "250000" });
        expect(await (await GET()).json()).toEqual({ code: 0, data: { presets: [{ id: "starter" }] }, msg: "" });
        const response = await POST(new Request("http://local/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "starter", nominalNativeAmount: "250000" }) }));
        expect(await response.json()).toMatchObject({ code: 0, data: { preset: { id: "starter" } } });
        expect(mocks.audit).toHaveBeenCalledOnce();
    });
});
