import { describe, expect, it } from "vitest";

import { isAppLocale, isChineseOnlyPath, localeMetadata, resolveLocale } from "@/i18n/config";

describe("application locale resolution", () => {
    it("prefers a supported browser cookie over Accept-Language", () => {
        expect(resolveLocale({ cookieLocale: "en", acceptLanguage: "zh-CN,zh;q=0.9" })).toBe("en");
    });

    it.each([
        ["vi-VN,vi;q=0.9", "vi"],
        ["en-GB,en;q=0.9", "en"],
        ["zh-TW,zh;q=0.9", "zh-CN"],
    ] as const)("maps %s to %s", (acceptLanguage, expected) => {
        expect(resolveLocale({ acceptLanguage })).toBe(expected);
    });

    it("ignores an invalid cookie and falls back to Vietnamese for unsupported languages", () => {
        expect(resolveLocale({ cookieLocale: "fr", acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("vi");
    });

    it.each(["*", "en_US", "not a locale", "zh-CN, en_US;q=0.8"])("falls back safely for malformed Accept-Language value %s", (acceptLanguage) => {
        expect(() => resolveLocale({ acceptLanguage })).not.toThrow();
        expect(resolveLocale({ acceptLanguage })).toBe(acceptLanguage.startsWith("zh-CN") ? "zh-CN" : "vi");
    });

    it("exposes runtime metadata for all supported locales", () => {
        expect(localeMetadata).toEqual({
            vi: { htmlLang: "vi", openGraphLocale: "vi_VN", antLocale: "vi_VN", dayjsLocale: "vi", label: "Tiếng Việt" },
            en: { htmlLang: "en", openGraphLocale: "en_US", antLocale: "en_US", dayjsLocale: "en", label: "English" },
            "zh-CN": { htmlLang: "zh-CN", openGraphLocale: "zh_CN", antLocale: "zh_CN", dayjsLocale: "zh-cn", label: "简体中文" },
        });
        expect(["vi", "en", "zh-CN"].every(isAppLocale)).toBe(true);
        expect(isAppLocale("zh-TW")).toBe(false);
    });

    it("keeps only admin and install interfaces fixed to Simplified Chinese", () => {
        expect(isChineseOnlyPath("/admin/settings")).toBe(true);
        expect(isChineseOnlyPath("/install")).toBe(true);
        expect(isChineseOnlyPath("/create")).toBe(false);
        expect(isChineseOnlyPath("/administrator")).toBe(false);
    });
});
