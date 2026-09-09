import { beforeEach, describe, expect, it, vi } from "vitest";

const requestContext = vi.hoisted(() => ({
    pathname: "/en/terms",
    cookieLocale: "zh-CN",
    acceptLanguage: "vi",
}));

vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) => (name === "vozeb-pro-locale" && requestContext.cookieLocale ? { value: requestContext.cookieLocale } : undefined),
    }),
    headers: async () =>
        new Headers({
            "accept-language": requestContext.acceptLanguage,
            "x-vozeb-pathname": requestContext.pathname,
        }),
}));

vi.mock("next-intl/server", () => ({
    getRequestConfig: <Config>(createRequestConfig: (params: { requestLocale: Promise<string | undefined> }) => Config) => createRequestConfig,
}));

import requestConfig from "@/i18n/request";

describe("next-intl request configuration", () => {
    beforeEach(() => {
        requestContext.pathname = "/en/terms";
        requestContext.cookieLocale = "zh-CN";
        requestContext.acceptLanguage = "vi";
    });

    it("uses the proxy pathname to select a published SEO route locale", async () => {
        const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });

        expect(config.locale).toBe("en");
        expect(config.timeZone).toBe("UTC");
        expect(config.messages).toBeDefined();
    });

    it("keeps cookie negotiation for a nonlocalized route", async () => {
        requestContext.pathname = "/create";

        const config = await requestConfig({ requestLocale: Promise.resolve(undefined) });

        expect(config.locale).toBe("zh-CN");
    });
});
