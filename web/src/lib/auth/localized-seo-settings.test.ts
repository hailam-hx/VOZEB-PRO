import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_SETTINGS } from "./store-foundation";
import { normalizeSiteSettings } from "./store-normalizers";
import { getAuthSettings, getFreshAuthSettings, setAuthSettings } from "./store-settings-actions";
import { getPublicSiteSettings } from "@/lib/server/site-metadata";
import { serializePublicSettings } from "./session";

vi.mock("next/cache", () => ({ unstable_cache: (read: () => Promise<unknown>) => read, revalidateTag: vi.fn() }));

vi.mock("./session", async (importOriginal) => ({ ...(await importOriginal<typeof import("./session")>()), getCurrentUser: vi.fn(async () => ({ id: "seo-admin", role: "admin", status: "active", adminPermissions: ["system.manage"] })) }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: () => ({ id: "seo-admin" }), safeRecordAuditLog: vi.fn() }));
import { GET, PATCH } from "@/app/api/admin/settings/route";

const seo = {
    vi: { title: "Tiêu đề tiếng Việt", description: "Mô tả tiếng Việt", keywords: "ảnh,video" },
    en: { title: "English title", description: "English description", keywords: "image,video" },
    "zh-CN": { title: "中文标题", description: "中文描述", keywords: "图片,视频" },
};
let dataDir = "";
afterEach(async () => {
    vi.unstubAllEnvs();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = "";
});

describe("localized SEO settings", () => {
    it("normalizes each locale independently and keeps administrator text", () => {
        expect(normalizeSiteSettings({ seo }).seo).toEqual(seo);
        const input = structuredClone(seo);
        input.en = { title: " ", description: "", keywords: " " };
        const normalized = normalizeSiteSettings({ seo: input }).seo;
        expect(normalized?.vi).toEqual(seo.vi);
        expect(normalized?.["zh-CN"]).toEqual(seo["zh-CN"]);
        expect(normalized?.en.title).toContain("AI image, video and voice creation");
        expect(normalized?.en.description).toContain("AI creation platform");
        expect(normalized?.en.keywords).toContain("AI image");
    });

    it("supplies complete same-language defaults and applies 72/180/240 limits", () => {
        const defaults = normalizeSiteSettings({}).seo;
        expect(defaults?.vi.title).toContain("Nền tảng");
        expect(defaults?.vi.description).toContain("nền tảng sáng tạo AI");
        expect(defaults?.["zh-CN"].title).toContain("AI 图片");
        expect(defaults?.["zh-CN"].description).toContain("创作平台");
        const long = { title: "t".repeat(73), description: "d".repeat(181), keywords: "k".repeat(241) };
        expect(normalizeSiteSettings({ seo: { ...seo, en: long } }).seo?.en).toEqual({ title: "t".repeat(72), description: "d".repeat(180), keywords: "k".repeat(240) });
        const english = { title: "VOZEB PRO AI creation", description: "VOZEB PRO AI studio", keywords: "VOZEB PRO,AI image" };
        expect(normalizeSiteSettings({ seo: { ...seo, en: english } }).seo?.en).toEqual(english);
    });

    it("uses a missing or blank locale's own defaults without copying configured neighbours", () => {
        for (const [locale, titlePart, descriptionPart, keywordPart] of [
            ["vi", "Nền tảng", "nền tảng sáng tạo AI", "hình ảnh AI"],
            ["en", "AI image, video and voice", "AI creation platform", "AI image"],
            ["zh-CN", "AI 图片", "创作平台", "AI 绘图"],
        ] as const) {
            const input = structuredClone(seo);
            input[locale] = { title: "  ", description: "", keywords: " " };
            const result = normalizeSiteSettings({ seo: input }).seo;
            expect(result[locale].title).toContain(titlePart);
            expect(result[locale].description).toContain(descriptionPart);
            expect(result[locale].keywords).toContain(keywordPart);
            for (const other of ["vi", "en", "zh-CN"] as const) if (other !== locale) expect(result[other]).toEqual(seo[other]);
        }
    });

    for (const provider of ["file", "postgres"] as const) {
        const test = provider === "postgres" && process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION !== "1" ? it.skip : it;
        test(`${provider} API save persists all locales and blank defaults through immediate GET, public cache and refreshed reads`, async () => {
            dataDir = await mkdtemp(join(tmpdir(), "vozeb-localized-seo-"));
            vi.stubEnv("VOZEB_PRO_DATA_DIR", dataDir);
            vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", provider);
            const original = (await getFreshAuthSettings()).site;
            try {
                await getPublicSiteSettings();
                const response = await PATCH(new Request("http://localhost/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: { ...DEFAULT_SITE_SETTINGS, seo } }) }));
                expect(response.status).toBe(200);
                expect((await response.json()).settings.site.seo).toEqual(seo);
                expect((await (await GET()).json()).settings.site.seo).toEqual(seo);
                expect((await getAuthSettings()).site.seo).toEqual(seo);
                expect((await getFreshAuthSettings()).site.seo).toEqual(seo);
                expect((await getPublicSiteSettings()).seo).toEqual(seo);
                expect(serializePublicSettings(await getFreshAuthSettings()).site.seo).toEqual(seo);
                const cleared = { ...seo, en: { title: "", description: " ", keywords: "" } };
                await PATCH(new Request("http://localhost/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: { ...original, seo: cleared } }) }));
                const reread = (await (await GET()).json()).settings.site.seo;
                expect(reread.en.description).toContain("AI creation platform");
                expect(reread.vi).toEqual(seo.vi);
                expect(reread["zh-CN"]).toEqual(seo["zh-CN"]);
                expect((await getFreshAuthSettings()).site.seo).toEqual(reread);
            } finally {
                await setAuthSettings({ site: original });
            }
        });
    }
});
