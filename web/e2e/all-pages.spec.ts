import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN_SECTION_KEYS } from "../src/components/admin/admin-sections";
import { expectNoHorizontalOverflow, expectVisibleControlsWithinViewport } from "./responsive-helpers";
import { E2E_ADMIN } from "./support";
import { observeRouteApi, type ApiFailure } from "./route-api-observer";

const PROFILE_SECTIONS = ["overview", "profile", "billing", "orders", "points", "consume", "referrals", "security"] as const;
const BASE_URL = `http://127.0.0.1:${Number(process.env.VOZEB_PRO_E2E_PORT || 3100)}`;
const DOCS_URL = `http://127.0.0.1:${Number(process.env.VOZEB_PRO_DOCS_E2E_PORT || 3001)}`;
const USES_POSTGRES = Boolean(process.env.VOZEB_PRO_E2E_DATABASE_URL?.trim());
const FILE_PROVIDER_LIMITATIONS = new Map([
    ["/api/public/gallery", 409],
    ["/api/notifications/interactions", 409],
    ["/api/admin/referrals", 501],
    ["/api/admin/billing/summary", 501],
    ["/api/admin/billing/top-up-presets", 501],
]);
const BRAND_ROUTES = ["/", "/en", "/zh-cn", "/login", "/register", "/create", "/admin?section=site"] as const;

type RouteCase = { path: string; expectedPath?: RegExp; expectedStatus?: number; readyHeading?: string; readyText?: string | RegExp; ready?: (page: Page) => Promise<void> };

test("all authenticated pages reach their real routes and stay usable", async ({ page, request }, testInfo) => {
    test.setTimeout(360_000);
    const fixtures = await createPageFixtures(request, testInfo.project.use.viewport?.width || 1280);
    // The first document visit to unprefixed Home selects VI for subsequent nonlocalized routes.
    const routes: RouteCase[] = [
        { path: "/", readyHeading: "HOTX AI – Nền tảng sáng tạo nội dung bằng AI" },
        { path: "/gallery", readyHeading: "Khám phá cảm hứng" },
        { path: "/community", readyHeading: "Khám phá cảm hứng" },
        { path: "/announcements", readyHeading: "Thông báo" },
        { path: "/create" },
        { path: "/image", expectedPath: /\/create$/ },
        { path: "/video", expectedPath: /\/create$/ },
        { path: "/canvas", readyHeading: "Canvas của tôi" },
        { path: `/canvas/${fixtures.canvasId}` },
        { path: "/drama", readyHeading: "Dự án phim ngắn" },
        { path: `/drama/${fixtures.dramaId}` },
        { path: "/works", readyHeading: "Quản lý tác phẩm" },
        { path: "/assets", readyHeading: "Tài nguyên của tôi" },
        { path: "/voices", readyHeading: "Quản lý giọng nói" },
        { path: "/my-prompts", readyHeading: "Prompt của tôi" },
        { path: "/prompts", readyHeading: "Thư viện prompt" },
        { path: "/help", readyHeading: "Sáng tạo từ thao tác đến bàn giao theo quy trình thực tế" },
        { path: "/me", readyHeading: "E2E 管理员" },
        USES_POSTGRES ? { path: `/u/${E2E_ADMIN.username}`, expectedStatus: 404, readyText: "404" } : { path: `/u/${E2E_ADMIN.username}`, readyHeading: "Trang nhà sáng tạo tạm thời không khả dụng" },
        { path: "/billing", expectedPath: /\/profile\?section=billing$/ },
        { path: "/billing/checkout", readyText: /Nạp điểm|Chưa có mức nạp sẵn; hãy nhập số tiền tùy chỉnh/ },
        { path: "/billing/success", readyText: "Thiếu thông tin đơn hàng" },
        { path: "/billing/cancel", readyText: "Thiếu thông tin đơn hàng" },
        { path: "/admin/setup", readyHeading: "把站点配置到可以上线运营" },
        { path: "/admin/billing", readyHeading: "财务钱包" },
        { path: "/admin/generation-operations", expectedPath: /\/admin\?section=generationOperations$/ },
        ...PROFILE_SECTIONS.map((section) => ({ path: `/profile?section=${section}` })),
    ];
    const themes = testInfo.project.name === "chromium" ? (["light", "dark"] as const) : ([testInfo.project.name === "mobile-430" ? "dark" : "light"] as const);

    for (const theme of themes) {
        await setTheme(page, theme);
        for (const route of routes) await verifyRoute(page, route, `${testInfo.project.name} ${theme}`);
    }
});

