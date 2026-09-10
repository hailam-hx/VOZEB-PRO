import { describe, expect, it } from "vitest";

import { DEFAULT_SITE_ICON_URL, DEFAULT_SITE_LOGO_URL, DEFAULT_SITE_TITLE } from "@/lib/site-brand";
import { DEFAULT_MAIL_SETTINGS, DEFAULT_SITE_SETTINGS } from "@/lib/auth/store-foundation";
import { localizeBuiltInSiteCopy } from "./site-copy";

describe("localizeBuiltInSiteCopy", () => {
    it("defines the HOTX AI identity with empty administrator content defaults", () => {
        expect(DEFAULT_SITE_TITLE).toBe("HOTX AI");
        expect(DEFAULT_SITE_LOGO_URL).toBe("/hx-favicon.png");
        expect(DEFAULT_SITE_ICON_URL).toBe("/hx-favicon.png");
        expect(DEFAULT_SITE_SETTINGS).toMatchObject({
            title: "HOTX AI",
            logoUrl: "/hx-favicon.png",
            iconUrl: "/hx-favicon.png",
            seo: {
                vi: { title: "", description: "", keywords: "" },
                en: { title: "", description: "", keywords: "" },
                "zh-CN": { title: "", description: "", keywords: "" },
            },
            footerCopyright: "",
            termsUrl: "",
            termsVersion: "",
            privacyUrl: "",
            privacyVersion: "",
            friendLinks: [],
        });
        expect(Object.values(DEFAULT_SITE_SETTINGS.socials)).toEqual([
            { enabled: false, label: "", url: "" },
            { enabled: false, label: "", url: "" },
            { enabled: false, label: "", url: "" },
            { enabled: false, label: "", url: "" },
        ]);
        expect(DEFAULT_MAIL_SETTINGS.fromName).toBe("");
    });

    it("replaces an unchanged built-in value", () => {
        expect(localizeBuiltInSiteCopy("默认文案", "默认文案", "Localized copy")).toBe("Localized copy");
    });

    it("preserves administrator-provided content", () => {
        expect(localizeBuiltInSiteCopy("  Custom footer copy  ", "默认文案", "Localized copy")).toBe("Custom footer copy");
    });
});
