import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/gallery" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { WebsiteStructuredData } from "./website-structured-data";
describe("global website identity scope", () => {
    it("retains the global identity on nonlocalized public pages", () => {
        route.pathname = "/gallery";
        const html = renderToStaticMarkup(<WebsiteStructuredData json='{"@type":"WebSite"}' />);
        expect(html).toContain('id="website-json-ld"');
        expect(html).toContain('{"@type":"WebSite"}');
    });
    it("leaves the identity to the locale layout on SEO routes", () => {
        for (const pathname of ["/", "/en/terms", "/zh-cn/ai-agent"]) {
            route.pathname = pathname;
            expect(renderToStaticMarkup(<WebsiteStructuredData json='{"@type":"WebSite"}' />)).toBe("");
        }
    });
});
