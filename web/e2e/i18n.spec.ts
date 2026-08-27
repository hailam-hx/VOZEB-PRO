import { expect, test } from "@playwright/test";

const localeCookie = "vozeb-pro-locale";

test("detects supported browser languages and falls back to Vietnamese", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Browser language detection only needs one desktop browser project");
    const baseURL = String(testInfo.project.use.baseURL);
    const cases = [
        { browserLocale: "en-US", htmlLang: "en", heading: "One place for every kind of AI creation" },
        { browserLocale: "vi-VN", htmlLang: "vi", heading: "Một lối vào cho mọi sáng tạo AI" },
        { browserLocale: "zh-TW", htmlLang: "zh-CN", heading: "一个入口 完成所有 AI 创作" },
        { browserLocale: "fr-FR", htmlLang: "vi", heading: "Một lối vào cho mọi sáng tạo AI" },
    ] as const;

    for (const item of cases) {
        const context = await browser.newContext({ baseURL, locale: item.browserLocale });
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("lang", item.htmlLang);
        await expect(page.getByRole("heading", { level: 1, name: item.heading })).toBeVisible();
        await context.close();
    }
});

test("switching language preserves the current URL and in-memory draft", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "The desktop project covers state preservation");
    await page.goto("/create");
    const draft = "Giữ nguyên bản nháp khi đổi ngôn ngữ";
    const composer = page.getByPlaceholder("输入你的创作想法、脚本或画面要求");
    await composer.fill(draft);
    const url = page.url();

    await page.getByRole("button", { name: "切换语言" }).click();
    await page.getByRole("menuitem").filter({ hasText: "English" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(url);
    await expect(page.getByPlaceholder("Enter an idea, script, or visual requirements")).toHaveValue(draft);
    await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === localeCookie)?.value).toBe("en");

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("admin remains Chinese without changing the user language cookie", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "The desktop project covers the fixed Chinese admin locale");
    await page.context().addCookies([{ name: localeCookie, value: "en", url: String(test.info().project.use.baseURL) }]);
    await page.goto("/admin");

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect.poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === localeCookie)?.value).toBe("en");
});

test("prepaid points summary resolves its wallet messages", async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    const missingMessages: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("MISSING_MESSAGE")) missingMessages.push(message.text());
    });

    await page.context().addCookies([{ name: localeCookie, value: "zh-CN", url: String(testInfo.project.use.baseURL) }]);
    await page.goto("/create");
    await page.getByTitle("积分余额").click();

    const popover = page.locator(".user-points-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByText("已结算积分", { exact: true })).toBeVisible();
    await expect(popover.getByText("预留积分", { exact: true })).toBeVisible();
    await expect(popover.getByRole("button", { name: /充\s*值\s*积\s*分/ })).toBeVisible();
    await expect(popover.getByText("使用详情", { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(missingMessages).toEqual([]);
});

test("language menu remains inside a 390px viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Dedicated mobile projects cover both target widths");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "切换语言" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("English and Vietnamese workspace top bars fit mobile light and dark themes", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "This matrix runs in the 390px and 430px projects");
    const baseURL = String(testInfo.project.use.baseURL);
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(testInfo.project.name === "mobile-390" ? 390 : 430);

    for (const locale of ["en", "vi"] as const) {
        for (const theme of ["light", "dark"] as const) {
            await page.context().addCookies([{ name: localeCookie, value: locale, url: baseURL }]);
            await page.goto("/create");
            await page.evaluate((nextTheme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme: nextTheme }, version: 0 })), theme);
            await page.reload();

            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
            else await expect(page.locator("html")).not.toHaveClass(/dark/);

            const languageButton = page.getByRole("button", { name: locale === "en" ? "Change language" : "Đổi ngôn ngữ" });
            await expect(languageButton).toBeVisible();
            const triggerBounds = await languageButton.boundingBox();
            expect(triggerBounds).not.toBeNull();
            expect(triggerBounds!.x).toBeGreaterThanOrEqual(0);
            expect(triggerBounds!.x + triggerBounds!.width).toBeLessThanOrEqual(viewport!.width);

            await languageButton.click();
            const menu = page.getByRole("menu");
            await expect(menu).toBeVisible();
            const menuBounds = await menu.boundingBox();
            expect(menuBounds).not.toBeNull();
            expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
            expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(viewport!.width);
            await page.keyboard.press("Escape");

            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
    }
});
