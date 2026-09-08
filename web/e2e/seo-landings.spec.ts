import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, expectVisibleControlsWithinViewport } from "./responsive-helpers";
import { E2E_ADMIN } from "./support";

const landings = [
    {
        slug: "ai-image-generator",
        title: "Tạo ảnh AI online từ văn bản và ảnh | HOTX AI",
        h1: "Tạo ảnh AI online từ văn bản và ảnh tham chiếu",
        description: "Tạo ảnh AI online từ mô tả tiếng Việt hoặc ảnh tham chiếu. Tạo ảnh sản phẩm, quảng cáo và nội dung sáng tạo trong cùng workspace HOTX AI.",
        mode: "image",
    },
    {
        slug: "ai-video-generator",
        title: "Tạo video AI từ văn bản và hình ảnh | HOTX AI",
        h1: "Tạo video AI từ văn bản và hình ảnh",
        description: "Tạo video AI từ văn bản hoặc hình ảnh cho quảng cáo, TikTok và Reels. Tạo video từ ảnh, text-to-video và image-to-video trên HOTX AI.",
        mode: "video",
    },
    {
        slug: "ai-voice-generator",
        title: "Tạo giọng nói AI từ văn bản | HOTX AI",
        h1: "Tạo giọng nói AI tự nhiên từ văn bản",
        description: "Chuyển văn bản thành giọng nói AI cho video, quảng cáo, podcast và đào tạo. Tạo giọng đọc AI, nghe trực tiếp và tải tệp trên HOTX AI.",
        mode: "audio",
    },
    {
        slug: "voice-cloning",
        title: "Nhân bản giọng nói AI từ mẫu giọng | HOTX AI",
        h1: "Nhân bản giọng nói AI từ mẫu thu của bạn",
        description: "Nhân bản giọng nói AI từ mẫu âm thanh mà bạn có quyền sử dụng. Tạo và quản lý hồ sơ giọng để dùng cho nội dung được cho phép trên HOTX AI.",
        workspace: "/voices",
    },
    {
        slug: "ai-short-drama",
        title: "Tạo phim ngắn AI từ kịch bản đến video | HOTX AI",
        h1: "Tạo phim ngắn AI từ kịch bản đến cảnh quay",
        description: "Tạo phim ngắn AI theo dự án: xây dựng kịch bản, nhân vật, storyboard và tạo từng cảnh quay trong một quy trình sản xuất trên HOTX AI.",
        workspace: "/drama",
    },
    {
        slug: "ai-agent",
        title: "AI Agent sáng tạo nội dung đa phương tiện | HOTX AI",
        h1: "AI Agent sáng tạo nội dung bằng hình ảnh, video và âm thanh",
        description: "AI Agent hỗ trợ biến brief tiếng Việt thành hình ảnh, video và âm thanh. Tự động chọn quy trình và năng lực phù hợp trong cùng workspace HOTX AI.",
        mode: "agent",
    },
] as const;

test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "vozeb-pro-locale", value: "vi", url: String(test.info().project.use.baseURL) }]);
});

test("six SEO landing pages expose complete SSR metadata and responsive content", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const browserErrors = collectBrowserErrors(page);

    for (const [index, landing] of landings.entries()) {
        const response = await page.goto(`/${landing.slug}`, { waitUntil: "domcontentloaded" });
        expect(response?.status(), landing.slug).toBe(200);
        await expect(page.locator("html")).toHaveAttribute("lang", "vi");
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1, name: landing.h1 })).toBeVisible();
        await expect(page).toHaveTitle(landing.title);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", landing.description);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index.*follow/);
        const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
        expect(canonical).toBeTruthy();
        expect(new URL(canonical!).pathname).toBe(`/${landing.slug}`);
        expect(new URL(canonical!).protocol).toMatch(/^https?:$/);

        const jsonLd = JSON.parse((await page.locator("#seo-landing-json-ld").textContent()) || "null") as { "@graph": Array<{ "@type": string }> };
        expect(jsonLd["@graph"].map((entry) => entry["@type"])).toEqual(["WebPage", "BreadcrumbList"]);
        expect(JSON.stringify(jsonLd)).not.toMatch(/FAQPage|SoftwareApplication/);

        const visual = page.getByRole("img", { name: /HOTX AI/ }).last();
        await expect(visual).toBeVisible();
        await expect.poll(() => visual.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const firstFaq = page.locator('[data-seo-section="faq"] details').first();
        await firstFaq.locator("summary").click();
        await expect(firstFaq).toHaveAttribute("open", "");

        if (await page.locator("html").evaluate((element) => element.classList.contains("dark"))) {
            await page.getByRole("button", { name: "Chuyển sang giao diện sáng" }).click();
            await expect(page.locator("html")).not.toHaveAttribute("data-magicui-theme-vt", "active");
        }
        await expect(page.locator("html")).not.toHaveClass(/dark/);
        await expectNoHorizontalOverflow(page, `${testInfo.project.name} light ${landing.slug}`);
        await expectVisibleControlsWithinViewport(page, `${testInfo.project.name} light ${landing.slug}`);
        await page.locator("main").evaluate((element) => element.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath(`${landing.slug}-light.png`), fullPage: false });
        await page.getByRole("button", { name: "Chuyển sang giao diện tối" }).click();
        await expect(page.locator("html")).toHaveClass(/dark/);
        await expect(page.locator("html")).not.toHaveAttribute("data-magicui-theme-vt", "active");
        await expectNoHorizontalOverflow(page, `${testInfo.project.name} dark ${landing.slug}`);
        await page.locator("main").evaluate((element) => element.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath(`${landing.slug}-dark.png`), fullPage: false });

        if (index === 0) await verifyProductMenu(page, testInfo.project.name);
    }

    expect(browserErrors).toEqual([]);
    const unknown = await page.goto("/seo-route-khong-hop-le", { waitUntil: "domcontentloaded" });
    expect(unknown?.status()).toBe(404);
});

