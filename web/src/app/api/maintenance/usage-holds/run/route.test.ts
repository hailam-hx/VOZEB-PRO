import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), authorized: vi.fn(), settings: vi.fn(), recover: vi.fn(), inspect: vi.fn() }));

vi.mock("@/lib/server/maintenance-auth", () => ({ isWorkerTokenConfigured: mocks.configured, isAuthorizedWorkerRequest: mocks.authorized }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ recoverOrphanUsageHolds: mocks.recover, inspectPersistedUsageHold: mocks.inspect }));

import { POST } from "./route";

describe("POST /api/maintenance/usage-holds/run", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.configured.mockReturnValue(true);
        mocks.authorized.mockReturnValue(true);
        mocks.settings.mockResolvedValue({ dataLifecycle: { maintenanceBatchSize: 37 } });
        mocks.recover.mockResolvedValue({ inspected: 0, retained: 0, settled: 0, released: 0 });
    });

    it("requires a separately configured worker token", async () => {
        mocks.configured.mockReturnValue(false);
        const response = await POST(request());
        expect(response.status).toBe(503);
        expect(mocks.recover).not.toHaveBeenCalled();
    });

    it("requires worker authentication", async () => {
        mocks.authorized.mockReturnValue(false);
        const response = await POST(request());
        expect(response.status).toBe(401);
        expect(mocks.recover).not.toHaveBeenCalled();
    });

    it("uses the configured bounded batch and the persisted-state inspector", async () => {
        mocks.recover.mockResolvedValue({ inspected: 2, retained: 1, settled: 1, released: 0 });
        const response = await POST(request());

        expect(mocks.recover).toHaveBeenCalledWith({ limit: 37, inspect: mocks.inspect });
        expect(await response.json()).toEqual({ code: 0, data: { inspected: 2, retained: 1, settled: 1, released: 0 }, msg: "已检查 2 个用量预留" });
    });
});

function request() {
    return new Request("http://localhost/api/maintenance/usage-holds/run", { method: "POST", headers: { authorization: "Bearer worker-token" } });
}
