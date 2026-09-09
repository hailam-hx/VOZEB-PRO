import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { builtInSiteCopy } from "@/i18n/site-copy";

const expectedDescription = "HOTX AI là nền tảng sáng tạo AI giúp bạn tạo ảnh, video, giọng nói, nhân bản giọng nói và sử dụng AI Agent trong một quy trình thống nhất.";

const mocks = vi.hoisted(() => ({
    getPublicSiteSettings: vi.fn(),
    getInstallStatus: vi.fn(async () => ({ ready: true })),
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
vi.mock("@/lib/server/install-status", () => ({ getInstallStatus: mocks.getInstallStatus }));
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
import LocalizedLayout from "./[locale]/layout";
import HomePage, { generateMetadata as generateHomepageMetadata } from "./[locale]/page";

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

    it("uses the explicit EN route for self canonical despite a VI request locale", async () => {
        const metadata = await generateHomepageMetadata({ params: Promise.resolve({ locale: "en" }) });
        expect(metadata.alternates).toMatchObject({ canonical: "https://hotx-ai.com/en", languages: { vi: "https://hotx-ai.com/", en: "https://hotx-ai.com/en", "zh-Hans": "https://hotx-ai.com/zh-cn", "x-default": "https://hotx-ai.com/" } });
        expect(metadata.openGraph).toMatchObject({ locale: "en_US" });
    });

    it("publishes the canonical URL and a dedicated large social image", async () => {
        const metadata = await generateHomepageMetadata({ params: Promise.resolve({ locale: "vi" }) });

        expect(metadata).toMatchObject({
            metadataBase: null,
            description: expectedDescription,
            alternates: { canonical: "https://hotx-ai.com/" },
            openGraph: {
                type: "website",
                url: "https://hotx-ai.com/",
                description: expectedDescription,
                images: [
                    {
                        url: "https://hotx-ai.com/seo/hotx-ai-og.webp",
                        width: 1200,
                        height: 630,
                        alt: "HOTX AI – Nền tảng sáng tạo AI cho ảnh, video, giọng nói và AI Agent",
                    },
                ],
            },
            twitter: {
                card: "summary_large_image",
                description: expectedDescription,
                images: [{ url: "https://hotx-ai.com/seo/hotx-ai-og.webp", alt: "HOTX AI – Nền tảng sáng tạo AI cho ảnh, video, giọng nói và AI Agent", width: 1200, height: 630 }],
            },
        });
    });

    it("passes the localized SEO description into the homepage client state", async () => {
        const homepage = await HomePage({ params: Promise.resolve({ locale: "vi" }) });

        expect(homepage.props.initialSite.seoDescription).toBe(expectedDescription);
    });

    it("does not put scalar Vietnamese copy into an English homepage state", async () => {
        mocks.getPublicSiteSettings.mockResolvedValueOnce({ title: "HOTX AI", seoDescription: "Nội dung tùy chỉnh tiếng Việt" });
        mocks.getTranslations.mockResolvedValueOnce((key: string) => (key === "metadataDescription" ? "An English creation platform description." : key));
        const homepage = await HomePage({ params: Promise.resolve({ locale: "en" }) });
        expect(homepage.props.initialSite.seoDescription).toBe("An English creation platform description.");
    });

    it("uses the locale layout identity in Website JSON-LD", async () => {
        const layout = await LocalizedLayout({ children: null, params: Promise.resolve({ locale: "en" }) });
        const data = JSON.parse(layout.props.children[0].props.dangerouslySetInnerHTML.__html);
        expect(data).toMatchObject({ url: "https://hotx-ai.com/en", "@id": "https://hotx-ai.com/en#website", inLanguage: "en" });
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

        const metadata = await generateHomepageMetadata({ params: Promise.resolve({ locale: "vi" }) });

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

        expect((await generateHomepageMetadata({ params: Promise.resolve({ locale: "vi" }) })).description).toBe(expectedDescription);
    });
});
