import { expect, test } from "@playwright/test";

import { expectDialogWithinViewport, expectNoHorizontalOverflow } from "./responsive-helpers";

const user = {
    value: "internal-user-seven",
    accountId: "0007",
    username: "ledger_user",
    displayName: "测试用户",
    status: "active",
    settledBalance: "12.5",
    heldBalance: "2",
    availableBalance: "10.5",
};

test("administrator filters, previews and retries a point adjustment with one request ID", async ({ page }, testInfo) => {
    let adjustmentAttempts = 0;
    const requestIds: string[] = [];
    const ledgerQueries: string[] = [];
    await page.route(/\/api\/admin\/points\?(?!.*\/users)/, async (route) => {
        ledgerQueries.push(route.request().url());
        const adjusted = adjustmentAttempts > 1;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                code: 0,
                data: {
                    items: [
                        {
                            id: adjusted ? "adjusted-record" : "opening-record",
                            type: adjusted ? "admin-adjust" : "credit",
                            amount: adjusted ? "1.25" : "12.5",
                            balanceAfter: adjusted ? "13.75" : "12.5",
                            description: adjusted ? "E2E 客服补偿" : "充值",
                            createdAt: "2026-08-25T09:30:00.000Z",
                            user: { accountId: "0007", username: "ledger_user", displayName: "测试用户", status: "active" },
                            operator: adjusted ? { accountId: "0001", username: "e2e_admin", displayName: "E2E 管理员", status: "active" } : undefined,
                        },
                    ],
                    total: 21,
                    page: Number(new URL(route.request().url()).searchParams.get("page") || 1),
                    pageSize: 20,
                    summary: { settledBalance: adjusted ? "13.75" : "12.5", heldBalance: "2", availableBalance: adjusted ? "11.75" : "10.5", recordCount: adjusted ? 2 : 1 },
                },
                msg: "",
            }),
        });
    });
    await page.route(/\/api\/admin\/points\/users(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { users: [user], total: 1, page: 1, pageSize: 20 }, msg: "" }) }));
    await page.route(/\/api\/admin\/points\/adjustments$/, async (route) => {
        adjustmentAttempts += 1;
        const body = route.request().postDataJSON() as { requestId: string };
        requestIds.push(body.requestId);
        if (adjustmentAttempts === 1) {
            await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, data: null, msg: "模拟网络失败" }) });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ code: 0, data: { applied: true, record: { id: "adjusted-record", amount: "1.25", balanceAfter: "13.75" }, snapshot: { settledBalance: "13.75", heldBalance: "2", availableBalance: "11.75" } }, msg: "" }),
        });
    });

    const dark = testInfo.project.name === "mobile-430";
    const mobile = (page.viewportSize()?.width || 0) < 768;
    await page.addInitScript((theme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme }, version: 0 })), dark ? "dark" : "light");
    await page.goto("/admin?section=points", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
    if (dark) await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(mobile ? page.locator("article").getByText("测试用户", { exact: true }) : page.getByRole("table").getByText("测试用户", { exact: true })).toBeVisible();
    await page.getByLabel("流水类型").click();
    await page.locator(".ant-select-dropdown").getByText("管理员调整", { exact: true }).click();
    await expect.poll(() => ledgerQueries.some((url) => new URL(url).searchParams.get("type") === "admin-adjust")).toBe(true);

    await page.getByRole("button", { name: "调整积分" }).click();
    const dialog = page.getByRole("dialog", { name: "调整积分" });
    await expectDialogWithinViewport(dialog);
    await dialog.getByLabel("搜索昵称、用户名或账号 ID").click();
    await page.locator(".ant-select-dropdown:visible").getByText("测试用户", { exact: true }).click();
    await dialog.getByLabel("积分数量").fill("1.25");
    await dialog.getByLabel("调整原因").fill("E2E 客服补偿");
    await expect(dialog.getByText("13.75", { exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "确认增加" }).click();
    await expect(page.getByText("模拟网络失败", { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认增加" }).click();
    await expect(dialog).toBeHidden();
    const adjustedReason = mobile ? page.locator("article").getByText("E2E 客服补偿", { exact: true }) : page.getByRole("table").getByText("E2E 客服补偿", { exact: true });
    await expect(adjustedReason).toBeVisible();
    await expect(page.locator("body")).not.toContainText("internal-user-seven");

    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
    expect(requestIds[0]).toBeTruthy();
    await expectNoHorizontalOverflow(page, "admin points ledger desktop");
});
