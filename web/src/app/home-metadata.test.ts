import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store-foundation";

const configuredSeo = {
    vi: {
        title: "HOTX AI - Nền tảng tạo ảnh, video và giọng nói bằng AI",
        description: "HOTX AI là nền tảng sáng tạo AI giúp bạn tạo ảnh, video và giọng nói trong một quy trình thống nhất.",
        keywords: "HOTX AI,AI Agent,hình ảnh AI,video AI",
    },
    en: {
        title: "HOTX AI - AI image, video and voice creation",
        description: "HOTX AI is a unified AI creation platform for images, video and voice.",
        keywords: "HOTX AI,AI Agent,AI image,AI video",
    },
    "zh-CN": {
        title: "HOTX AI - AI 图片、视频与语音创作",
        description: "HOTX AI 是统一的 AI 图片、视频与语音创作平台。",
        keywords: "HOTX AI,AI Agent,AI 绘图,AI 视频",
    },
};
const mocks = vi.hoisted(() => ({ getPublicSiteSettings: vi.fn(), getLocale: vi.fn(async () => "vi"), headers: vi.fn(async () => new Headers({ "x-vozeb-pathname": "/" })) }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/server/install-status", () => ({ getInstallStatus: vi.fn(async () => ({ ready: true })) }));
vi.mock("next-intl/server", () => ({ getLocale: mocks.getLocale, getMessages: vi.fn(), getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock("@/lib/server/site-metadata", () => ({
    getPublicSiteSettings: mocks.getPublicSiteSettings,
    siteMetadataBase: () => new URL("https://hotx-ai.com"),
    absoluteSiteUrl: (value: string, base = new URL("https://hotx-ai.com")) => new URL(value, base).toString(),
    browserIconHref: () => "/hx-favicon.png",
}));
import { generateMetadata as generateRootMetadata } from "./layout";
import LocalizedLayout from "./[locale]/layout";
import HomePage, { generateMetadata } from "./[locale]/page";
import manifest from "./manifest";

describe("homepage metadata", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPublicSiteSettings.mockResolvedValue({ ...DEFAULT_SITE_SETTINGS, title: "HOTX AI", seo: configuredSeo });
    });
    for (const [locale, path, ogLocale] of [
        ["vi", "/", "vi_VN"],
        ["en", "/en", "en_US"],
        ["zh-CN", "/zh-cn", "zh_CN"],
    ] as const) {
        it(`reads only ${locale} SEO for metadata, initial state and Website JSON-LD`, async () => {
            const params = Promise.resolve({ locale });
            const metadata = await generateMetadata({ params });
            expect(metadata).toMatchObject({
                title: configuredSeo[locale].title,
                description: configuredSeo[locale].description,
                keywords: configuredSeo[locale].keywords.split(","),
                alternates: { canonical: `https://hotx-ai.com${path}` },
                openGraph: { title: configuredSeo[locale].title, description: configuredSeo[locale].description, locale: ogLocale, images: [{ url: "https://hotx-ai.com/seo/hotx-ai-og.webp", width: 1200, height: 630 }] },
                twitter: { card: "summary_large_image", title: configuredSeo[locale].title, description: configuredSeo[locale].description },
            });
            expect(metadata.alternates?.languages).toEqual({ vi: "https://hotx-ai.com/", en: "https://hotx-ai.com/en", "zh-Hans": "https://hotx-ai.com/zh-cn", "x-default": "https://hotx-ai.com/" });
            const homepage = await HomePage({ params });
            expect(homepage.props.initialSite.seo[locale]).toEqual(configuredSeo[locale]);
            const layout = await LocalizedLayout({ children: null, params });
            const data = JSON.parse(layout.props.children[0].props.dangerouslySetInnerHTML.__html);
            expect(data).toMatchObject({ url: `https://hotx-ai.com${path}`, "@id": `https://hotx-ai.com${path}#website`, inLanguage: locale, description: configuredSeo[locale].description });
        });
    }
    it("keeps homepage social metadata out of the root layout", async () => {
        const metadata = await generateRootMetadata();
        expect(metadata).toMatchObject({ title: configuredSeo.vi.title, description: configuredSeo.vi.description });
        expect(metadata.alternates).toBeUndefined();
        expect(metadata.openGraph).toBeUndefined();
        expect(metadata.twitter).toBeUndefined();
    });
    it("uses the title identity without synthesizing blank SEO metadata", async () => {
        mocks.getPublicSiteSettings.mockResolvedValue({ ...DEFAULT_SITE_SETTINGS, title: "HOTX AI" });
        const metadata = await generateMetadata({ params: Promise.resolve({ locale: "vi" }) });
        expect(metadata.title).toBe("HOTX AI");
        expect(metadata.description).toBeUndefined();
        expect(metadata.keywords).toEqual([]);
        expect(metadata.openGraph).toMatchObject({ title: "HOTX AI" });
    });
    it("uses the normalized site title and omits a blank manifest description", async () => {
        mocks.getPublicSiteSettings.mockResolvedValue({ ...DEFAULT_SITE_SETTINGS, title: "", seo: { ...DEFAULT_SITE_SETTINGS.seo, vi: { title: "", description: "", keywords: "" } } });
        await expect(manifest()).resolves.toMatchObject({ name: "", short_name: "", description: undefined });
    });
    it("ships a 1200 by 630 WebP social image", async () => {
        expect(await sharp(fileURLToPath(new URL("../../public/seo/hotx-ai-og.webp", import.meta.url))).metadata()).toMatchObject({ width: 1200, height: 630, format: "webp" });
    });
});
