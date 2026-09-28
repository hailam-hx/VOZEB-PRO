import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getRun: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/video-validation-service", () => ({ getVideoValidationRun: mocks.getRun }));

import { GET } from "./route";

describe("GET video validation run", () => {
    beforeEach(() => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.read", "upstream.manage"] });
        mocks.getRun.mockResolvedValue({ run: { id: "run" }, items: [] });
    });
    it("returns a bounded server-owned detail", async () => {
        const response = await GET(new Request("http://localhost/api/admin/video-validation/runs/run"), { params: Promise.resolve({ runId: "run" }) });
        expect(response.status).toBe(200);
        expect(mocks.getRun).toHaveBeenCalledWith("run");
    });
    it("returns 404 for an unknown run", async () => {
        mocks.getRun.mockResolvedValue(null);
        expect((await GET(new Request("http://localhost/api/admin/video-validation/runs/missing"), { params: Promise.resolve({ runId: "missing" }) })).status).toBe(404);
    });
});
