import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, expectVisibleControlsWithinViewport } from "./responsive-helpers";

const productLandingPaths = ["/ai-image-generator", "/ai-video-generator", "/ai-voice-generator", "/voice-cloning", "/ai-short-drama", "/ai-agent"];

test("admin customer-service settings persist and only anonymous marketing pages render the footer", async ({ browser, page, request }, testInfo) => {
    test.setTimeout(240_000);
    const original = ((await (await request.get("/api/admin/settings")).json()) as { settings: { site: Record<string, unknown> } }).settings.site;
    const publicContexts: Array<Awaited<ReturnType<typeof browser.newContext>>> = [];
    const publicPages: Page[] = [];
    const customerService = {
        businessName: "E2E <客服> & Co.",
        phone: "+84 28 1234 5678",
        email: "support.e2e@example.test",
        address: "Địa chỉ E2E <phòng hỗ trợ>, 123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh, Việt Nam",
    };
    const locales = [
        { path: "/", title: "Dịch vụ khách hàng", labels: ["Tên doanh nghiệp", "Điện thoại", "Email", "Địa chỉ"] },
        { path: "/en", title: "Customer service", labels: ["Business name", "Phone", "Email", "Address"] },
        { path: "/zh-cn", title: "客户服务", labels: ["企业名称", "电话", "邮箱", "地址"] },
    ];
    const save = () => page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === "/api/admin/settings");
    try {
        await page.goto("/admin?section=site", { waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
        const businessName = page.getByLabel("企业名称");
        const phone = page.getByLabel("客服电话");
        const email = page.getByLabel("客服邮箱");
        const address = page.getByLabel("联系地址");
        await businessName.fill(customerService.businessName);
        await phone.fill(customerService.phone);
        await email.fill(customerService.email);
        await address.fill(customerService.address);
        const saved = save();
        await page.getByRole("button", { name: "保存网站设置" }).click();
        expect((await saved).ok()).toBe(true);
        await expect(page.getByText("网站信息已保存", { exact: true })).toBeVisible();

        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
        await expect(businessName).toHaveValue(customerService.businessName);
        await expect(phone).toHaveValue(customerService.phone);
        await expect(email).toHaveValue(customerService.email);
        await expect(address).toHaveValue(customerService.address);
        expect(((await (await request.get("/api/admin/settings")).json()) as { settings: { site: { customerService: unknown } } }).settings.site.customerService).toEqual(customerService);

        for (const viewport of [
            { name: "desktop", width: 1280, height: 720 },
            { name: "mobile-390", width: 390, height: 844 },
            { name: "mobile-430", width: 430, height: 932 },
        ]) {
            const publicContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), locale: "vi-VN", storageState: { cookies: [], origins: [] }, viewport });
            publicContexts.push(publicContext);
            const publicPage = await publicContext.newPage();
            publicPages.push(publicPage);
            const publicSession = await publicContext.request.get("/api/auth/session");
            expect(publicSession.ok(), await publicSession.text()).toBe(true);
            expect(((await publicSession.json()) as { settings: { site: { customerService: unknown } } }).settings.site.customerService).toEqual(customerService);

            for (const locale of locales) {
                await publicPage.goto(locale.path, { waitUntil: "domcontentloaded" });
                await expectCustomerServiceFooter(publicPage, locale.title, locale.labels, customerService, viewport.name);
            }

            await publicContext.addCookies([{ name: "vozeb-pro-locale", value: "vi", url: String(testInfo.project.use.baseURL) }]);
            for (const path of productLandingPaths) {
                await publicPage.goto(path, { waitUntil: "domcontentloaded" });
                await expectCustomerServiceFooter(publicPage, "Dịch vụ khách hàng", locales[0].labels, customerService, viewport.name);
            }

            for (const path of ["/terms", "/privacy", "/login", "/create", "/admin"]) {
                await publicPage.goto(path, { waitUntil: "domcontentloaded" });
                await expect(publicPage.locator('[aria-labelledby="home-footer-customer-service-title"]')).toHaveCount(0);
            }
        }

        await email.fill("");
        const removedOne = save();
        await page.getByRole("button", { name: "保存网站设置" }).click();
        expect((await removedOne).ok()).toBe(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(email).toHaveValue("");
        const footerPage = publicPages[0];
        await footerPage.goto("/zh-cn", { waitUntil: "domcontentloaded" });
        const footer = footerPage.getByRole("region", { name: "客户服务" });
        await expect(footer).toBeVisible();
        await expect(footer.getByText(customerService.businessName, { exact: true })).toBeVisible();
        await expect(footer.getByRole("link", { name: customerService.phone, exact: true })).toHaveAttribute("href", `tel:${customerService.phone}`);
        await expect(footer.getByText(customerService.address, { exact: true })).toBeVisible();
        await expect(footer.getByText("邮箱", { exact: true })).toHaveCount(0);
        await expect(footer.locator("script, img")).toHaveCount(0);

        await businessName.fill("");
        await phone.fill("");
        await address.fill("");
        const removedAll = save();
        await page.getByRole("button", { name: "保存网站设置" }).click();
        expect((await removedAll).ok()).toBe(true);
        await footerPage.goto("/zh-cn", { waitUntil: "domcontentloaded" });
        await expect(footerPage.getByRole("region", { name: "客户服务" })).toHaveCount(0);
        await footerPage.reload({ waitUntil: "domcontentloaded" });
        await expect(footerPage.getByRole("region", { name: "客户服务" })).toHaveCount(0);
        expect(((await (await request.get("/api/admin/settings")).json()) as { settings: { site: { customerService: unknown } } }).settings.site.customerService).toEqual({ businessName: "", phone: "", email: "", address: "" });
    } finally {
        try {
            await Promise.all(publicContexts.map((context) => context.close()));
        } finally {
            const restored = await request.patch("/api/admin/settings", { data: { site: original } });
            expect(restored.ok(), await restored.text()).toBe(true);
            expect(((await (await request.get("/api/admin/settings")).json()) as { settings: { site: unknown } }).settings.site).toEqual(original);
        }
    }
});

