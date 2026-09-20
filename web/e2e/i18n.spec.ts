import { expect, test } from "@playwright/test";

const localeCookie = "vozeb-pro-locale";
const defaultSkills = [
    { id: "ecommerce-image", name: "电商生图", description: "原始电商描述", workspaces: ["image", "canvas"] },
    { id: "yanai-natural-beauty", name: "自然美颜精修", description: "原始美颜描述", workspaces: ["image", "canvas"] },
    { id: "character-design", name: "角色设定", description: "原始角色描述", workspaces: ["image", "canvas", "drama"] },
    { id: "image-motion", name: "图片动效", description: "原始动效描述", workspaces: ["video"] },
    { id: "drama-planning", name: "短剧策划", description: "原始短剧描述", workspaces: ["image", "video", "drama"] },
    { id: "custom-skill", name: "Skill riêng", description: "Mô tả riêng", workspaces: ["image"] },
];

test("registration opens legal documents in the selected language without prefixing registration", async ({ browser }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    for (const locale of ["en", "zh-CN"] as const) {
        const context = await browser.newContext({ baseURL, locale, viewport: testInfo.project.use.viewport || undefined, storageState: { cookies: [], origins: [] } });
        await context.addCookies([{ name: localeCookie, value: locale, url: baseURL }]);
        const page = await context.newPage();
        try {
            await page.goto("/register");
            await expect(page).toHaveURL(`${baseURL}/register`);
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            for (const document of [
                { slug: "terms", link: locale === "en" ? "Terms of service" : "服务条款", heading: locale === "en" ? "Terms of Service" : "服务条款" },
                { slug: "privacy", link: locale === "en" ? "Privacy policy" : "隐私政策", heading: locale === "en" ? "Privacy Policy" : "隐私政策" },
            ]) {
                const href = `/${locale === "en" ? "en" : "zh-cn"}/${document.slug}`;
                const link = page.getByRole("link", { name: document.link, exact: true });
                await expect(link).toHaveAttribute("href", href);
                const popupPromise = page.waitForEvent("popup");
                await link.click();
                const popup = await popupPromise;
                await popup.waitForLoadState("domcontentloaded");
                await expect(popup).toHaveURL(`${baseURL}${href}`);
                await expect(popup.locator("html")).toHaveAttribute("lang", locale);
                await expect(popup.getByRole("heading", { level: 1, name: document.heading, exact: true })).toBeVisible();
                await popup.close();
            }
            await expect(page).toHaveURL(`${baseURL}/register`);
        } finally {
            await context.close();
        }
    }
});

test("detects a fresh browser language on public and nonlocalized routes", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Browser language detection only needs one desktop browser project");
    const baseURL = String(testInfo.project.use.baseURL);
    const cases = [
        {
            browserLocale: "en-US",
            htmlLang: "en",
            homePath: "/en",
            homeHeading: "HOTX AI – A platform for AI content creation",
            termsPath: "/en/terms",
            termsHeading: "Terms of Service",
        },
        {
            browserLocale: "vi-VN",
            htmlLang: "vi",
            homePath: "/",
            homeHeading: "HOTX AI – Nền tảng sáng tạo nội dung bằng AI",
            termsPath: "/terms",
            termsHeading: "Điều khoản dịch vụ",
        },
        {
            browserLocale: "zh-TW",
            htmlLang: "zh-CN",
            homePath: "/zh-cn",
            homeHeading: "HOTX AI – 一站式 AI 内容创作平台",
            termsPath: "/zh-cn/terms",
            termsHeading: "服务条款",
        },
        {
            browserLocale: "fr-FR",
            htmlLang: "vi",
            homePath: "/",
            homeHeading: "HOTX AI – Nền tảng sáng tạo nội dung bằng AI",
            termsPath: "/terms",
            termsHeading: "Điều khoản dịch vụ",
        },
    ] as const;

    for (const item of cases) {
        const context = await browser.newContext({ baseURL, locale: item.browserLocale, storageState: testInfo.project.use.storageState });
        await context.clearCookies({ name: localeCookie });
        const page = await context.newPage();
        try {
            await page.goto("/");
            await expect(page).toHaveURL(new URL(item.homePath, baseURL).toString());
            await expect(page.locator("html")).toHaveAttribute("lang", item.htmlLang);
            await expect(page.getByRole("heading", { level: 1, name: item.homeHeading })).toBeVisible();

            await page.goto("/terms");
            await expect(page).toHaveURL(new URL(item.termsPath, baseURL).toString());
            await expect(page.locator("html")).toHaveAttribute("lang", item.htmlLang);
            await expect(page.getByRole("heading", { level: 1, name: item.termsHeading })).toBeVisible();

            await page.goto("/create");
            await expect(page).toHaveURL(new URL("/create", baseURL).toString());
            await expect(page.locator("html")).toHaveAttribute("lang", item.htmlLang);
            expect((await context.cookies()).find((cookie) => cookie.name === localeCookie)).toBeUndefined();
        } finally {
            await context.close();
        }
    }
});

