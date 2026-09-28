import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), start: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/video-validation-service", () => ({ startVideoValidationRun: mocks.start, listVideoValidationRuns: mocks.list, VideoValidationServiceError: class extends Error {} }));

import { GET, POST } from "./route";

describe("admin video validation runs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.read", "generation.manage", "upstream.manage"] });
        mocks.start.mockResolvedValue({ run: { id: "run" } });
        mocks.list.mockResolvedValue({ items: [], total: 0 });
    });
    it("requires manage permission to create", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.read", "upstream.manage"] });
        expect((await POST(startRequest())).status).toBe(403);
    });
    it("starts from ids and preview revision without accepting upstream payload", async () => {
        const response = await POST(startRequest());
        expect(response.status).toBe(200);
        expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ previewRevision: "preview" }), "admin");
    });
    it("lists with bounded pagination", async () => {
        await GET(new Request("http://localhost/api/admin/video-validation/runs?page=2&pageSize=999"));
        expect(mocks.list).toHaveBeenCalledWith({ page: 2, pageSize: 100 });
    });
});

function startRequest() {
    return new Request("http://localhost/api/admin/video-validation/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewRevision: "preview", mode: "family_sample", maxBudgetHotxCredits: "2", concurrency: 1, readyPricingOnly: true }),
    });
}
