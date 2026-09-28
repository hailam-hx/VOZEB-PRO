import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/video-validation-service", () => ({ cancelVideoValidationRun: mocks.cancel }));

import { POST } from "./route";

describe("POST cancel video validation run", () => {
    beforeEach(() => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.manage", "upstream.manage"] });
        mocks.cancel.mockResolvedValue({ run: { id: "run", status: "cancelled" }, items: [] });
    });
    it("requires both manage permissions", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.manage"] });
        expect((await POST(new Request("http://localhost"), { params: Promise.resolve({ runId: "run" }) })).status).toBe(403);
    });
    it("requests server-side cancellation", async () => {
        expect((await POST(new Request("http://localhost"), { params: Promise.resolve({ runId: "run" }) })).status).toBe(200);
        expect(mocks.cancel).toHaveBeenCalledWith("run", "admin");
    });
});
