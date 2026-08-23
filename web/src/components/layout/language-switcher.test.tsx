import { describe, expect, it, vi } from "vitest";

import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { renderWithI18n } from "@/test/render-with-i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/i18n/actions", () => ({ setLocalePreference: vi.fn() }));

describe("LanguageSwitcher", () => {
    it.each([
        ["vi", "Đổi ngôn ngữ"],
        ["en", "Change language"],
        ["zh-CN", "切换语言"],
    ] as const)("renders an accessible trigger for %s", (locale, label) => {
        const html = renderWithI18n(<LanguageSwitcher />, locale);

        expect(html).toContain(`aria-label="${label}"`);
        expect(html).toContain(`data-locale="${locale}"`);
        expect(html).toContain("<svg");
    });
});
