import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getSeoLandingDefinition, SEO_LANDING_SLUGS } from "./seo-landing-data";
import { landingUi } from "./content/ui";
import { SeoLandingContent } from "./seo-landing-content";
import { seoPublicationRegistry } from "@/i18n/routing";

function leaves(value: unknown, path = ""): Record<string, string> {
    return typeof value === "string" ? { [path]: value } : value && typeof value === "object" ? Object.assign({}, ...Object.entries(value).map(([key, item]) => leaves(item, `${path}.${key}`))) : {};
}
describe("complete landing translations", () => {
    it.each(["en", "zh-CN"] as const)("translates every content leaf for %s without Vietnamese fallback", (locale) => {
        for (const slug of SEO_LANDING_SLUGS) {
            const translated = leaves(getSeoLandingDefinition(slug, locale));
            const original = leaves(getSeoLandingDefinition(slug, "vi"));
            expect(Object.keys(translated).sort()).toEqual(Object.keys(original).sort());
            for (const [key, value] of Object.entries(translated)) {
                expect(value.trim(), `${slug}${key}`).not.toBe("");
                if (/^\.(slug|related|visual.src|cta.kind|cta.mode|cta.href)/.test(key)) continue;
                expect(value, `${slug}${key}`).not.toMatch(/[ăâđêôơưĂÂĐÊÔƠƯ]/u);
                if (!["AI Agent", "AI image generator", "AI video generator", "AI voice generator", "text to video", "image to video", "AI short drama", "AI automation", "voice cloning", "AI voice clone"].includes(value))
                    expect(value, `${slug}${key}`).not.toBe(original[key]);
            }
            const html = renderToStaticMarkup(<SeoLandingContent definition={getSeoLandingDefinition(slug, locale)!} locale={locale} actions={<button>Start</button>} />);
            expect(html).toContain(`aria-label="${landingUi[locale].breadcrumb}"`);
            expect(html).toContain(landingUi[locale].relatedTitle);
            expect(html).toContain(landingUi[locale].explore);
            expect(html).toContain(landingUi[locale].faqTitle);
            expect(html).toContain(`href="/${locale === "en" ? "en" : "zh-cn"}"`);
            for (const related of getSeoLandingDefinition(slug, locale)!.related) {
                expect(html).toContain(getSeoLandingDefinition(related, locale)!.h1);
                expect(html).toContain(`href="/${locale === "en" ? "en" : "zh-cn"}/${related}"`);
            }
        }
        for (const value of Object.values(landingUi[locale])) {
            expect(value.trim()).not.toBe("");
            expect(Object.values(landingUi.vi)).not.toContain(value);
        }
    });
    it("omits unpublished related tools", () => {
        seoPublicationRegistry["ai-agent"].published.en = false;
        try {
            const html = renderToStaticMarkup(<SeoLandingContent definition={getSeoLandingDefinition("ai-image-generator", "en")!} locale="en" actions={null} />);
            expect(html).not.toContain('href="/en/ai-agent"');
        } finally {
            seoPublicationRegistry["ai-agent"].published.en = true;
        }
    });
});
