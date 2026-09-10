import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store";
import { DEFAULT_SITE_ICON_URL, DEFAULT_SITE_LOGO_URL } from "@/lib/site-brand";

describe("default HOTX AI brand assets", () => {
    it("uses the HOTX AI favicon for every default brand entry", () => {
        expect(DEFAULT_SITE_SETTINGS.logoUrl).toBe(DEFAULT_SITE_LOGO_URL);
        expect(DEFAULT_SITE_SETTINGS.iconUrl).toBe(DEFAULT_SITE_ICON_URL);
    });

    it("keeps the supplied PNG identical in web and docs", async () => {
        const [webLogo, docsLogo] = await Promise.all([readFile(resolve(process.cwd(), "public/hx-favicon.png")), readFile(resolve(process.cwd(), "../docs/public/hx-favicon.png"))]);

        expect(webLogo.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
        expect(docsLogo.equals(webLogo)).toBe(true);
    });
});
