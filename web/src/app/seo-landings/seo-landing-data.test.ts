import { describe, expect, it } from "vitest";

import { SEO_LANDING_DEFINITIONS, SEO_LANDING_SLUGS, getSeoLandingDefinition, isSeoLandingSlug } from "./seo-landing-data";

const expectedSlugs = ["ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent"] as const;

describe("SEO landing definitions", () => {
    it("publishes exactly the six approved slugs", () => {
        expect(SEO_LANDING_SLUGS).toEqual(expectedSlugs);
        expect(Object.keys(SEO_LANDING_DEFINITIONS)).toEqual(expectedSlugs);
        expect(isSeoLandingSlug("ai-agent")).toBe(true);
        expect(isSeoLandingSlug("unapproved-page")).toBe(false);
        expect(getSeoLandingDefinition("unapproved-page")).toBeUndefined();
    });

    it("keeps the title, description, H1 and primary keyword unique", () => {
        for (const field of ["title", "description", "h1", "primaryKeyword"] as const) {
            const values = expectedSlugs.map((slug) => SEO_LANDING_DEFINITIONS[slug][field]);
            expect(new Set(values).size, field).toBe(expectedSlugs.length);
            expect(
                values.every((value) => value.trim().length > 0),
                field,
            ).toBe(true);
        }
    });

    it("maps every CTA to the approved product destination", () => {
        expect(SEO_LANDING_DEFINITIONS["ai-image-generator"].cta).toMatchObject({ kind: "create", mode: "image" });
        expect(SEO_LANDING_DEFINITIONS["ai-video-generator"].cta).toMatchObject({ kind: "create", mode: "video" });
        expect(SEO_LANDING_DEFINITIONS["ai-voice-generator"].cta).toMatchObject({ kind: "create", mode: "audio" });
        expect(SEO_LANDING_DEFINITIONS["ai-agent"].cta).toMatchObject({ kind: "create", mode: "agent" });
        expect(SEO_LANDING_DEFINITIONS["voice-cloning"].cta).toEqual({ kind: "workspace", href: "/voices", label: "Nhân bản giọng nói của tôi" });
        expect(SEO_LANDING_DEFINITIONS["ai-short-drama"].cta).toEqual({ kind: "workspace", href: "/drama", label: "Bắt đầu dự án phim ngắn" });
    });

    it("provides three valid, distinct related landing links per page", () => {
        const validSlugs = new Set(SEO_LANDING_SLUGS);

        for (const slug of expectedSlugs) {
            const related = SEO_LANDING_DEFINITIONS[slug].related;
            expect(related).toHaveLength(3);
            expect(new Set(related).size).toBe(3);
            expect(related).not.toContain(slug);
            expect(related.every((candidate) => validSlugs.has(candidate))).toBe(true);
        }
    });

    it("contains substantive, page-specific HTML content", () => {
        for (const slug of expectedSlugs) {
            const definition = SEO_LANDING_DEFINITIONS[slug];
            expect(definition.useCases.length).toBeGreaterThanOrEqual(3);
            expect(definition.steps.length).toBeGreaterThanOrEqual(3);
            expect(definition.capabilities.length).toBeGreaterThanOrEqual(3);
            expect(definition.faqs.length).toBeGreaterThanOrEqual(4);
            expect(definition.secondaryKeywords.length).toBeGreaterThanOrEqual(3);
        }
    });
});
