import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/server/site-metadata", () => ({ siteMetadataBase: () => new URL("https://example.com"), absoluteSiteUrl: (path: string, base: URL) => new URL(path, base).toString() }));
vi.mock("@/lib/server/work-governance-service", () => ({ listPublicWorkSitemapEntries: async () => [{ slug: "one", updatedAt: "2026-01-01" }] }));
import sitemap from "./sitemap";
import robots from "./robots";
describe("localized sitemap", () => {
    it("publishes 27 SEO URLs and every nonlocalized public URL once without sitemap alternates", async () => {
        const entries = await sitemap();
        expect(entries).toHaveLength(30);
        expect(new Set(entries.map((entry) => entry.url)).size).toBe(30);
        for (const prefix of ["", "/en", "/zh-cn"])
            for (const path of ["", "/ai-image-generator", "/ai-video-generator", "/ai-voice-generator", "/voice-cloning", "/ai-short-drama", "/ai-agent", "/terms", "/privacy"])
                expect(entries).toContainEqual(expect.objectContaining({ url: `https://example.com${prefix}${path || (prefix ? "" : "/")}` }));
        for (const path of ["/gallery", "/announcements", "/share/one"]) expect(entries.filter((entry) => entry.url === `https://example.com${path}`)).toHaveLength(1);
        expect(entries.every((entry) => !entry.alternates)).toBe(true);
        const rules = robots().rules;
        expect(rules).toMatchObject({ allow: expect.arrayContaining(["/en", "/zh-cn/terms"]) });
    });
});
