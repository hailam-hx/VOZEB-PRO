import { expect, test, type Page } from "@playwright/test";

import { expectDialogWithinViewport, expectNoHorizontalOverflow, expectVisibleControlsWithinViewport } from "./responsive-helpers";

test.describe.configure({ mode: "serial" });

test("generation operations keeps the request, failure and planner route timeline visible", async ({ page }, testInfo) => {
    const themes = testInfo.project.name === "chromium" ? (["light", "dark"] as const) : ([testInfo.project.name === "mobile-430" ? "dark" : "light"] as const);
    await page.route(/\/api\/admin\/generation-operations\?/, (route) =>
        route.fulfill({
            json: {
                code: 0,
                data: generationOperationsFixture(),
                msg: "OK",
            },
        }),
    );

    for (const theme of themes) {
        await setTheme(page, theme);
        await page.goto("/admin?section=generationOperations", { waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
        const taskSurface = (page.viewportSize()?.width || 1280) < 768 ? page.getByRole("article") : page.getByRole("table");
        await expect(taskSurface.getByText("写剧本一个女跳舞", { exact: true })).toBeVisible();
        await expect(taskSurface.getByText("失败原因", { exact: true }).locator("..").getByText("文本模型返回了无效 JSON", { exact: true })).toBeVisible();
        await expect(taskSurface.getByText("gpt-5.6-sol · dflop-openai → gpt-6-astra", { exact: true })).toBeVisible();
        await expect(taskSurface.getByText("第 1 轮 · 尝试 2 · 备用", { exact: true })).toBeVisible();
        await expect(taskSurface.getByText("已收到响应", { exact: false }).first()).toBeVisible();
        await expectNoHorizontalOverflow(page, `${testInfo.project.name} ${theme} generation operations planner diagnostics`);
        await expectVisibleControlsWithinViewport(page, `${testInfo.project.name} ${theme} generation operations planner diagnostics`);
    }
});

test("logical model routing can move a synchronized cross-name fallback binding", async ({ page, request }, testInfo) => {
    type SettingsSnapshot = {
        logicalModels: Array<{
            id: string;
            name: string;
            capability: string;
            bindings: Array<{ id: string; channelId: string; upstreamModel: string; priority: number }>;
        }>;
        defaultModels: Record<string, string>;
    };

    const beforeResponse = await request.get("/api/admin/settings");
    expect(beforeResponse.ok(), await beforeResponse.text()).toBe(true);
    const before = ((await beforeResponse.json()) as { settings: SettingsSnapshot }).settings;
    const movedBinding = before.logicalModels.find((model) => model.id === "e2e-text-fallback")?.bindings.find((binding) => binding.channelId === "e2e-primary");
    expect(movedBinding).toBeTruthy();

    try {
        await setTheme(page, testInfo.project.name === "mobile-430" ? "dark" : "light");
        await page.goto("/admin?section=channels", { waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
        await page.getByRole("tab", { name: "逻辑模型" }).click();
        await page.getByPlaceholder("搜索模型昵称、ID 或上游模型").fill("e2e-text");

        const targetCard = logicalModelCard(page, "e2e-text");
        await targetCard.getByRole("button", { name: "路由设置" }).click();
        const drawer = page.getByRole("dialog", { name: "模型路由设置" });
        await expect(drawer).toBeVisible();
        await drawer.getByRole("combobox", { name: "选择备用绑定" }).click();
        await page.getByText("e2e-text-fallback · E2E 主渠道 / e2e-text-fallback", { exact: true }).click();
        await drawer.getByRole("button", { name: "添加备用绑定" }).click();
        await page.getByRole("button", { name: "确认移动" }).click();
        await expect(drawer.getByText("e2e-text-fallback", { exact: true })).toBeVisible();
        await drawer.getByRole("button", { name: "应用修改" }).click();
        await expect(page.getByText("模型路由设置已更新，请保存渠道配置")).toBeVisible();

        const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/admin/settings");
        await page.getByRole("button", { name: "保存模型渠道配置" }).click();
        expect((await saved).ok()).toBe(true);
        await expect(page.getByText("模型渠道配置已保存", { exact: true })).toBeVisible();

        const persistedResponse = await request.get("/api/admin/settings");
        expect(persistedResponse.ok(), await persistedResponse.text()).toBe(true);
        const persisted = ((await persistedResponse.json()) as { settings: SettingsSnapshot }).settings;
        expect(persisted.logicalModels.find((model) => model.id === "e2e-text")?.bindings).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: "e2e-primary", upstreamModel: "e2e-text-fallback" })]));
        expect(persisted.logicalModels.find((model) => model.id === "e2e-text-fallback")?.bindings).not.toEqual(expect.arrayContaining([expect.objectContaining({ channelId: "e2e-primary", upstreamModel: "e2e-text-fallback" })]));

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
        await page.getByRole("tab", { name: "逻辑模型" }).click();
        await page.getByPlaceholder("搜索模型昵称、ID 或上游模型").fill("e2e-text");
        await logicalModelCard(page, "e2e-text").getByRole("button", { name: "路由设置" }).click();
        const reloadedDrawer = page.getByRole("dialog", { name: "模型路由设置" });
        await expect(reloadedDrawer.getByText("e2e-text-fallback", { exact: true })).toBeVisible();
        await expectDialogWithinViewport(reloadedDrawer);
        await expectNoHorizontalOverflow(page, `${testInfo.project.name} logical model fallback routing`);
        await expectVisibleControlsWithinViewport(page, `${testInfo.project.name} logical model fallback routing`);
    } finally {
        const restored = await request.patch("/api/admin/settings", { data: { logicalModels: before.logicalModels, defaultModels: before.defaultModels } });
        expect(restored.ok(), await restored.text()).toBe(true);
    }
});

