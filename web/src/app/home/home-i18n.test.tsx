import { describe, expect, it } from "vitest";

import { HomeAdvantagesSection, HomeProductsSection, HomeStepsSection } from "./home-static-sections";
import { HOME_PRODUCT_NAVIGATION } from "./home-data";
import { seoPublicationRegistry } from "@/i18n/routing";
import { renderWithI18n } from "@/test/render-with-i18n";

describe("home page translations", () => {
    it("hides unavailable product links in the current language", () => {
        seoPublicationRegistry["ai-agent"].published.en = false;
        try {
            expect(renderWithI18n(<HomeProductsSection />, "en")).not.toContain('href="/en/ai-agent"');
            expect(renderWithI18n(<HomeProductsSection />, "en")).not.toContain('href="/ai-agent"');
        } finally {
            seoPublicationRegistry["ai-agent"].published.en = true;
        }
    });
    it.each([
        ["vi", "Bốn bước đơn giản để biến ý tưởng thành hiện thực", "Thư viện prompt sáng tạo"],
        ["en", "Four simple steps from idea to reality", "Creative prompt library"],
        ["zh-CN", "简单四步，创意即刻落地", "创作提示词库"],
    ] as const)("renders core sections in %s", (locale, steps, advantage) => {
        const html = renderWithI18n(
            <>
                <HomeStepsSection />
                <HomeAdvantagesSection />
            </>,
            locale,
        );

        expect(html).toContain(steps);
        expect(html).toContain(advantage);
    });

    it("defines SEO descriptions and icons for all six public product links", () => {
        expect(
            HOME_PRODUCT_NAVIGATION.map((item) => ({
                href: item.href,
                descriptionKey: "descriptionKey" in item ? item.descriptionKey : undefined,
                icon: "icon" in item ? item.icon : undefined,
            })),
        ).toEqual([
            { href: "/ai-image-generator", descriptionKey: "productImageDescription", icon: "image" },
            { href: "/ai-video-generator", descriptionKey: "productVideoDescription", icon: "video" },
            { href: "/ai-voice-generator", descriptionKey: "productVoiceDescription", icon: "voice" },
            { href: "/voice-cloning", descriptionKey: "productVoiceCloningDescription", icon: "voiceCloning" },
            { href: "/ai-short-drama", descriptionKey: "productShortDramaDescription", icon: "shortDrama" },
            { href: "/ai-agent", descriptionKey: "productAgentDescription", icon: "agent" },
        ]);
    });

    it.each([
        ["vi", "Công cụ sáng tạo AI trên HOTX AI", "Tạo hình ảnh từ mô tả tiếng Việt hoặc ảnh tham chiếu cho marketing, sản phẩm và nội dung sáng tạo."],
        ["en", "AI creation tools on HOTX AI", "Create images from Vietnamese prompts or reference images for marketing, products, and creative content."],
        ["zh-CN", "HOTX AI 创作工具", "通过越南语描述或参考图生成图片，用于营销、商品与创意内容。"],
    ] as const)("renders six contextual product links in %s", (locale, title, description) => {
        const html = renderWithI18n(<HomeProductsSection />, locale);

        expect(html).toContain(title);
        expect(html).toContain(description);
        const prefix = locale === "en" ? "/en" : locale === "zh-CN" ? "/zh-cn" : "";
        for (const path of ["ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent"]) expect(html).toContain(`href="${prefix}/${path}"`);
    });
});
