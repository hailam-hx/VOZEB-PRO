import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), authorized: vi.fn(), compatible: vi.fn(), install: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/server/maintenance-auth", () => ({ isWorkerTokenConfigured: mocks.configured, isAuthorizedWorkerRequest: mocks.authorized }));
vi.mock("@/lib/server/generation-worker-compatibility", () => ({ isGenerationWorkerCompatible: mocks.compatible, readGenerationWorkerCompatibility: vi.fn(() => ({})) }));
vi.mock("@/lib/server/install-status", () => ({ getInstallStatus: mocks.install }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://127.0.0.1:3000") }));
vi.mock("@/lib/server/video-validation-worker", () => ({ processVideoValidationBatch: mocks.process }));

import { POST } from "./route";

describe("video validation maintenance route", () => {
    beforeEach(() => {
        mocks.configured.mockReturnValue(true);
        mocks.authorized.mockReturnValue(true);
        mocks.compatible.mockReturnValue(true);
        mocks.install.mockResolvedValue({ database: { schemaReady: true } });
        mocks.process.mockResolvedValue({ claimed: 1, processed: 1, skippedBudget: 0 });
    });
    it("requires the worker token", async () => {
        mocks.authorized.mockReturnValue(false);
        expect((await POST(request())).status).toBe(401);
    });
    it("runs one bounded item on the existing worker lane", async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(mocks.process).toHaveBeenCalledWith({ origin: "http://127.0.0.1:3000", workerId: "lane-1", limit: 1 });
    });
});

function request() {
    return new Request("http://localhost/api/maintenance/video-validation/run", { method: "POST", headers: { "x-vozeb-pro-worker-id": "lane-1" } });
}
