import { describe, expect, it } from "vitest";

import { SEO_LANDING_DEFINITIONS, SEO_LANDING_SLUGS, getSeoLandingDefinition, isSeoLandingSlug } from "./seo-landing-data";

const expectedSlugs = ["ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent"] as const;

describe("SEO landing definitions", () => {
    it("publishes exactly the six approved slugs", () => {
        expect(SEO_LANDING_SLUGS).toEqual(expectedSlugs);
        expect(Object.keys(SEO_LANDING_DEFINITIONS)).toEqual(expectedSlugs);
        expect(isSeoLandingSlug("ai-agent")).toBe(true);
        expect(isSeoLandingSlug("unapproved-page")).toBe(false);
        expect(getSeoLandingDefinition("unapproved-page")).toBeUndefined();
    });

    it("keeps the title, description, H1 and primary keyword unique", () => {
        for (const field of ["title", "description", "h1", "primaryKeyword"] as const) {
            const values = expectedSlugs.map((slug) => SEO_LANDING_DEFINITIONS[slug][field]);
            expect(new Set(values).size, field).toBe(expectedSlugs.length);
            expect(
                values.every((value) => value.trim().length > 0),
                field,
            ).toBe(true);
        }
    });

    it("uses the approved search-intent copy for every landing page", () => {
        expect(SEO_LANDING_DEFINITIONS["ai-image-generator"]).toMatchObject({
            secondaryKeywords: ["trình tạo ảnh AI", "tạo ảnh AI online", "tạo ảnh từ văn bản", "tạo ảnh từ ảnh", "AI image generator", "text to image"],
            h1: "Tạo ảnh AI online từ văn bản và ảnh tham chiếu",
            description: "Tạo ảnh AI online từ mô tả tiếng Việt hoặc ảnh tham chiếu. Tạo ảnh sản phẩm, quảng cáo và nội dung sáng tạo trong cùng workspace HOTX AI.",
            showcaseTitle: "Tạo ảnh AI từ văn bản và ảnh tham chiếu",
            useCasesTitle: "Ứng dụng của trình tạo ảnh AI",
            stepsTitle: "Cách tạo ảnh AI online với HOTX AI",
            capabilitiesTitle: "Tính năng của trình tạo ảnh AI",
        });
        expect(SEO_LANDING_DEFINITIONS["ai-video-generator"]).toMatchObject({
            secondaryKeywords: ["trình tạo video AI", "tạo video từ văn bản", "tạo video từ ảnh", "AI video generator", "text to video", "image to video"],
            description: "Tạo video AI từ văn bản hoặc hình ảnh cho quảng cáo, TikTok và Reels. Tạo video từ ảnh, text-to-video và image-to-video trên HOTX AI.",
            showcaseTitle: "Tạo video AI từ văn bản và hình ảnh",
            useCasesTitle: "Tạo video AI cho quảng cáo, TikTok và Reels",
            stepsTitle: "Cách tạo video AI online",
            capabilitiesTitle: "Tính năng của trình tạo video AI",
        });
        expect(SEO_LANDING_DEFINITIONS["ai-voice-generator"]).toMatchObject({
            secondaryKeywords: ["giọng đọc AI", "chuyển văn bản thành giọng nói", "text to speech tiếng Việt", "AI voice generator", "lồng tiếng AI"],
            description: "Chuyển văn bản thành giọng nói AI cho video, quảng cáo, podcast và đào tạo. Tạo giọng đọc AI, nghe trực tiếp và tải tệp trên HOTX AI.",
            showcaseTitle: "Chuyển văn bản thành giọng nói AI",
            useCasesTitle: "Tạo giọng đọc AI cho video và nội dung",
            stepsTitle: "Cách tạo giọng nói AI",
            capabilitiesTitle: "Tính năng tạo giọng nói AI",
        });
        expect(SEO_LANDING_DEFINITIONS["voice-cloning"]).toMatchObject({
            secondaryKeywords: ["clone giọng nói", "voice cloning", "AI voice clone", "sao chép giọng nói", "nhân bản giọng nói online"],
            title: "Nhân bản giọng nói AI từ mẫu giọng | HOTX AI",
            description: "Nhân bản giọng nói AI từ mẫu âm thanh mà bạn có quyền sử dụng. Tạo và quản lý hồ sơ giọng để dùng cho nội dung được cho phép trên HOTX AI.",
            showcaseTitle: "Nhân bản giọng nói AI hoạt động như thế nào?",
            useCasesTitle: "Ứng dụng của voice cloning",
            stepsTitle: "Cách clone giọng nói từ mẫu âm thanh",
            capabilitiesTitle: "Tính năng nhân bản giọng nói AI",
        });
        expect(SEO_LANDING_DEFINITIONS["ai-short-drama"]).toMatchObject({
            secondaryKeywords: ["làm phim bằng AI", "tạo phim bằng AI", "AI làm phim", "tạo kịch bản AI", "tạo video AI từ kịch bản", "AI short drama"],
            title: "Tạo phim ngắn AI từ kịch bản đến video | HOTX AI",
            h1: "Tạo phim ngắn AI từ kịch bản đến cảnh quay",
            description: "Tạo phim ngắn AI theo dự án: xây dựng kịch bản, nhân vật, storyboard và tạo từng cảnh quay trong một quy trình sản xuất trên HOTX AI.",
            showcaseTitle: "Tạo phim ngắn AI từ kịch bản đến video",
            useCasesTitle: "Ứng dụng của AI trong sản xuất phim ngắn",
            stepsTitle: "Làm phim bằng AI theo từng bước",
            capabilitiesTitle: "Tính năng workspace phim ngắn AI",
        });
        expect(SEO_LANDING_DEFINITIONS["ai-agent"]).toMatchObject({
            secondaryKeywords: ["AI Agent Việt Nam", "AI Agent sáng tạo nội dung", "AI Agent tạo nội dung", "trợ lý AI", "AI Agent đa phương tiện", "AI automation"],
            h1: "AI Agent sáng tạo nội dung bằng hình ảnh, video và âm thanh",
            description: "AI Agent hỗ trợ biến brief tiếng Việt thành hình ảnh, video và âm thanh. Tự động chọn quy trình và năng lực phù hợp trong cùng workspace HOTX AI.",
            showcaseTitle: "AI Agent là gì và HOTX AI hỗ trợ những gì?",
            useCasesTitle: "Ứng dụng AI Agent trong marketing và sáng tạo nội dung",
            stepsTitle: "AI Agent sáng tạo nội dung hoạt động như thế nào?",
            capabilitiesTitle: "Tính năng của AI Agent",
        });
        expect(JSON.stringify(SEO_LANDING_DEFINITIONS).toLowerCase()).not.toContain("nhanh");
    });

    it("maps every CTA to the approved product destination", () => {
        expect(SEO_LANDING_DEFINITIONS["ai-image-generator"].cta).toMatchObject({ kind: "create", mode: "image" });
        expect(SEO_LANDING_DEFINITIONS["ai-video-generator"].cta).toMatchObject({ kind: "create", mode: "video" });
        expect(SEO_LANDING_DEFINITIONS["ai-voice-generator"].cta).toMatchObject({ kind: "create", mode: "audio" });
        expect(SEO_LANDING_DEFINITIONS["ai-agent"].cta).toMatchObject({ kind: "create", mode: "agent" });
        expect(SEO_LANDING_DEFINITIONS["voice-cloning"].cta).toEqual({ kind: "workspace", href: "/voices", label: "Nhân bản giọng nói của tôi" });
        expect(SEO_LANDING_DEFINITIONS["ai-short-drama"].cta).toEqual({ kind: "workspace", href: "/drama", label: "Bắt đầu dự án phim ngắn" });
    });

    it("provides three valid, distinct related landing links per page", () => {
        const validSlugs = new Set(SEO_LANDING_SLUGS);

        for (const slug of expectedSlugs) {
            const related = SEO_LANDING_DEFINITIONS[slug].related;
            expect(related).toHaveLength(3);
            expect(new Set(related).size).toBe(3);
            expect(related).not.toContain(slug);
            expect(related.every((candidate) => validSlugs.has(candidate))).toBe(true);
        }
    });

    it("contains substantive, page-specific HTML content", () => {
        for (const slug of expectedSlugs) {
            const definition = SEO_LANDING_DEFINITIONS[slug];
            expect(definition.useCases.length).toBeGreaterThanOrEqual(3);
            expect(definition.steps.length).toBeGreaterThanOrEqual(3);
            expect(definition.capabilities.length).toBeGreaterThanOrEqual(3);
            expect(definition.faqs.length).toBeGreaterThanOrEqual(4);
            expect(definition.secondaryKeywords.length).toBeGreaterThanOrEqual(3);
        }
    });
});
