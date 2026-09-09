import { describe, expect, it } from "vitest";

import { Link, getPathname, permanentRedirect, redirect, usePathname, useRouter } from "@/i18n/navigation";

describe("localized navigation exports", () => {
    it("exposes createNavigation helpers and applies the configured locale prefixes", () => {
        expect(getPathname({ href: "/terms", locale: "vi" })).toBe("/terms");
        expect(getPathname({ href: "/terms", locale: "en" })).toBe("/en/terms");
        expect(getPathname({ href: "/terms", locale: "zh-CN" })).toBe("/zh-cn/terms");
        expect(Link).toBeTruthy();
        expect([permanentRedirect, redirect, usePathname, useRouter].every((value) => typeof value === "function")).toBe(true);
    });
});