test("every administrator section renders its server-backed surface", async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const theme = testInfo.project.name === "mobile-430" ? "dark" : "light";
    await setTheme(page, theme);
    for (const section of ADMIN_SECTION_KEYS) {
        await verifyRoute(
            page,
            {
                path: section === "overview" ? "/admin" : `/admin?section=${section}`,
                ready: async () => {
                    await expect(page.locator("[data-hydrated='true']")).toBeVisible();
                    await expect(page.locator("h1").first()).toBeVisible();
                    await expect(page.getByText("正在加载分区...", { exact: true })).toHaveCount(0);
                },
            },
            `${testInfo.project.name} admin ${section}`,
        );
    }
});

test("signed-out, legal, installation and invalid public detail routes fail safely", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ baseURL: BASE_URL, locale: "zh-CN", viewport: testInfo.project.use.viewport || undefined, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
        const theme = testInfo.project.name === "mobile-430" ? "dark" : "light";
        await page.addInitScript((nextTheme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme: nextTheme }, version: 0 })), theme);
        const routes: RouteCase[] = [
            { path: "/", readyHeading: "HOTX AI – Nền tảng sáng tạo nội dung bằng AI" },
            { path: "/login", readyHeading: "Đăng nhập HOTX AI" },
            { path: "/register", readyHeading: "Đăng ký HOTX AI" },
            { path: "/forgot-password", readyHeading: "Đặt lại mật khẩu" },
            { path: "/privacy", readyHeading: "Chính sách quyền riêng tư" },
            { path: "/terms", readyHeading: "Điều khoản dịch vụ" },
            { path: "/gallery", readyHeading: "Khám phá cảm hứng" },
            { path: "/announcements", readyHeading: "Thông báo" },
            USES_POSTGRES ? { path: `/u/${E2E_ADMIN.username}`, expectedStatus: 404, readyText: "404" } : { path: `/u/${E2E_ADMIN.username}`, readyHeading: "Trang nhà sáng tạo tạm thời không khả dụng" },
            { path: "/share/not-a-real-public-work", expectedStatus: USES_POSTGRES ? 404 : 200, readyText: USES_POSTGRES ? "404" : "Chia sẻ tác phẩm tạm thời không khả dụng" },
            { path: "/install", expectedPath: /\/$/ },
        ];
        for (const route of routes) await verifyRoute(page, route, `${testInfo.project.name} signed-out`);
    } finally {
        await context.close();
    }
});

