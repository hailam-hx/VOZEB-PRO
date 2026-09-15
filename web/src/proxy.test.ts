import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { seoPublicationRegistry } from "@/i18n/routing";

import { proxy } from "./proxy";

describe("application proxy security", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("ignores spoofed forwarded origins unless a trusted proxy is configured", () => {
        const request = writeRequest({
            origin: "https://public.example.com",
            "x-forwarded-host": "public.example.com",
            "x-forwarded-proto": "https",
        });

        expect(proxy(request).status).toBe(403);
        vi.stubEnv("VOZEB_PRO_TRUSTED_PROXY_HOPS", "1");
        expect(proxy(request).status).toBe(200);
    });

    it("uses a per-request script nonce and restricts production connections", () => {
        vi.stubEnv("NODE_ENV", "production");

        const policy = proxy(new NextRequest("https://app.example.com/create")).headers.get("content-security-policy") || "";

        expect(policy).toMatch(/script-src 'self' 'nonce-[a-f0-9]+' 'strict-dynamic'/);
        expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
        expect(policy).toContain("connect-src 'self' https:");
        expect(policy).not.toMatch(/connect-src[^;]*http:/);
        expect(policy).toContain("upgrade-insecure-requests");
    });

    it("overwrites the pathname header used to isolate Chinese-only interfaces", () => {
        const response = proxy(
            new NextRequest("https://app.example.com/create", {
                headers: { "x-vozeb-pathname": "/admin" },
            }),
        );

        expect(response.headers.get("x-middleware-request-x-vozeb-pathname")).toBe("/create");
    });

    it("composes next-intl only for published SEO routes while preserving security headers", () => {
        const localized = proxy(new NextRequest("https://app.example.com/en/terms", { headers: { cookie: "vozeb-pro-locale=zh-CN" } }));

        expect(localized.status).toBe(200);
        expect(localized.headers.get("x-middleware-request-x-next-intl-locale")).toBe("en");
        expect(localized.headers.get("x-middleware-request-x-vozeb-pathname")).toBe("/en/terms");
        expect(localized.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
        expect(localized.headers.get("link")).toBeNull();
        expect(localized.headers.get("set-cookie")).toContain("vozeb-pro-locale=en");
        expect(localized.headers.get("set-cookie")).toContain("Max-Age=31536000");

        const vietnamese = proxy(new NextRequest("https://app.example.com/terms"));
        expect(vietnamese.headers.get("x-middleware-request-x-next-intl-locale")).toBe("vi");
        expect(vietnamese.headers.get("x-middleware-rewrite")).toBe("https://app.example.com/vi/terms");

        const excluded = proxy(new NextRequest("https://app.example.com/en/gallery"));
        expect(excluded.status).toBe(404);
        expect(excluded.headers.get("x-middleware-request-x-next-intl-locale")).toBeNull();
        expect(excluded.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
    });

    it("negotiates unprefixed public routes from a saved choice before the device language", () => {
        const cases = [
            {
                path: "/?source=device",
                headers: { "accept-language": "en-US,en;q=0.9" },
                status: 307,
                location: "https://app.example.com/en?source=device",
                locale: null,
            },
            {
                path: "/terms?source=device",
                headers: { "accept-language": "zh-TW,zh;q=0.9" },
                status: 307,
                location: "https://app.example.com/zh-cn/terms?source=device",
                locale: null,
            },
            {
                path: "/terms?source=device-hk",
                headers: { "accept-language": "zh-HK,zh;q=0.9" },
                status: 307,
                location: "https://app.example.com/zh-cn/terms?source=device-hk",
                locale: null,
            },
            {
                path: "/terms",
                headers: { "accept-language": "en-US", cookie: "vozeb-pro-locale=vi" },
                status: 200,
                location: null,
                locale: "vi",
            },
            {
                path: "/terms",
                headers: { "accept-language": "vi-VN", cookie: "vozeb-pro-locale=en" },
                status: 307,
                location: "https://app.example.com/en/terms",
                locale: null,
            },
            {
                path: "/terms",
                headers: { "accept-language": "fr-FR,fr;q=0.9" },
                status: 200,
                location: null,
                locale: "vi",
            },
            {
                path: "/terms",
                headers: { "accept-language": "en_US,not a locale" },
                status: 200,
                location: null,
                locale: "vi",
            },
        ] as const;

        for (const item of cases) {
            const response = proxy(new NextRequest(`https://app.example.com${item.path}`, { headers: item.headers }));

            expect(response.status, item.path).toBe(item.status);
            expect(response.headers.get("location"), item.path).toBe(item.location);
            expect(response.headers.get("x-middleware-request-x-next-intl-locale"), item.path).toBe(item.locale);
        }
    });

    it("permanently redirects valid Vietnamese-prefixed SEO URLs without dropping the query", () => {
        const response = proxy(new NextRequest("https://app.example.com/vi/ai-agent?source=legacy&campaign=launch"));

        expect(response.status).toBe(308);
        expect(response.headers.get("location")).toBe("https://app.example.com/ai-agent?source=legacy&campaign=launch");
        expect(response.headers.get("set-cookie")).toContain("vozeb-pro-locale=vi");
        expect(response.headers.get("set-cookie")).toContain("Max-Age=31536000");
        expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
    });

    it.each(["/u/privacy", "/share/terms", "/canvas/privacy", "/drama/terms"])("preserves nonlocalized dynamic route ownership for %s", (pathname) => {
        const response = proxy(new NextRequest(`https://app.example.com${pathname}`));

        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-request-x-vozeb-pathname")).toBe(pathname);
        expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBeNull();
    });

    it("leaves unknown locale prefixes to their owning page or the Next.js router", () => {
        const response = proxy(new NextRequest("https://app.example.com/fr/terms"));

        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-request-x-vozeb-pathname")).toBe("/fr/terms");
        expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBeNull();
    });

    it("returns 404 for a known SEO route whose locale pair is unpublished", () => {
        const originallyPublished = seoPublicationRegistry.terms.published.en;
        seoPublicationRegistry.terms.published.en = false;

        try {
            const response = proxy(new NextRequest("https://app.example.com/en/terms"));

            expect(response.status).toBe(404);
            expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBeNull();
            expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
        } finally {
            seoPublicationRegistry.terms.published.en = originallyPublished;
        }
    });

    it.each(["/vi/gallery", "/en/share/work", "/zh-cn/u/creator", "/en/create", "/zh-cn/admin", "/en/terms/extra"])("returns 404 without localizing invalid or excluded route %s", (pathname) => {
        const response = proxy(new NextRequest(`https://app.example.com${pathname}`));

        expect(response.status).toBe(404);
        expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBeNull();
    });
});

function writeRequest(headers: Record<string, string>) {
    return new NextRequest("http://app.internal/api/auth/login", { method: "POST", headers });
}
