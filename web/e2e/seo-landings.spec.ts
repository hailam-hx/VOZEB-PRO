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

test("sitemap publishes the approved static URL priorities", async ({ page }) => {
    const response = await page.goto("/sitemap.xml", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    const xml = await response!.text();
    const entries = await page.evaluate((source) => {
        const document = new DOMParser().parseFromString(source, "application/xml");
        return Array.from(document.querySelectorAll("url")).map((entry) => ({
            path: new URL(entry.querySelector("loc")?.textContent || "").pathname,
            priority: Number(entry.querySelector("priority")?.textContent),
        }));
    }, xml);
    const staticPaths = new Set(["/", ...landings.map(({ slug }) => `/${slug}`), "/gallery", "/announcements", "/terms", "/privacy"]);

    expect(entries.filter(({ path }) => staticPaths.has(path))).toEqual([
        { path: "/", priority: 1 },
        { path: "/ai-image-generator", priority: 0.9 },
        { path: "/ai-video-generator", priority: 0.9 },
        { path: "/ai-voice-generator", priority: 0.9 },
        { path: "/voice-cloning", priority: 0.9 },
        { path: "/ai-short-drama", priority: 0.8 },
        { path: "/ai-agent", priority: 0.8 },
        { path: "/terms", priority: 0.3 },
        { path: "/privacy", priority: 0.3 },
        { path: "/gallery", priority: 0.8 },
        { path: "/announcements", priority: 0.5 },
    ]);
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

const translatedLandings = {
    vi: [
        {
            slug: "ai-image-generator",
            title: "Tạo ảnh AI online từ văn bản và ảnh | HOTX AI",
            h1: "Tạo ảnh AI online từ văn bản và ảnh tham chiếu",
            description: "Tạo ảnh AI online từ mô tả tiếng Việt hoặc ảnh tham chiếu. Tạo ảnh sản phẩm, quảng cáo và nội dung sáng tạo trong cùng workspace HOTX AI.",
        },
        {
            slug: "ai-video-generator",
            title: "Tạo video AI từ văn bản và hình ảnh | HOTX AI",
            h1: "Tạo video AI từ văn bản và hình ảnh",
            description: "Tạo video AI từ văn bản hoặc hình ảnh cho quảng cáo, TikTok và Reels. Tạo video từ ảnh, text-to-video và image-to-video trên HOTX AI.",
        },
        {
            slug: "ai-voice-generator",
            title: "Tạo giọng nói AI từ văn bản | HOTX AI",
            h1: "Tạo giọng nói AI tự nhiên từ văn bản",
            description: "Chuyển văn bản thành giọng nói AI cho video, quảng cáo, podcast và đào tạo. Tạo giọng đọc AI, nghe trực tiếp và tải tệp trên HOTX AI.",
        },
        {
            slug: "voice-cloning",
            title: "Nhân bản giọng nói AI từ mẫu giọng | HOTX AI",
            h1: "Nhân bản giọng nói AI từ mẫu thu của bạn",
            description: "Nhân bản giọng nói AI từ mẫu âm thanh mà bạn có quyền sử dụng. Tạo và quản lý hồ sơ giọng để dùng cho nội dung được cho phép trên HOTX AI.",
        },
        {
            slug: "ai-short-drama",
            title: "Tạo phim ngắn AI từ kịch bản đến video | HOTX AI",
            h1: "Tạo phim ngắn AI từ kịch bản đến cảnh quay",
            description: "Tạo phim ngắn AI theo dự án: xây dựng kịch bản, nhân vật, storyboard và tạo từng cảnh quay trong một quy trình sản xuất trên HOTX AI.",
        },
        {
            slug: "ai-agent",
            title: "AI Agent sáng tạo nội dung đa phương tiện | HOTX AI",
            h1: "AI Agent sáng tạo nội dung bằng hình ảnh, video và âm thanh",
            description: "AI Agent hỗ trợ biến brief tiếng Việt thành hình ảnh, video và âm thanh. Tự động chọn quy trình và năng lực phù hợp trong cùng workspace HOTX AI.",
        },
    ],
    en: [
        {
            slug: "ai-image-generator",
            title: "Create AI images online from text and images | HOTX AI",
            h1: "Create AI images online from text and reference images",
            description: "Create AI images online from Vietnamese descriptions or reference images. Make product images, advertising visuals and creative content in the HOTX AI workspace.",
        },
        {
            slug: "ai-video-generator",
            title: "Create AI videos from text and images | HOTX AI",
            h1: "Create AI videos from text and images",
            description: "Create AI videos from text or images for advertising, TikTok and Reels. Explore image-to-video and text-to-video in HOTX AI.",
        },
        {
            slug: "ai-voice-generator",
            title: "Generate AI voices from text | HOTX AI",
            h1: "Generate natural AI speech from text",
            description: "Turn text into AI speech for videos, ads, podcasts and training. Generate narration, listen and download files in HOTX AI.",
        },
        {
            slug: "voice-cloning",
            title: "Clone an AI voice from a recording | HOTX AI",
            h1: "Clone an AI voice from your own recording",
            description: "Clone an AI voice from audio you have permission to use. Create and manage voice profiles for authorized content in HOTX AI.",
        },
        {
            slug: "ai-short-drama",
            title: "Create AI short films from script to video | HOTX AI",
            h1: "Create AI short films from script to shots",
            description: "Create AI short films by project: develop scripts, characters, storyboards and individual shots in one HOTX AI production workflow.",
        },
        {
            slug: "ai-agent",
            title: "AI Agent for multimedia content creation | HOTX AI",
            h1: "AI Agent for creating images, videos and audio",
            description: "AI Agent helps turn Vietnamese briefs into images, videos and audio. Select suitable workflows and capabilities within the HOTX AI workspace.",
        },
    ],
    "zh-CN": [
        {
            slug: "ai-image-generator",
            title: "从文字与图片在线生成 AI 图片 | HOTX AI",
            h1: "从文字与参考图在线生成 AI 图片",
            description: "根据越南语描述或参考图在线生成 AI 图片。在 HOTX AI 工作区中制作产品图、广告图和创意内容。",
        },
        {
            slug: "ai-video-generator",
            title: "从文字与图片生成 AI 视频 | HOTX AI",
            h1: "从文字与图片生成 AI 视频",
            description: "从文字或图片生成用于广告、TikTok 和 Reels 的 AI 视频。在 HOTX AI 中使用图生视频与文生视频。",
        },
        {
            slug: "ai-voice-generator",
            title: "从文字生成 AI 语音 | HOTX AI",
            h1: "从文字生成自然的 AI 语音",
            description: "将文字转为用于视频、广告、播客和培训的 AI 语音。在 HOTX AI 中生成朗读、直接试听并下载文件。",
        },
        {
            slug: "voice-cloning",
            title: "根据录音样本克隆 AI 声音 | HOTX AI",
            h1: "根据自己的录音样本克隆 AI 声音",
            description: "使用你有权使用的音频样本克隆 AI 声音。在 HOTX AI 中创建和管理声音档案，用于获授权的内容。",
        },
        {
            slug: "ai-short-drama",
            title: "从剧本到视频制作 AI 短片 | HOTX AI",
            h1: "从剧本到镜头制作 AI 短片",
            description: "按项目制作 AI 短片，在 HOTX AI 的统一生产流程中构建剧本、角色、分镜并生成各个镜头。",
        },
        {
            slug: "ai-agent",
            title: "用于多媒体内容创作的 AI Agent | HOTX AI",
            h1: "使用 AI Agent 创作图片、视频和音频",
            description: "AI Agent 协助将越南语需求转为图片、视频和音频，在 HOTX AI 工作区中选择合适的流程与能力。",
        },
    ],
} as const;
const publicCopy = {
    vi: { home: "HOTX AI – Nền tảng sáng tạo nội dung bằng AI", terms: "Điều khoản dịch vụ", privacy: "Chính sách quyền riêng tư" },
    en: { home: "HOTX AI – A platform for AI content creation", terms: "Terms of Service", privacy: "Privacy Policy" },
    "zh-CN": { home: "HOTX AI – 一站式 AI 内容创作平台", terms: "服务条款", privacy: "隐私政策" },
} as const;

test("all 27 published URLs have localized SSR SEO independent of cookie and browser language", async ({ page, context }) => {
    test.setTimeout(240_000);
    await context.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,en;q=0.9" });
    for (const locale of ["vi", "en", "zh-CN"] as const) {
        const prefix = locale === "en" ? "/en" : locale === "zh-CN" ? "/zh-cn" : "";
        const pages = [{ slug: "", h1: publicCopy[locale].home }, ...translatedLandings[locale], { slug: "terms", h1: publicCopy[locale].terms }, { slug: "privacy", h1: publicCopy[locale].privacy }];
        for (const item of pages) {
            await context.addCookies([{ name: "vozeb-pro-locale", value: locale === "en" ? "zh-CN" : "en", url: String(test.info().project.use.baseURL) }]);
            const suffix = item.slug ? "/" + item.slug : "";
            const path = prefix + suffix || "/";
            const response = await page.goto(path, { waitUntil: "domcontentloaded" });
            expect(response?.status(), path).toBe(200);
            const html = await response!.text();
            expect(html).toMatch(/<h1[\s>]/);
            expect(html).toMatch(/<link[^>]*rel="canonical"/);
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            await expect(page.locator("h1")).toHaveCount(1);
            await expect(page.getByRole("heading", { level: 1, name: item.h1 })).toBeVisible();
            const title = await page.title();
            expect(title.trim()).not.toBe("");
            if ("title" in item) await expect(page).toHaveTitle(item.title);
            else if (item.slug) expect(title).toBe(item.h1);
            else if (locale === "en") expect(title).toContain("AI image, video and voice creation");
            else if (locale === "zh-CN") expect(title).toContain("AI 图片、视频与语音创作");
            const description = await page.locator('meta[name="description"]').getAttribute("content");
            expect(description?.trim()).toBeTruthy();
            if ("description" in item) expect(description).toBe(item.description);
            const canonical = new URL(path, String(test.info().project.use.baseURL)).toString();
            await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
            const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.getAttribute("hreflang"), node.getAttribute("href")])));
            const base = String(test.info().project.use.baseURL);
            expect(alternates).toEqual({
                vi: new URL(suffix || "/", base).toString(),
                en: new URL("/en" + suffix, base).toString(),
                "zh-Hans": new URL("/zh-cn" + suffix, base).toString(),
                "x-default": new URL(suffix || "/", base).toString(),
            });
            await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
            await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", title);
            await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", description!);
            await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", locale === "vi" ? "vi_VN" : locale === "en" ? "en_US" : "zh_CN");
            await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", title);
            await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute("content", description!);
            await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https?:\/\//);
            const imageAlt = await page.locator('meta[property="og:image:alt"]').getAttribute("content");
            expect(imageAlt?.trim()).toBeTruthy();
            await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute("content", imageAlt!);
            const website = JSON.parse((await page.locator("#website-json-ld").textContent())!);
            expect(website).toMatchObject({ url: new URL(prefix || "/", base).toString(), inLanguage: locale });
            if (item.slug) {
                const data = JSON.parse((await page.locator(item.slug === "terms" || item.slug === "privacy" ? "#seo-page-json-ld" : "#seo-landing-json-ld").textContent())!);
                const webpage = data["@graph"]?.[0] || data;
                expect(webpage).toMatchObject({ url: canonical, inLanguage: locale, description });
            }
            await expectNoHorizontalOverflow(page, path);
        }
    }
});

