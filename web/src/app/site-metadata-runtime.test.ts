import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/site-metadata", () => ({
    siteMetadataBase: vi.fn(() => new URL("https://example.com")),
    absoluteSiteUrl: vi.fn((value: string, base = new URL("https://example.com")) => new URL(value, base).toString()),
}));
vi.mock("@/lib/server/work-governance-service", () => ({ listPublicWorkSitemapEntries: vi.fn(async () => []) }));

import * as robotsRoute from "./robots";
import * as sitemapRoute from "./sitemap";

describe("runtime site metadata routes", () => {
    it("does not freeze deployment URLs while building the image", () => {
        expect(robotsRoute.dynamic).toBe("force-dynamic");
        expect(sitemapRoute.dynamic).toBe("force-dynamic");
    });
});
