import { describe, expect, it } from "vitest";

import { HomeAdvantagesSection, HomeStepsSection } from "./home-static-sections";
import { renderWithI18n } from "@/test/render-with-i18n";

describe("home page translations", () => {
    it.each([
        ["vi", "Bốn bước đơn giản để biến ý tưởng thành hiện thực", "Hơn 100 mẫu sáng tạo"],
        ["en", "Four simple steps from idea to reality", "100+ creative templates"],
        ["zh-CN", "简单四步，创意即刻落地", "100+ 创作模板"],
    ] as const)("renders core sections in %s", (locale, steps, advantage) => {
        const html = renderWithI18n(
            <>
                <HomeStepsSection />
                <HomeAdvantagesSection />
            </>,
            locale,
        );

        expect(html).toContain(steps);
        expect(html).toContain(advantage);
    });
});