test("VI aliases redirect and localized workspace or invalid locale routes stay excluded", async ({ request }) => {
    for (const suffix of ["", "/ai-image-generator", "/ai-video-generator", "/ai-voice-generator", "/voice-cloning", "/ai-short-drama", "/ai-agent", "/terms", "/privacy"]) {
        const response = await request.get("/vi" + suffix + "?source=locale", { maxRedirects: 0 });
        expect(response.status()).toBe(308);
        const location = new URL(response.headers().location, String(test.info().project.use.baseURL));
        expect(location.pathname).toBe(suffix || "/");
        expect(location.search).toBe("?source=locale");
    }
    for (const prefix of ["/en", "/zh-cn", "/vi"])
        for (const path of ["/create", "/canvas", "/drama", "/gallery", "/admin", "/share/example", "/api/auth/session"]) {
            expect((await request.get(prefix + path)).status(), prefix + path).toBe(404);
        }
    for (const path of ["/fr/terms", "/fr/privacy", "/fr/ai-agent", "/fr", "/en/unpublished"]) expect((await request.get(path)).status(), path).toBe(404);
});

test("SEO language switcher keeps the same page and fits desktop and mobile", async ({ page }) => {
    for (const slug of ["", "/ai-image-generator", "/terms", "/privacy"]) {
        await page.goto("/en" + slug);
        await page.getByRole("button", { name: "Change language" }).click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        const rect = await menu.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        await page.getByRole("menuitem", { name: "简体中文" }).click();
        await expect(page).toHaveURL(new URL("/zh-cn" + slug, String(test.info().project.use.baseURL)).toString());
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        const chineseHeading = slug === "/terms" ? "服务条款" : slug === "/privacy" ? "隐私政策" : slug === "/ai-image-generator" ? "从文字与参考图在线生成 AI 图片" : "HOTX AI – 一站式 AI 内容创作平台";
        await expect(page.getByRole("heading", { level: 1, name: chineseHeading })).toBeVisible();
        await expect(page.locator("#website-json-ld")).toHaveCount(1);
        expect(JSON.parse((await page.locator("#website-json-ld").textContent())!)).toMatchObject({ inLanguage: "zh-CN", url: new URL("/zh-cn", String(test.info().project.use.baseURL)).toString() });
        await page.getByRole("button", { name: "切换语言" }).click();
        await page.getByRole("menuitem", { name: "Tiếng Việt" }).click();
        await expect(page).toHaveURL(new URL(slug || "/", String(test.info().project.use.baseURL)).toString());
        await expect(page.locator("html")).toHaveAttribute("lang", "vi");
        const vietnameseHeading =
            slug === "/terms" ? "Điều khoản dịch vụ" : slug === "/privacy" ? "Chính sách quyền riêng tư" : slug === "/ai-image-generator" ? "Tạo ảnh AI online từ văn bản và ảnh tham chiếu" : "HOTX AI – Nền tảng sáng tạo nội dung bằng AI";
        await expect(page.getByRole("heading", { level: 1, name: vietnameseHeading })).toBeVisible();
    }
});

