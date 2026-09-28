import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/video-validation-service", () => ({ previewVideoValidation: mocks.preview, VideoValidationServiceError: class extends Error {} }));

import { POST } from "./route";

describe("POST /api/admin/video-validation/preview", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.read", "upstream.manage"] });
        mocks.preview.mockResolvedValue({ revision: "preview" });
    });
    it("requires both read and upstream permissions", async () => {
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin", status: "active", adminPermissions: ["generation.read"] });
        expect((await POST(request())).status).toBe(403);
    });
    it("passes only the validated command to the service", async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(mocks.preview).toHaveBeenCalledWith({ mode: "family_sample", maxBudgetHotxCredits: "2", concurrency: 1, readyPricingOnly: true, modelIds: ["video"] });
    });
});

function request() {
    return new Request("http://localhost/api/admin/video-validation/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "family_sample", maxBudgetHotxCredits: "2", concurrency: 1, readyPricingOnly: true, modelIds: ["video"] }),
    });
}
