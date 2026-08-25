import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminUser, deleteAdminUser, listAdminUsers, updateAdminUser } from "./admin-users";

describe("admin users envelope client", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("reads collection and mutation data from the shared response envelope", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(response({ code: 0, data: { users: [{ id: "user-one" }], total: 1, page: 1, pageSize: 20, summary: { total: 1 }, currentUser: { id: "admin" } }, msg: "" }))
            .mockResolvedValueOnce(response({ code: 0, data: { user: { id: "user-one", displayName: "更新后" } }, msg: "" }))
            .mockResolvedValueOnce(response({ code: 0, data: { user: { id: "user-two" } }, msg: "" }))
            .mockResolvedValueOnce(response({ code: 0, data: { ok: true }, msg: "" }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(listAdminUsers({ page: 1, pageSize: 20 })).resolves.toMatchObject({ users: [{ id: "user-one" }], total: 1 });
        await expect(updateAdminUser("user-one", { displayName: "更新后" })).resolves.toMatchObject({ id: "user-one", displayName: "更新后" });
        await expect(createAdminUser({ username: "user-two", password: "password123" })).resolves.toMatchObject({ id: "user-two" });
        await expect(deleteAdminUser("user-two")).resolves.toEqual({ ok: true });
    });

    it("uses the envelope message for a domain conflict", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => response({ code: 409, data: null, msg: "结算余额不能低于当前预留积分" }, 409)),
        );

        await expect(updateAdminUser("user-one", { settledBalance: "1" })).rejects.toThrow("结算余额不能低于当前预留积分");
    });
});

function response(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