for (const destination of ["gallery", "create"] as const) {
    test(`SEO language persists through a real ${destination} link or CTA before reload`, async ({ page, context }) => {
        await page.goto(destination === "gallery" ? "/en" : "/en/ai-image-generator");
        await page.getByRole("button", { name: "Change language" }).click();
        await page.getByRole("menuitem").filter({ hasText: "简体中文" }).click();
        await expect(page).toHaveURL(destination === "gallery" ? /\/zh-cn$/ : /\/zh-cn\/ai-image-generator$/);
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await expect.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "vozeb-pro-locale")?.value).toBe("zh-CN");
        const documentStart = await page.evaluate(() => performance.timeOrigin);

        if (destination === "gallery") await page.getByRole("link", { name: "作品广场", exact: true }).last().click();
        else await page.getByRole("button", { name: "开始 AI 生图", exact: true }).first().click();

        await expect(page).toHaveURL(new RegExp(`/${destination}(?:#.*)?$`));
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        if (destination === "gallery") {
            await expect(page.getByRole("heading", { name: "灵感发现", exact: true })).toBeVisible();
            await expect(page.getByPlaceholder("搜索标题、说明或提示词")).toBeVisible();
        } else {
            await expect(page.getByRole("button", { name: "切换语言" })).toBeVisible();
            await expect(page.getByPlaceholder("输入你的创作想法、脚本或画面要求")).toBeVisible();
        }
        expect((await context.cookies()).find((cookie) => cookie.name === "vozeb-pro-locale")?.value).toBe("zh-CN");
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
        if (destination === "create") {
            await page.getByPlaceholder("输入你的创作想法、脚本或画面要求").fill("Keep the draft after leaving SEO");
            await page.getByRole("button", { name: "切换语言" }).click();
            await page.getByRole("menuitem").filter({ hasText: "English" }).click();
            await expect(page.locator("html")).toHaveAttribute("lang", "en");
            await expect(page.getByPlaceholder("Enter an idea, script, or visual requirements")).toHaveValue("Keep the draft after leaving SEO");
            expect((await context.cookies()).find((cookie) => cookie.name === "vozeb-pro-locale")?.value).toBe("en");
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
        }
    });
}

