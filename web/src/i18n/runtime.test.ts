import { describe, expect, it } from "vitest";

import { antLocales, effectiveLocale, localeMetadata } from "@/i18n/runtime";

describe("locale runtime mappings", () => {
    it("maps application locales to HTML, OpenGraph, Ant Design, and Day.js", () => {
        expect(localeMetadata.vi).toMatchObject({ htmlLang: "vi", openGraphLocale: "vi_VN", dayjsLocale: "vi" });
        expect(localeMetadata.en).toMatchObject({ htmlLang: "en", openGraphLocale: "en_US", dayjsLocale: "en" });
        expect(localeMetadata["zh-CN"]).toMatchObject({ htmlLang: "zh-CN", openGraphLocale: "zh_CN", dayjsLocale: "zh-cn" });
        expect(antLocales.vi.locale).toBe("vi");
        expect(antLocales.en.locale).toBe("en");
        expect(antLocales["zh-CN"].locale).toBe("zh-cn");
    });

    it("forces Chinese only inside admin and install", () => {
        expect(effectiveLocale("en", "/admin/users")).toBe("zh-CN");
        expect(effectiveLocale("vi", "/install")).toBe("zh-CN");
        expect(effectiveLocale("en", "/create")).toBe("en");
    });
});
