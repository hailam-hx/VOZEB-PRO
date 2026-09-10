import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store-foundation";

const seo = {
    vi: { title: "Tiêu đề tùy chỉnh", description: "Mô tả tùy chỉnh", keywords: "ảnh,video" },
    en: { title: "Custom English title", description: "Custom English description", keywords: "image,video" },
    "zh-CN": { title: "自定义中文标题", description: "自定义中文描述", keywords: "图片,视频" },
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

describe("homepage metadata", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPublicSiteSettings.mockResolvedValue({ ...DEFAULT_SITE_SETTINGS, title: "HOTX AI", seo });
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
                title: seo[locale].title,
                description: seo[locale].description,
                keywords: seo[locale].keywords.split(","),
                alternates: { canonical: `https://hotx-ai.com${path}` },
                openGraph: { title: seo[locale].title, description: seo[locale].description, locale: ogLocale, images: [{ url: "https://hotx-ai.com/seo/hotx-ai-og.webp", width: 1200, height: 630 }] },
                twitter: { card: "summary_large_image", title: seo[locale].title, description: seo[locale].description },
            });
            expect(metadata.alternates?.languages).toEqual({ vi: "https://hotx-ai.com/", en: "https://hotx-ai.com/en", "zh-Hans": "https://hotx-ai.com/zh-cn", "x-default": "https://hotx-ai.com/" });
            const homepage = await HomePage({ params });
            expect(homepage.props.initialSite.seo[locale]).toEqual(seo[locale]);
            const layout = await LocalizedLayout({ children: null, params });
            const data = JSON.parse(layout.props.children[0].props.dangerouslySetInnerHTML.__html);
            expect(data).toMatchObject({ url: `https://hotx-ai.com${path}`, "@id": `https://hotx-ai.com${path}#website`, inLanguage: locale, description: seo[locale].description });
        });
    }
    it("keeps homepage social metadata out of the root layout", async () => {
        const metadata = await generateRootMetadata();
        expect(metadata).toMatchObject({ title: seo.vi.title, description: seo.vi.description });
        expect(metadata.alternates).toBeUndefined();
        expect(metadata.openGraph).toBeUndefined();
        expect(metadata.twitter).toBeUndefined();
    });
    it("ships a 1200 by 630 WebP social image", async () => {
        expect(await sharp(fileURLToPath(new URL("../../public/seo/hotx-ai-og.webp", import.meta.url))).metadata()).toMatchObject({ width: 1200, height: 630, format: "webp" });
    });
});