test("admin localized SEO persists immediately across tabs, refresh, session and home metadata", async ({ page, request }) => {
    const original = (await (await request.get("/api/admin/settings")).json()).settings.site;
    const entries = [
        { tab: "VI", locale: "vi", path: "/", title: "Tiêu đề thử nghiệm", description: "Mô tả tiếng Việt riêng biệt", keywords: "ảnh,video" },
        { tab: "EN", locale: "en", path: "/en", title: "English SEO test title", description: "Independent English SEO description", keywords: "image,voice" },
        { tab: "简体中文", locale: "zh-CN", path: "/zh-cn", title: "中文 SEO 测试标题", description: "独立中文 SEO 描述", keywords: "图片,语音" },
    ];
    try {
        for (const entry of entries) await request.get(entry.path);
        await page.goto("/admin?section=site", { waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
        for (const entry of entries) {
            await page.getByRole("tab", { name: entry.tab, exact: true }).click();
            await page.getByRole("textbox", { name: "SEO 标题", exact: true }).fill(entry.title);
            await page.getByRole("textbox", { name: "SEO 描述", exact: true }).fill(entry.description);
            await page.getByRole("textbox", { name: "SEO 关键词", exact: true }).fill(entry.keywords);
            await expect(page.getByText(entry.title, { exact: true })).toBeVisible();
            await expect(page.locator("p").filter({ hasText: entry.description })).toBeVisible();
            await expectNoHorizontalOverflow(page, "admin SEO " + entry.locale);
        }
        const response = page.waitForResponse((response) => response.url().endsWith("/api/admin/settings") && response.request().method() === "PATCH");
        await page.getByRole("button", { name: "保存网站设置" }).click();
        expect((await response).ok()).toBe(true);
        const expected = Object.fromEntries(entries.map(({ locale, title, description, keywords }) => [locale, { title, description, keywords }]));
        expect((await (await request.get("/api/admin/settings")).json()).settings.site.seo).toEqual(expected);
        expect((await (await request.get("/api/auth/session")).json()).settings.site.seo).toEqual(expected);
        await page.reload();
        for (const entry of entries) {
            await page.getByRole("tab", { name: entry.tab, exact: true }).click();
            await expect(page.getByRole("textbox", { name: "SEO 标题", exact: true })).toHaveValue(entry.title);
            await expect(page.getByRole("textbox", { name: "SEO 描述", exact: true })).toHaveValue(entry.description);
            await expect(page.getByRole("textbox", { name: "SEO 关键词", exact: true })).toHaveValue(entry.keywords);
        }
        for (const entry of entries) {
            await page.goto(entry.path);
            expect(await page.title()).toBe(entry.title);
            await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", entry.description);
            await expect(page.locator('meta[name="keywords"]')).toHaveAttribute("content", entry.keywords);
            await expect(page.locator("footer p").filter({ hasText: entry.description })).toBeVisible();
            expect(JSON.parse((await page.locator("#website-json-ld").textContent())!).description).toBe(entry.description);
        }
        await page.goto("/admin?section=site");
        await page.getByRole("tab", { name: "EN", exact: true }).click();
        await page.getByRole("textbox", { name: "SEO 标题", exact: true }).fill("");
        await page.getByRole("textbox", { name: "SEO 描述", exact: true }).fill("");
        await page.getByRole("textbox", { name: "SEO 关键词", exact: true }).fill("");
        const clearedResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/settings") && response.request().method() === "PATCH");
        await page.getByRole("button", { name: "保存网站设置" }).click();
        expect((await clearedResponse).ok()).toBe(true);
        const cleared = (await (await request.get("/api/admin/settings")).json()).settings.site.seo;
        expect(cleared.en.description).toContain("AI creation platform");
        expect(cleared.vi).toEqual(expected.vi);
        expect(cleared["zh-CN"]).toEqual(expected["zh-CN"]);
        await expect(page.getByRole("textbox", { name: "SEO 描述", exact: true })).toHaveValue(cleared.en.description);
        await page.reload();
        await page.getByRole("tab", { name: "EN", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "SEO 描述", exact: true })).toHaveValue(cleared.en.description);
        for (const theme of ["light", "dark"]) {
            await page.evaluate((theme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme }, version: 0 })), theme);
            await page.reload({ waitUntil: "domcontentloaded" });
            await expect(page.locator(".admin-dashboard-shell")).toHaveAttribute("data-hydrated", "true");
            await page.getByRole("tab", { name: "EN", exact: true }).click();
            await expect(page.getByRole("textbox", { name: "SEO 描述", exact: true })).toHaveValue(cleared.en.description);
            const bounds = await page.getByRole("textbox", { name: "SEO 描述", exact: true }).boundingBox();
            expect(bounds!.width).toBeGreaterThan(0);
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
            await expectNoHorizontalOverflow(page, "admin SEO " + theme);
            await page.getByRole("tab", { name: "EN", exact: true }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: test.info().outputPath("admin-seo-" + theme + ".png") });
        }
    } finally {
        expect((await request.patch("/api/admin/settings", { data: { site: original } })).ok()).toBe(true);
    }
});

test("sitemap has exactly 27 localized SEO entries without xhtml alternatives", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    const xml = await response.text();
    const paths = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
    const expected = ["", "/en", "/zh-cn"].flatMap((prefix) => ["", ...landings.map((item) => "/" + item.slug), "/terms", "/privacy"].map((suffix) => prefix + suffix || "/"));
    expect(expected).toHaveLength(27);
    expect(paths.filter((path) => expected.includes(path)).sort()).toEqual(expected.sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => path === "/gallery")).toHaveLength(1);
    expect(paths.filter((path) => path === "/announcements")).toHaveLength(1);
    expect(xml).not.toMatch(/xhtml:link|hreflang/);
});
