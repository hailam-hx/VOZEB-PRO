import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), get: vi.fn(), rename: vi.fn(), remove: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/voice-profile-store", () => ({ getVoiceProfileForUser: mocks.get, publicVoiceProfile: (profile: unknown) => profile }));
vi.mock("@/lib/server/voice-profile-service", () => ({
    renameVoiceProfile: mocks.rename,
    deleteVoiceProfile: mocks.remove,
    VoiceProfileServiceError: class VoiceProfileServiceError extends Error {
        constructor(
            message: string,
            readonly status = 400,
        ) {
            super(message);
        }
    },
}));

import { DELETE, GET, PATCH } from "./route";

describe("voice profile resource route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one" });
        mocks.get.mockResolvedValue({ id: "profile-one", name: "Voice", status: "ready" });
        mocks.rename.mockResolvedValue({ id: "profile-one", name: "Renamed", status: "ready" });
        mocks.remove.mockResolvedValue({ id: "profile-one", name: "Voice", status: "deleting" });
    });

    it("reads and renames only the current user's profile", async () => {
        const context = { params: Promise.resolve({ id: "profile-one" }) };
        await expect((await GET(new Request("https://vozeb.example/api/voice-profiles/profile-one"), context)).json()).resolves.toMatchObject({ code: 0, data: { profile: { id: "profile-one" } } });
        const renamed = await PATCH(new Request("https://vozeb.example/api/voice-profiles/profile-one", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed" }) }), context);
        await expect(renamed.json()).resolves.toMatchObject({ code: 0, data: { profile: { name: "Renamed" } } });
        expect(mocks.rename).toHaveBeenCalledWith("user-one", "profile-one", "Renamed");
    });

    it("starts deletion without exposing provider identifiers", async () => {
        const response = await DELETE(new Request("https://vozeb.example/api/voice-profiles/profile-one", { method: "DELETE" }), { params: Promise.resolve({ id: "profile-one" }) });
        await expect(response.json()).resolves.toEqual({ code: 0, data: { profile: { id: "profile-one", name: "Voice", status: "deleting" } }, msg: "声音删除已提交" });
        expect(mocks.remove).toHaveBeenCalledWith("user-one", "profile-one");
    });

    it("does not expose infrastructure details from an unexpected delete failure", async () => {
        mocks.remove.mockRejectedValue(new Error("authorization=Bearer-secret at https://provider.example/voice"));

        const response = await DELETE(new Request("https://vozeb.example/api/voice-profiles/profile-one", { method: "DELETE" }), { params: Promise.resolve({ id: "profile-one" }) });

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({ code: 500, msg: "生成渠道暂时无法连接，请稍后重试或联系管理员。" });
    });
});