test("switching language preserves the current URL and draft while persisting the choice", async ({ page }, testInfo) => {
    await page.context().addCookies([{ name: localeCookie, value: "zh-CN", url: String(testInfo.project.use.baseURL) }]);
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
    const languageCookie = (await page.context().cookies()).find((cookie) => cookie.name === localeCookie)!;
    expect(languageCookie.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 60 * 60);

    await page.goto("/");
    await expect(page).toHaveURL(new URL("/en", String(testInfo.project.use.baseURL)).toString());
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("built-in creative skills follow the active locale while submissions keep stable IDs", async ({ page }, testInfo) => {
    let submittedSkillIds: string[] | undefined;
    await page.route("**/api/agent/skills?workspace=all", async (route) => {
        await route.fulfill({ json: { code: 0, data: { skills: defaultSkills }, msg: "OK" } });
    });
    await page.route(/\/api\/agent\/runs$/, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        submittedSkillIds = ((await route.request().postDataJSON()) as { skillIds: string[] }).skillIds;
        await route.abort("connectionrefused");
    });

    const cases = [
        {
            locale: "vi",
            names: ["Ảnh thương mại", "Chỉnh sửa chân dung tự nhiên", "Thiết kế nhân vật", "Ảnh chuyển động", "Lập kế hoạch phim ngắn"],
            useSkill: "Sử dụng Skill Ảnh thương mại",
            chooseSkill: "Chọn Skill sáng tạo",
            description: "Tạo hình ảnh thương mại cho ảnh chính, trang chi tiết, mạng xã hội, UGC, người mẫu, bao bì và chiến dịch tiếp thị.",
            placeholder: "Nhập ý tưởng, kịch bản hoặc yêu cầu hình ảnh",
            send: "Gửi",
        },
        {
            locale: "en",
            names: ["E-commerce Images", "Natural Portrait Retouching", "Character Design", "Image Animation", "Short Drama Planning"],
            useSkill: "Use E-commerce Images Skill",
            chooseSkill: "Choose a creation Skill",
            description: "Create e-commerce visuals for hero images, detail pages, social media, UGC, models, packaging, and marketing campaigns.",
        },
        {
            locale: "zh-CN",
            names: ["电商生图", "自然美颜精修", "角色设定", "图片动效", "短剧策划"],
            useSkill: "使用 电商生图 Skill",
            chooseSkill: "选择创作 Skill",
            description: "覆盖主图、详情页、社媒、UGC、模特、包装和营销活动的电商视觉生成。",
        },
    ] as const;

    for (const item of cases) {
        await page.context().addCookies([{ name: localeCookie, value: item.locale, url: String(testInfo.project.use.baseURL) }]);
        await page.goto("/create");
        await expect(page.locator("html")).toHaveAttribute("lang", item.locale);
        for (const name of item.names) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
        await expect(page.getByText("Skill riêng", { exact: true })).toBeVisible();
        if (item.locale !== "zh-CN") for (const skill of defaultSkills.slice(0, 5)) await expect(page.getByText(skill.name, { exact: true })).toHaveCount(0);
        const firstSkill = page.getByRole("button", { name: item.useSkill, exact: true });
        await expect(firstSkill).toBeVisible();
        await expect(firstSkill).toHaveAttribute("title", item.description);
        await page.getByRole("button", { name: item.chooseSkill, exact: true }).click();
        const skillPicker = page.locator(".ant-popover").filter({ hasText: item.names[0] }).last();
        await expect(skillPicker).toBeVisible();
        await expect(skillPicker.getByText(item.description, { exact: true })).toBeVisible();
        const pickerBounds = await skillPicker.boundingBox();
        const viewport = page.viewportSize();
        expect(pickerBounds).not.toBeNull();
        expect(viewport).not.toBeNull();
        expect(pickerBounds!.x).toBeGreaterThanOrEqual(0);
        expect(pickerBounds!.y).toBeGreaterThanOrEqual(0);
        expect(pickerBounds!.x + pickerBounds!.width).toBeLessThanOrEqual(viewport!.width);
        expect(pickerBounds!.y + pickerBounds!.height).toBeLessThanOrEqual(viewport!.height);
        await page.keyboard.press("Escape");
        await firstSkill.click();
        await expect(page.getByText(`Skill · ${item.names[0]}`, { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        if (item.locale === "vi") {
            await page.getByPlaceholder(item.placeholder).fill("Tạo ảnh sản phẩm tối giản");
            await page.getByRole("button", { name: item.send, exact: true }).click();
            await expect.poll(() => submittedSkillIds).toEqual(["ecommerce-image"]);
        }
    }
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
    await page.context().addCookies([{ name: localeCookie, value: "vi", url: String(testInfo.project.use.baseURL) }]);
    await page.goto("/");
    await page.getByRole("button", { name: "Đổi ngôn ngữ" }).click();
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