async function expectCustomerServiceFooter(page: Page, title: string, labels: string[], customerService: { businessName: string; phone: string; email: string; address: string }, projectName: string) {
    const section = page.getByRole("region", { name: title });
    await expect(section).toBeVisible();
    await expect(section.locator("dl > div")).toHaveCount(4);
    await expect(section.getByText(customerService.businessName, { exact: true })).toBeVisible();
    await expect(section.getByText(customerService.address, { exact: true })).toBeVisible();
    const phone = section.getByRole("link", { name: customerService.phone, exact: true });
    const email = section.getByRole("link", { name: customerService.email, exact: true });
    await expect(phone).toHaveAttribute("href", `tel:${customerService.phone}`);
    await expect(email).toHaveAttribute("href", `mailto:${customerService.email}`);
    await expect(section.locator("script, img")).toHaveCount(0);
    await phone.scrollIntoViewIfNeeded();
    const layout = await section.evaluate((element) => {
        const fields = Array.from(element.querySelectorAll<HTMLElement>("dl > div"));
        const address = fields.at(-1)?.querySelector<HTMLElement>("dd")!;
        const lineHeight = Number.parseFloat(getComputedStyle(address).lineHeight);
        const links = Array.from(element.querySelectorAll<HTMLAnchorElement>("a")).map((link) => {
            const bounds = link.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
        });
        return {
            labels: fields.map((field) => field.querySelector("dt")?.textContent?.trim()),
            ordered: fields.every((field, index) => index === 0 || field.getBoundingClientRect().top >= fields[index - 1].getBoundingClientRect().top - 1),
            addressFits: address.scrollWidth <= address.clientWidth + 1,
            addressWraps: address.scrollHeight > lineHeight + 1,
            links,
            viewportWidth: document.documentElement.clientWidth,
        };
    });
    expect(layout.labels).toEqual(labels);
    expect(layout.ordered).toBe(true);
    expect(layout.addressFits).toBe(true);
    expect(layout.links).toHaveLength(2);
    expect(layout.links.every((link) => link.width > 0 && link.height > 0 && link.left >= -1 && link.right <= layout.viewportWidth + 1)).toBe(true);
    if (projectName.startsWith("mobile-")) expect(layout.addressWraps).toBe(true);
    await expectNoHorizontalOverflow(page, `${projectName} customer-service footer ${title}`);
    await expectVisibleControlsWithinViewport(page, `${projectName} customer-service footer ${title}`);
}
