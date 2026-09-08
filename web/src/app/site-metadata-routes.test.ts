import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getPublicSiteSettings: vi.fn(),
    siteMetadataBase: vi.fn(() => new URL("https://example.com")),
    absoluteSiteUrl: vi.fn((value: string, base = new URL("https://example.com")) => new URL(value, base).toString()),
    browserIconHref: vi.fn((site: { iconUrl?: string; logoUrl?: string }) => site.iconUrl || site.logoUrl || "/icon.svg"),
    listPublicWorkSitemapEntries: vi.fn(),
}));

vi.mock("@/lib/server/site-metadata", () => mocks);
vi.mock("@/lib/server/work-governance-service", () => ({ listPublicWorkSitemapEntries: mocks.listPublicWorkSitemapEntries }));

import manifest from "./manifest";
import robots from "./robots";
import sitemap from "./sitemap";
import nextConfig from "../../next.config";
import { GET as favicon } from "./api/site-icon/route";

describe("site metadata routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "自定义站点", iconUrl: "https://cdn.example.com/favicon.ico", seoDescription: "站点摘要" });
        mocks.listPublicWorkSitemapEntries.mockResolvedValue([{ slug: "public-work", updatedAt: "2026-07-27T00:00:00.000Z" }]);
    });

    it("keeps private workspaces out of robots and points to the sitemap", () => {
        const result = robots();
        const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;

        expect(rules.disallow).toEqual(expect.arrayContaining(["/api/", "/admin", "/create", "/canvas", "/drama"]));
        expect(rules.allow).toEqual(expect.arrayContaining(["/ai-image-generator", "/ai-video-generator", "/ai-voice-generator", "/voice-cloning", "/ai-short-drama", "/ai-agent"]));
        expect(result.sitemap).toBe("https://example.com/sitemap.xml");
    });

    it("publishes only crawlable public pages and approved works", async () => {
        expect((await sitemap()).map(({ url, priority }) => ({ url, priority }))).toEqual([
            { url: "https://example.com/", priority: 1 },
            { url: "https://example.com/ai-image-generator", priority: 0.9 },
            { url: "https://example.com/ai-video-generator", priority: 0.9 },
            { url: "https://example.com/ai-voice-generator", priority: 0.9 },
            { url: "https://example.com/voice-cloning", priority: 0.9 },
            { url: "https://example.com/ai-short-drama", priority: 0.8 },
            { url: "https://example.com/ai-agent", priority: 0.8 },
            { url: "https://example.com/gallery", priority: 0.8 },
            { url: "https://example.com/announcements", priority: 0.5 },
            { url: "https://example.com/terms", priority: 0.3 },
            { url: "https://example.com/privacy", priority: 0.3 },
            { url: "https://example.com/share/public-work", priority: 0.6 },
        ]);
    });

    it("routes the web manifest icon through the backend-controlled favicon", async () => {
        const result = await manifest();

        expect(result.name).toBe("自定义站点");
        expect(result.icons).toEqual([{ src: "/favicon.ico", sizes: "any", purpose: "any" }]);
    });

    it("rewrites the reserved favicon path to the dynamic site icon route before static files", async () => {
        const rewrites = await nextConfig("phase-production-build").rewrites?.();

        expect(rewrites).toEqual({
            beforeFiles: [{ source: "/favicon.ico", destination: "/api/site-icon" }],
            afterFiles: [],
            fallback: [],
        });
    });

    it("redirects the standard favicon route to the configured browser icon", async () => {
        const response = await favicon(new Request("http://localhost:3000/api/site-icon"));

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://cdn.example.com/favicon.ico");
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    });

    it("keeps a site-local icon relative to the current host", async () => {
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "默认站点", iconUrl: "/icon.svg", logoUrl: "/logo.svg" });

        const response = await favicon(new Request("http://localhost:3000/api/site-icon"));

        expect(response.headers.get("location")).toBe("/icon.svg");
    });

    it("falls back to the infinite-evolution icon when favicon points back to itself", async () => {
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "默认站点", iconUrl: "/favicon.ico", logoUrl: "/logo.svg" });

        const response = await favicon(new Request("http://localhost:3000/api/site-icon"));

        expect(response.headers.get("location")).toBe("/icon.svg");
    });
});