function logicalModelCard(page: Page, id: string) {
    return page.getByText(`ID：${id}`, { exact: true }).locator("..").locator("..").locator("..");
}

async function setTheme(page: Page, theme: "light" | "dark") {
    await page.addInitScript((nextTheme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme: nextTheme }, version: 0 })), theme);
}

function generationOperationsFixture() {
    const now = Date.now();
    return {
        items: [
            {
                id: "agent-EbB9REGeyEjPg2GiXUmZx",
                userId: "e2e-user",
                accountId: "1",
                username: "e2e_admin",
                displayName: "E2E 管理员",
                type: "agent",
                status: "error",
                surface: "chat",
                conversationId: "conversation-D09IOWj7lcnSz8DPWj78g",
                runId: "agent-EbB9REGeyEjPg2GiXUmZx",
                model: "gpt-5.6-sol",
                channelId: "dflop-openai",
                leaseExpired: false,
                prompt: "写剧本一个女跳舞",
                error: "文本模型返回了无效 JSON",
                durationMs: 1_820,
                pointsCost: 0,
                pointsBreakdown: { planner: 0, childTasks: 0, total: 0 },
                plannerAttempts: [
                    {
                        attemptNo: 1,
                        planningCycle: 1,
                        logicalModelId: "gpt-5.6-sol",
                        channelId: "dflop-openai",
                        upstreamModel: "gpt-5.6-sol",
                        protocol: "chat",
                        status: "failed",
                        requestAcceptance: "response",
                        startedAt: now - 1_820,
                        completedAt: now - 1_000,
                        elapsedMs: 820,
                        error: "文本模型返回了无效 JSON",
                    },
                    {
                        attemptNo: 2,
                        planningCycle: 1,
                        logicalModelId: "gpt-5.6-sol",
                        channelId: "dflop-openai",
                        upstreamModel: "gpt-6-astra",
                        protocol: "chat",
                        status: "failed",
                        requestAcceptance: "response",
                        startedAt: now - 990,
                        completedAt: now,
                        elapsedMs: 990,
                        error: "上游明确拒绝了请求",
                    },
                ],
                plannerFailure: { message: "文本模型返回了无效 JSON", failedAt: now },
                createdAt: now - 1_820,
                updatedAt: now,
                canCancel: false,
            },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        summary: { total: 1, active: 0, success: 0, failed: 1, averageDurationMs: 1_820, totalPointsCost: 0, byType: { agent: 1 }, byStatus: { error: 1 } },
        channels: [],
        agentPerformance: { sampleSize: 0, planningP50Ms: 0, planningP95Ms: 0, firstResultP50Ms: 0, firstResultP95Ms: 0, queueAverageMs: 0, upstreamAverageMs: 0, reviewAverageMs: 0 },
    };
}