test("HOTX AI branding stays visible, square, and within each release viewport", async ({ browser, page }, testInfo) => {
    const signedOutContext = await browser.newContext({ baseURL: BASE_URL, locale: "zh-CN", viewport: testInfo.project.use.viewport || undefined, storageState: { cookies: [], origins: [] } });
    const signedOutPage = await signedOutContext.newPage();
    const docsContext = await browser.newContext({ locale: "zh-CN", viewport: testInfo.project.use.viewport || undefined, storageState: { cookies: [], origins: [] } });
    const docsPage = await docsContext.newPage();
    const docsDevResourceFailures: string[] = [];
    const isDocsDevResource = (url: string) => {
        const resource = new URL(url);
        return resource.origin === DOCS_URL && resource.pathname.startsWith("/_next/");
    };
    docsPage.on("response", (response) => {
        if (response.status() >= 400 && isDocsDevResource(response.url())) {
            docsDevResourceFailures.push(`HTTP ${response.status()} ${response.url()}`);
        }
    });
    docsPage.on("requestfailed", (request) => {
        if (isDocsDevResource(request.url())) {
            docsDevResourceFailures.push(`request failed ${request.failure()?.errorText || "unknown"} ${request.url()}`);
        }
    });
    docsPage.on("console", (message) => {
        const text = message.text();
        if (message.type() === "error" && text.includes(DOCS_URL) && text.includes("/_next/")) {
            docsDevResourceFailures.push(`console error ${text}`);
        }
    });
    try {
        for (const route of BRAND_ROUTES) {
            const routePage = route === "/login" || route === "/register" ? signedOutPage : page;
            await routePage.goto(route, { waitUntil: "domcontentloaded" });
            if (route === "/create" && testInfo.project.name.startsWith("mobile-")) {
                const openNavigation = routePage.getByRole("button", { name: "打开导航菜单" });
                await expect(openNavigation).toBeVisible();
                await openNavigation.click();
            }
            await expect(routePage.getByText("HOTX AI", { exact: true }).and(routePage.locator(":visible")).first(), `${testInfo.project.name} ${route} HOTX AI text`).toBeVisible();

            const logo = routePage.locator('img[src="/hx-favicon.png"]').and(routePage.locator(":visible")).first();
            await expect(logo, `${testInfo.project.name} ${route} HOTX AI logo`).toBeVisible();
            await expect(logo).toHaveClass(/object-contain/);
            await expect(routePage.getByText("VOZEB PRO", { exact: true }), `${testInfo.project.name} ${route} legacy product text`).toHaveCount(0);
            await expect(routePage.getByText("VOZEB 开源交流 QQ 群", { exact: true }), `${testInfo.project.name} ${route} legacy community text`).toHaveCount(0);
            expect(
                await logo.evaluate((image) => {
                    const { width, height } = image.getBoundingClientRect();
                    const { naturalHeight, naturalWidth } = image as HTMLImageElement;
                    return {
                        hasLayoutSize: width > 0 && height > 0,
                        hasIntrinsicSize: naturalWidth > 0 && naturalHeight > 0,
                        intrinsicIsSquare: naturalWidth === naturalHeight,
                        objectFit: getComputedStyle(image).objectFit,
                    };
                }),
                `${testInfo.project.name} ${route} HOTX AI logo geometry`,
            ).toEqual({
                hasLayoutSize: true,
                hasIntrinsicSize: true,
                intrinsicIsSquare: true,
                objectFit: "contain",
            });
            await expectNoHorizontalOverflow(routePage, `${testInfo.project.name} ${route} HOTX AI branding`);
        }

        await docsPage.goto(DOCS_URL, { waitUntil: "networkidle" });
        await expect(docsPage.getByText("HOTX AI", { exact: true }).and(docsPage.locator(":visible")).first(), `${testInfo.project.name} docs HOTX AI text`).toBeVisible();
        const docsLogo = docsPage.locator('img[src="/hx-favicon.png"]').and(docsPage.locator(":visible")).first();
        await expect(docsLogo, `${testInfo.project.name} docs HOTX AI logo`).toBeVisible();
        await expect(docsLogo).toHaveClass(/object-contain/);
        await expect(docsPage.getByText("VOZEB PRO", { exact: true }), `${testInfo.project.name} docs legacy product text`).toHaveCount(0);
        await expect(docsPage.getByText("VOZEB 开源交流 QQ 群", { exact: true }), `${testInfo.project.name} docs legacy community text`).toHaveCount(0);
        expect(
            await docsLogo.evaluate((image) => {
                const { width, height } = image.getBoundingClientRect();
                const { naturalHeight, naturalWidth } = image as HTMLImageElement;
                return {
                    hasLayoutSize: width > 0 && height > 0,
                    hasIntrinsicSize: naturalWidth > 0 && naturalHeight > 0,
                    intrinsicIsSquare: naturalWidth === naturalHeight,
                    objectFit: getComputedStyle(image).objectFit,
                };
            }),
            `${testInfo.project.name} docs HOTX AI logo geometry`,
        ).toEqual({
            hasLayoutSize: true,
            hasIntrinsicSize: true,
            intrinsicIsSquare: true,
            objectFit: "contain",
        });
        await expectNoHorizontalOverflow(docsPage, `${testInfo.project.name} docs HOTX AI branding`);
        expect(docsDevResourceFailures, `${testInfo.project.name} docs same-origin dev resources`).toEqual([]);
    } finally {
        await Promise.all([signedOutContext.close(), docsContext.close()]);
    }
});

async function createPageFixtures(request: APIRequestContext, viewportWidth: number) {
    const suffix = randomUUID().slice(0, 8);
    const nodeX = 120;
    const nodeWidth = 280;
    const viewportX = Math.round((viewportWidth - nodeWidth) / 2 - nodeX);
    const canvas = await request.post("/api/canvas/projects", {
        data: {
            title: `全页面回归画布 ${suffix}`,
            project: {
                viewport: { x: viewportX, y: 120, k: 1 },
                nodes: [{ id: `text-${suffix}`, type: "text", title: "页面回归节点", position: { x: nodeX, y: 120 }, width: nodeWidth, height: 180, metadata: { content: "服务端画布记录" } }],
                connections: [],
            },
        },
    });
    expect(canvas.ok(), await canvas.text()).toBe(true);
    const canvasPayload = (await canvas.json()) as { data: { project: { id: string } } };

    const drama = await request.post("/api/drama/projects", { data: { title: `全页面回归短剧 ${suffix}`, summary: "验证服务端项目读取与移动布局", ratio: "9:16" } });
    expect(drama.ok(), await drama.text()).toBe(true);
    const dramaPayload = (await drama.json()) as { data: { project: { id: string } } };
    return { canvasId: canvasPayload.data.project.id, dramaId: dramaPayload.data.project.id };
}

