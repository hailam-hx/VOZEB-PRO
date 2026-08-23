import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appLocales } from "@/i18n/config";

const requiredNamespaces = ["common", "auth", "home", "public", "workspace", "create", "canvas", "drama", "media", "billing", "profile"] as const;

function leafKeys(value: unknown, prefix = ""): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
    return Object.entries(value).flatMap(([key, nested]) => leafKeys(nested, prefix ? `${prefix}.${key}` : key));
}

describe("i18n message catalogs", () => {
    it("are valid UTF-8, non-empty, and share the same keys", async () => {
        const catalogs = await Promise.all(
            appLocales.map(async (locale) => {
                const path = fileURLToPath(new URL(`./messages/${locale}.json`, import.meta.url));
                const bytes = await readFile(path);
                const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                return JSON.parse(text) as Record<string, unknown>;
            }),
        );

        for (const catalog of catalogs) {
            expect(requiredNamespaces.every((namespace) => namespace in catalog)).toBe(true);
            const values = leafKeys(catalog).map((key) => key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], catalog));
            expect(values.every((value) => typeof value === "string" && value.trim().length > 0)).toBe(true);
        }

        const expectedKeys = leafKeys(catalogs[0]).sort();
        for (const catalog of catalogs.slice(1)) expect(leafKeys(catalog).sort()).toEqual(expectedKeys);
    });
});
