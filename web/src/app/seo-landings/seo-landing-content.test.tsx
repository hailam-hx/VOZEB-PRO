import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SEO_LANDING_DEFINITIONS } from "./seo-landing-data";
import { SeoLandingContent } from "./seo-landing-content";

describe("SeoLandingContent", () => {
    it("renders one H1 and the complete server-readable section structure", () => {
        const definition = SEO_LANDING_DEFINITIONS["ai-image-generator"];
        const html = renderToStaticMarkup(<SeoLandingContent definition={definition} actions={<button>Bắt đầu</button>} />);

        expect(html.match(/<h1/g)).toHaveLength(1);
        expect(html).toContain(definition.h1);
        expect(html).toContain(definition.description);
        expect(html).toContain('data-seo-section="showcase"');
        expect(html).toContain('data-seo-section="use-cases"');
        expect(html).toContain('data-seo-section="steps"');
        expect(html).toContain('data-seo-section="capabilities"');
        expect(html).toContain('data-seo-section="faq"');
        expect(html).toContain(`Câu hỏi thường gặp về ${definition.primaryKeyword}`);
        expect(html).toContain('data-seo-section="related"');
        expect(html.match(/<details/g)).toHaveLength(definition.faqs.length);
        for (const related of definition.related) expect(html).toContain(`href="/${related}"`);
    });

    it("does not render a prompt control for the voice cloning landing", () => {
        const definition = SEO_LANDING_DEFINITIONS["voice-cloning"];
        const html = renderToStaticMarkup(<SeoLandingContent definition={definition} actions={<button>Mở workspace</button>} />);

        expect(html).not.toContain("seo-landing-prompt");
        expect(html).toContain("Mở workspace");
    });
});