test("signed-in CTA entries open the real create mode or workspace", async ({ page }) => {
    test.setTimeout(180_000);
    for (const landing of landings) {
        await page.goto(`/${landing.slug}`, { waitUntil: "domcontentloaded" });
        const cta = page.getByTestId("seo-primary-cta");
        if ("mode" in landing) {
            const prompt = `Brief E2E ${landing.mode}`;
            await page.locator("textarea").fill(prompt);
            await cta.click();
            await expect(page).toHaveURL(/\/create(?:#.*)?$/);
            await expect(page.locator("textarea").first()).toHaveValue(prompt);
        } else {
            await cta.click();
            await expect(page).toHaveURL(new RegExp(`${landing.workspace.replace("/", "\\/")}(?:\\?|$)`));
        }
    }
});

test("signed-out CTA opens authentication and preserves its create destination", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), locale: "vi-VN", storageState: { cookies: [], origins: [] }, viewport: testInfo.project.use.viewport || undefined });
    await context.addCookies([{ name: "vozeb-pro-locale", value: "vi", url: String(testInfo.project.use.baseURL) }]);
    const page = await context.newPage();
    try {
        await page.goto("/ai-image-generator", { waitUntil: "domcontentloaded" });
        await page.locator("textarea").fill("Ảnh ra mắt sản phẩm E2E");
        await page.getByTestId("seo-primary-cta").click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: "Đăng nhập để trở lại vị trí vừa rồi" })).toBeVisible();
        await dialog.getByLabel("Tên đăng nhập hoặc email").fill(E2E_ADMIN.username);
        await dialog.getByLabel("Mật khẩu").fill(E2E_ADMIN.password);
        await dialog.getByRole("button", { name: "Đăng nhập" }).click();
        await expect(page).toHaveURL(/\/create(?:#.*)?$/);
        await expect(page.locator("textarea").first()).toHaveValue("Ảnh ra mắt sản phẩm E2E");
    } finally {
        await context.close();
    }
});

async function verifyProductMenu(page: Page, projectName: string) {
    if (projectName === "chromium") {
        const navigation = page.getByRole("navigation", { name: "Điều hướng chính" });
        const summary = navigation.getByText("Sản phẩm", { exact: true });
        await summary.click();
        const menu = page.getByTestId("home-product-menu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("link")).toHaveCount(6);
        await summary.press("Enter");
        await expect(menu).toBeHidden();
        await summary.press("Enter");
        await expect(menu).toBeVisible();
        await summary.press("Enter");
    } else {
        await page.getByRole("button", { name: "Mở menu điều hướng" }).click();
        const navigation = page.getByRole("navigation", { name: "Điều hướng di động" });
        await expect(navigation).toBeVisible();
        for (const landing of landings) await expect(navigation.getByRole("link", { name: new RegExp(productLabel(landing.slug)) })).toBeVisible();
        await page.getByRole("button", { name: "Đóng menu điều hướng" }).click();
    }
}

function productLabel(slug: (typeof landings)[number]["slug"]) {
    if (slug === "ai-image-generator") return "Tạo ảnh AI";
    if (slug === "ai-video-generator") return "Tạo video AI";
    if (slug === "ai-voice-generator") return "Tạo giọng nói AI";
    if (slug === "voice-cloning") return "Nhân bản giọng nói AI";
    if (slug === "ai-short-drama") return "Tạo phim ngắn AI";
    return "AI Agent";
}

function collectBrowserErrors(page: Page) {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    return errors;
}