async function setTheme(page: Page, theme: "light" | "dark") {
    if (page.url() === "about:blank") await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate((nextTheme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme: nextTheme }, version: 0 })), theme);
}

async function verifyRoute(page: Page, route: RouteCase, label: string) {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const api = observeRouteApi(page, BASE_URL);
    const apiFailures = api.failures;
    const onPageError = (error: Error) => pageErrors.push(error.message);
    const onConsole = (message: { type(): string; text(): string }) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    };
    page.on("pageerror", onPageError);
    page.on("console", onConsole);
    try {
        const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
        if (route.expectedStatus !== undefined) expect(response?.status()).toBe(route.expectedStatus);
        else if (route.path.startsWith("/share/")) expect(response?.status()).toBe(404);
        else expect(response?.status() || 200, `${label} ${route.path} document status`).toBeLessThan(500);
        await expect(page.locator("main").first()).toBeVisible();
        const browserIconHref = await page.locator('link[rel="icon"]').getAttribute("href");
        expect(browserIconHref, `${label} ${route.path} browser icon href`).toBeTruthy();
        expect(browserIconHref, `${label} ${route.path} browser icon must not depend on a redirect`).not.toContain("/api/site-icon");
        if (route.expectedPath) await expect(page).toHaveURL(route.expectedPath);
        if (route.readyHeading) await expect(page.getByRole("heading", { name: route.readyHeading, exact: true })).toBeVisible();
        if (route.readyText) await expect(page.getByText(route.readyText, typeof route.readyText === "string" ? { exact: true } : undefined).first()).toBeVisible();
        await route.ready?.(page);
        await expect(page.locator("body")).not.toContainText("Application error");
        await expect(page.locator("body")).not.toContainText("Internal Server Error");
        await expectNoHorizontalOverflow(page, `${label} ${route.path}`);
        await expectVisibleControlsWithinViewport(page, `${label} ${route.path}`);
        await api.settle();
        const expectedLimitations = apiFailures.filter((failure) => isExpectedFileProviderLimitation(failure) || isExpectedRouteApiFailure(failure, route));
        const unexpectedApiFailures = apiFailures.filter((failure) => !isExpectedFileProviderLimitation(failure) && !isExpectedRouteApiFailure(failure, route));
        expect(pageErrors, `${label} ${route.path} page errors`).toEqual([]);
        expect(unexpectedApiFailures, `${label} ${route.path} API failures`).toEqual([]);
        expect(withoutExpectedResourceErrors(consoleErrors, expectedLimitations, route.expectedStatus), `${label} ${route.path} console errors; API responses: ${JSON.stringify(apiFailures)}`).toEqual([]);
    } finally {
        page.off("pageerror", onPageError);
        page.off("console", onConsole);
        api.dispose();
    }
}

function isExpectedFileProviderLimitation(failure: ApiFailure) {
    if (failure.status === 404 && failure.path === `/api/public/users/${E2E_ADMIN.username}`) return failure.body.includes("创作者主页不存在");
    if (USES_POSTGRES || (failure.status !== 409 && failure.status !== 501)) return false;
    return failure.body.includes("需要启用 PostgreSQL") || FILE_PROVIDER_LIMITATIONS.get(failure.path) === failure.status;
}

function isExpectedRouteApiFailure(failure: ApiFailure, route: RouteCase) {
    if (route.expectedStatus !== failure.status) return false;
    if (route.path.startsWith("/u/")) return failure.path === `/api/public/users${route.path.slice(2)}`;
    if (route.path.startsWith("/share/")) return failure.path === `/api/public/works${route.path.slice("/share".length)}`;
    return false;
}

function withoutExpectedResourceErrors(consoleErrors: string[], expectedLimitations: ApiFailure[], expectedDocumentStatus?: number) {
    const remainingByStatus = new Map<number, number>();
    for (const failure of expectedLimitations) remainingByStatus.set(failure.status, (remainingByStatus.get(failure.status) || 0) + 1);
    if (expectedDocumentStatus && expectedDocumentStatus >= 400) remainingByStatus.set(expectedDocumentStatus, (remainingByStatus.get(expectedDocumentStatus) || 0) + 1);
    return consoleErrors.filter((message) => {
        const match = message.match(/^Failed to load resource: the server responded with a status of (\d+)/);
        const status = Number(match?.[1]);
        const remaining = remainingByStatus.get(status) || 0;
        if (!remaining) return true;
        remainingByStatus.set(status, remaining - 1);
        return false;
    });
}
