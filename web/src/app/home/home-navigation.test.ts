import { describe, expect, it } from "vitest";

import { SEO_LANDING_SLUGS } from "@/app/seo-landings/seo-landing-data";
import { HOME_NAVIGATION, HOME_PRODUCT_NAVIGATION } from "./home-data";

describe("public home navigation", () => {
    it("keeps gallery and pricing in the top-level navigation", () => {
        expect(HOME_NAVIGATION.map((item) => item.translationKey)).toEqual(["gallery", "pricing"]);
    });

    it("links the Product menu to all six SEO landing pages", () => {
        expect(HOME_PRODUCT_NAVIGATION.map((item) => item.href)).toEqual(SEO_LANDING_SLUGS.map((slug) => `/${slug}`));
        expect(HOME_PRODUCT_NAVIGATION.every((item) => item.action === "link")).toBe(true);
    });
});
