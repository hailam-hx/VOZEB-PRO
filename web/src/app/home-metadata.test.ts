import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { builtInSiteCopy } from "@/i18n/site-copy";

const expectedDescription = "HOTX AI là nền tảng sáng tạo AI giúp bạn tạo ảnh, video, giọng nói, nhân bản giọng nói và sử dụng AI Agent trong một quy trình thống nhất.";

const mocks = vi.hoisted(() => ({
    getPublicSiteSettings: vi.fn(),
    headers: vi.fn(async () => new Headers({ "x-vozeb-pathname": "/" })),
    getLocale: vi.fn(async () => "vi"),
    getTranslations: vi.fn(async () => (key: string) => {
        if (key === "metadataDescription") return expectedDescription;
        if (key === "socialImageAlt") return "HOTX AI – Nền tảng sáng tạo AI cho ảnh, video, giọng nói và AI Agent";
        if (key === "footerDefaultDescription") return "Mô tả footer cũ";
        if (key === "footerDefaultKeywords") return "HOTX AI,tạo ảnh AI,tạo video AI";
        return key;
    }),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next-intl/server", () => ({
    getLocale: mocks.getLocale,
    getMessages: vi.fn(),
    getTranslations: mocks.getTranslations,
}));
vi.mock("@/lib/server/site-metadata", () => ({
    getPublicSiteSettings: mocks.getPublicSiteSettings,
    siteMetadataBase: () => new URL("https://hotx-ai.com"),
    absoluteSiteUrl: (value: string, base = new URL("https://hotx-ai.com")) => new URL(value, base).toString(),
    browserIconHref: () => "/icon.svg",
}));

import { generateMetadata as generateRootMetadata } from "./layout";
import { generateMetadata as generateHomepageMetadata } from "./page";

describe("homepage metadata", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPublicSiteSettings.mockResolvedValue({
            title: "HOTX AI",
            logoUrl: "/logo.svg",
            seoTitle: "HOTX AI - Nền tảng tạo ảnh, video và giọng nói bằng AI",
            seoDescription: builtInSiteCopy.seoDescription,
            seoKeywords: builtInSiteCopy.seoKeywords,
        });
    });

    it("publishes the canonical URL and a dedicated large social image", async () => {
        const metadata = await generateHomepageMetadata();

        expect(metadata).toMatchObject({
            description: expectedDescription,
            alternates: { canonical: "/" },
            openGraph: {
                type: "website",
                url: "/",
                description: expectedDescription,
                images: [
                    {
                        url: "/seo/hotx-ai-og.webp",
                        width: 1200,
                        height: 630,
                        alt: "HOTX AI – Nền tảng sáng tạo AI cho ảnh, video, giọng nói và AI Agent",
                    },
                ],
            },
            twitter: {
                card: "summary_large_image",
                description: expectedDescription,
                images: ["/seo/hotx-ai-og.webp"],
            },
        });
    });

    it("keeps homepage social metadata out of the root layout", async () => {
        const metadata = await generateRootMetadata();

        expect(metadata.alternates).toBeUndefined();
        expect(metadata.openGraph).toBeUndefined();
        expect(metadata.twitter).toBeUndefined();
    });

    it("ships the social image as a 1200 by 630 WebP asset", async () => {
        const image = await sharp(fileURLToPath(new URL("../../public/seo/hotx-ai-og.webp", import.meta.url))).metadata();

        expect(image).toMatchObject({ width: 1200, height: 630, format: "webp" });
    });

    it("preserves a genuinely customized SEO description", async () => {
        mocks.getPublicSiteSettings.mockResolvedValueOnce({
            title: "HOTX AI",
            logoUrl: "/logo.svg",
            seoTitle: "Custom title",
            seoDescription: "Custom homepage description",
            seoKeywords: "custom,keywords",
        });

        const metadata = await generateHomepageMetadata();

        expect(metadata.description).toBe("Custom homepage description");
        expect(metadata.openGraph?.description).toBe("Custom homepage description");
    });

    it("replaces the previous bundled Vietnamese homepage description", async () => {
        mocks.getPublicSiteSettings.mockResolvedValueOnce({
            title: "HOTX AI",
            logoUrl: "/logo.svg",
            seoTitle: "HOTX AI - Nền tảng tạo ảnh, video và giọng nói bằng AI",
            seoDescription: "HOTX AI là nền tảng sáng tạo nội dung bằng AI, hỗ trợ tạo ảnh, tạo video, giọng nói AI, nhân bản giọng nói, AI Agent, video ngắn và canvas sáng tạo trong một nền tảng duy nhất.",
            seoKeywords: "HOTX AI,AI Agent",
        });

        expect((await generateHomepageMetadata()).description).toBe(expectedDescription);
    });
});
