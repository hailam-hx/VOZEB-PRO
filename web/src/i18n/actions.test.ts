import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocalePreference } from "@/i18n/actions";
import type { AppLocale } from "@/i18n/config";

const mocks = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("next/headers", () => ({
    cookies: vi.fn(async () => ({ set: mocks.set })),
}));

describe("setLocalePreference", () => {
    beforeEach(() => mocks.set.mockReset());

    it("rejects unsupported locales without writing a cookie", async () => {
        await expect(setLocalePreference("fr" as AppLocale)).rejects.toThrow("Unsupported locale");
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it("stores a supported locale in the current browser for one year", async () => {
        await setLocalePreference("en");

        expect(mocks.set).toHaveBeenCalledWith("vozeb-pro-locale", "en", {
            path: "/",
            sameSite: "lax",
            maxAge: 31_536_000,
            secure: false,
        });
    });
});
