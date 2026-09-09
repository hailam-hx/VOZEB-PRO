import { describe, expect, it } from "vitest";

import { buildCreativeWorkStructuredData, buildSeoLandingStructuredData, buildWebsiteStructuredData, serializeStructuredData } from "./structured-data";

describe("structured data", () => {
    it("builds the public website identity with its configured logo", () => {
        expect(
            buildWebsiteStructuredData({
                name: "无限进化",
                description: "视觉创作平台",
                url: "https://example.com/",
                logoUrl: "https://example.com/logo.svg",
            }),
        ).toMatchObject({
            "@type": "WebSite",
            "@id": "https://example.com/#website",
            publisher: {
                "@type": "Organization",
                "@id": "https://example.com/#organization",
                name: "无限进化",
                url: "https://example.com/",
                logo: { url: "https://example.com/logo.svg" },
            },
        });
    });

    it("escapes script-closing content while preserving valid JSON", () => {
        const serialized = serializeStructuredData({ description: '</script><script>alert("x")</script>' });

        expect(serialized).not.toContain("<");
        expect(JSON.parse(serialized)).toEqual({ description: '</script><script>alert("x")</script>' });
    });

    it("builds WebPage and BreadcrumbList data for a Vietnamese SEO landing", () => {
        const data = buildSeoLandingStructuredData({
            url: "https://hotx-ai.com/ai-image-generator",
            websiteId: "https://hotx-ai.com/#website",
            title: "Tạo ảnh AI online từ văn bản và ảnh | HOTX AI",
            description: "Tạo ảnh AI từ mô tả tiếng Việt.",
            breadcrumbName: "Tạo ảnh AI",
            imageUrl: "https://hotx-ai.com/seo/hotx-create-workspace.webp",
        });

        expect(data).toMatchObject({
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebPage",
                    "@id": "https://hotx-ai.com/ai-image-generator#webpage",
                    inLanguage: "vi",
                    isPartOf: { "@id": "https://hotx-ai.com/#website" },
                    primaryImageOfPage: { url: "https://hotx-ai.com/seo/hotx-create-workspace.webp" },
                },
                {
                    "@type": "BreadcrumbList",
                    itemListElement: [
                        { position: 1, name: "Trang chủ", item: "https://hotx-ai.com/" },
                        { position: 2, name: "Tạo ảnh AI", item: "https://hotx-ai.com/ai-image-generator" },
                    ],
                },
            ],
        });
        expect(JSON.parse(serializeStructuredData(data))).toEqual(data);
        expect(JSON.stringify(data)).not.toMatch(/FAQPage|SoftwareApplication/);
    });

    it("only exposes the approved CreativeWork fields for public works", () => {
        const data = buildCreativeWorkStructuredData({
            visibility: "public",
            url: "https://example.com/share/public-work",
            websiteId: "https://example.com/#website",
            title: "公开作品",
            description: "作品说明",
            publishedAt: "2026-07-27T00:00:00.000Z",
            category: "电商",
            tags: ["产品"],
            authorName: "创作者",
            imageUrl: "https://example.com/api/public/works/public-work/media/cover",
        });

        expect(data).toMatchObject({ "@type": "CreativeWork", name: "公开作品", author: { name: "创作者" }, keywords: ["产品"] });
        expect(JSON.stringify(data)).not.toMatch(/userId|owner|model|metadata/);
    });

    it.each(["unlisted", "private"] as const)("does not produce CreativeWork data for %s works", (visibility) => {
        expect(
            buildCreativeWorkStructuredData({
                visibility,
                url: "https://example.com/share/private-work",
                websiteId: "https://example.com/#website",
                title: "非公开作品",
                description: "",
                publishedAt: "2026-07-27T00:00:00.000Z",
                category: "其他",
                tags: [],
            }),
        ).toBeNull();
    });
});
