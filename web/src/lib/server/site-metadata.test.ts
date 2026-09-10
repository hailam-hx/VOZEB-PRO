import { describe, expect, it } from "vitest";

import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store";
import { DEFAULT_SITE_ICON_URL } from "@/lib/site-brand";
import { browserIconHref, resolveSiteMetadataBase } from "./site-metadata";

describe("site metadata", () => {
    it("resolves the public site URL from the runtime environment object", () => {
        expect(resolveSiteMetadataBase({ NEXT_PUBLIC_SITE_URL: "https://hotx-ai.com" })).toEqual(new URL("https://hotx-ai.com"));
    });

    it("keeps the bundled browser icon on the same origin", () => {
        expect(browserIconHref(DEFAULT_SITE_SETTINGS)).toBe(DEFAULT_SITE_ICON_URL);
    });

    it("uses a custom logo when the browser icon is still the bundled default", () => {
        expect(browserIconHref({ iconUrl: DEFAULT_SITE_ICON_URL, logoUrl: "/custom-logo.svg" })).toBe("/custom-logo.svg");
    });

    it("keeps an independently configured browser icon", () => {
        expect(browserIconHref({ iconUrl: "https://cdn.example.com/favicon.png", logoUrl: "/custom-logo.svg" })).toBe("https://cdn.example.com/favicon.png");
    });

    it("does not send legacy reserved favicon paths back through a redirect", () => {
        expect(browserIconHref({ iconUrl: "/favicon.ico", logoUrl: "/hx-favicon.png" })).toBe("/hx-favicon.png");
        expect(browserIconHref({ iconUrl: "/api/site-icon", logoUrl: "/hx-favicon.png" })).toBe("/hx-favicon.png");
    });
});
