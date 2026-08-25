import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), findUsers: vi.fn(), getUsers: vi.fn(), listOrders: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ findPublicUserIdsByKeyword: mocks.findUsers, getPublicUsersByIds: mocks.getUsers }));
vi.mock("@/lib/server/top-up-commerce-service", () => ({ listAdminTopUpOrders: mocks.listOrders }));

import { GET } from "./route";

describe("admin top-up orders API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "admin-one", role: "admin", status: "active", adminPermissions: ["billing.read"] });
        mocks.findUsers.mockResolvedValue(["user-one"]);
        mocks.listOrders.mockResolvedValue({ items: [{ id: "order-one", userId: "user-one", orderNo: "VZ1" }], total: 1, page: 1, pageSize: 20 });
        mocks.getUsers.mockResolvedValue([{ id: "user-one", accountId: "0001", username: "creator", displayName: "创作者" }]);
    });

    it("resolves a public account ID search and projects public identity fields", async () => {
        const response = await GET(new NextRequest("http://localhost/api/admin/billing/orders?keyword=0001"));

        expect(mocks.findUsers).toHaveBeenCalledWith("0001", 2);
        expect(mocks.listOrders).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", keyword: undefined }));
        expect(await response.json()).toMatchObject({
            code: 0,
            data: { orders: [{ id: "order-one", user: { accountId: "0001", username: "creator", displayName: "创作者" } }] },
        });
    });
});
