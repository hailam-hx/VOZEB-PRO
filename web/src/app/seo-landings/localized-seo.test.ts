import { describe, expect, it } from "vitest";
import { getSeoLandingDefinition, SEO_LANDING_SLUGS } from "./seo-landing-data";
import { buildSeoLandingMetadata } from "./seo-landing-metadata";
import { buildSeoLandingStructuredData } from "@/lib/structured-data";

describe("localized landing publication", () => {
    it.each([
        ["vi", "", "vi_VN"],
        ["en", "/en", "en_US"],
        ["zh-CN", "/zh-cn", "zh_CN"],
    ] as const)("publishes complete self canonical social metadata for %s", (locale, prefix, ogLocale) => {
        for (const slug of SEO_LANDING_SLUGS) {
            const definition = getSeoLandingDefinition(slug, locale)!;
            const metadata = buildSeoLandingMetadata(definition, new URL("https://example.com"), "HOTX AI", locale);
            const canonical = `https://example.com${prefix}/${slug}`;
            expect(metadata.alternates).toEqual({ canonical, languages: { vi: `https://example.com/${slug}`, en: `https://example.com/en/${slug}`, "zh-Hans": `https://example.com/zh-cn/${slug}`, "x-default": `https://example.com/${slug}` } });
            expect(metadata.openGraph).toMatchObject({ url: canonical, locale: ogLocale, title: definition.title, description: definition.description });
            expect(metadata.twitter).toMatchObject({ title: definition.title, description: definition.description });
            if (locale !== "vi") {
                const original = getSeoLandingDefinition(slug, "vi")!;
                for (const key of [
                    "title",
                    "h1",
                    "description",
                    "heroNote",
                    "showcaseTitle",
                    "showcaseDescription",
                    "useCasesTitle",
                    "useCasesDescription",
                    "stepsTitle",
                    "stepsDescription",
                    "capabilitiesTitle",
                    "capabilitiesDescription",
                    "finalCtaTitle",
                    "finalCtaDescription",
                ] as const)
                    expect(definition[key], `${slug}.${key}`).not.toBe(original[key]);
                for (const section of ["useCases", "steps", "capabilities", "faqs"] as const) {
                    expect(definition[section]).toHaveLength(original[section].length);
                    definition[section].forEach((item, i) =>
                        Object.entries(item).forEach(([key, value]) => {
                            expect(value).not.toBe(Object.values(original[section][i])[Object.keys(item).indexOf(key)]);
                            expect(value).not.toMatch(/[ăâđêôơưĂÂĐÊÔƠƯ]/u);
                        }),
                    );
                }
                expect(definition.visual.alt).not.toBe(original.visual.alt);
                expect(definition.cta.label).not.toBe(original.cta.label);
            }
        }
    });

    it("localizes the structured data language and home breadcrumb", () => {
        const data = buildSeoLandingStructuredData({
            url: "https://example.com/en/ai-agent",
            websiteId: "https://example.com/en#website",
            title: "AI Agent",
            description: "Create media",
            breadcrumbName: "AI Agent",
            locale: "en",
            homeUrl: "https://example.com/en",
            homeName: "Home",
        });
        expect(data["@graph"][0]).toMatchObject({ inLanguage: "en" });
        expect(data["@graph"][1]).toMatchObject({
            itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/en" },
                { "@type": "ListItem", position: 2, name: "AI Agent", item: "https://example.com/en/ai-agent" },
            ],
        });
    });
});
