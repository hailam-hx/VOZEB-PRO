import { renderWithI18n as renderToStaticMarkup } from "@/test/render-with-i18n";
import { describe, expect, it } from "vitest";

import { CreativeCreditIndicator } from "./creative-credit-indicator";

describe("CreativeCreditIndicator", () => {
    it("shows only the exact formatted estimate with an accessible settlement note", () => {
        const cases = [
            { locale: "zh-CN", label: "预计积分：约 1,234.5", title: "预计积分根据当前生成参数和正式售价计算。最终扣费以实际生成结果和实际用量为准。" },
            { locale: "en", label: "Estimated credits: about 1,234.5", title: "Estimated credits use the current generation parameters and formal sale price. Final billing uses the generated result and actual usage." },
            { locale: "vi", label: "Điểm ước tính: khoảng 1,234.5", title: "Điểm ước tính được tính từ tham số tạo hiện tại và giá bán chính thức. Khoản trừ cuối cùng dựa trên kết quả tạo và mức sử dụng thực tế." },
        ] as const;

        for (const { locale, label, title } of cases) {
            const markup = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "ESTIMATED", credits: "1234.50000000" }} />, locale);

            expect(markup).toContain('data-testid="creative-credit-estimate"');
            expect(markup).toContain(`aria-label="${label}"`);
            expect(markup).toContain(`title="${title}"`);
            expect(markup).toContain("1,234.5");
        }
    });

    it("keeps smart-planning detail accessible without rendering it visibly", () => {
        const cases = [
            { locale: "zh-CN", label: "预计积分：智能规划后确定", compactLabel: "规划后确定" },
            { locale: "en", label: "Estimated credits: set after smart planning", compactLabel: "After planning" },
            { locale: "vi", label: "Điểm ước tính: xác định sau khi lập kế hoạch", compactLabel: "Sau lập kế hoạch" },
        ] as const;

        for (const { locale, label, compactLabel } of cases) {
            const planning = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "PLANNING" }} />, locale);

            expect(planning).toContain(`aria-label="${label}"`);
            expect(planning).not.toContain(`>${label}</span>`);
            expect(planning).not.toContain(`>${compactLabel}</span>`);
        }
    });

    it("explains unavailable estimates without calling them free", () => {
        const unavailable = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "OFFICIAL_SALE_PRICE_MISSING" }} />);

        expect(unavailable).toContain("未配置正式售价");
        expect(unavailable).not.toContain("0 积分");
    });

    it("shows at most four decimal places and keeps conservative rounding above the upper bound", () => {
        const exact = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "ESTIMATED", credits: "0.7452" }} />);
        const upper = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: "1.8144" }} />);
        const roundedExact = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "ESTIMATED", credits: "0.74525" }} />);
        const roundedUpper = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "CONSERVATIVE_ESTIMATE", upperBoundCredits: "1.81441" }} />);

        expect(exact).toContain('aria-label="预计积分：约 0.7452"');
        expect(upper).toContain('aria-label="预计积分：最高约 1.8144"');
        expect(roundedExact).toContain('aria-label="预计积分：约 0.7453"');
        expect(roundedUpper).toContain('aria-label="预计积分：最高约 1.8145"');
        expect(upper).toContain('data-estimate-status="CONSERVATIVE_ESTIMATE"');
        expect(upper).toContain("用量信息完善后，将更新更准确的预计积分");
    });
});
