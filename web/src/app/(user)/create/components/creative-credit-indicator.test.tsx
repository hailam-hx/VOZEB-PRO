import { renderWithI18n as renderToStaticMarkup } from "@/test/render-with-i18n";
import { describe, expect, it } from "vitest";

import { CreativeCreditIndicator } from "./creative-credit-indicator";

describe("CreativeCreditIndicator", () => {
    it("shows only the exact formatted estimate with an accessible settlement note", () => {
        const cases = [
            { locale: "zh-CN", label: "预计消耗 1,234.5 积分", title: "实际按最终模型与用量结算" },
            { locale: "en", label: "Estimated cost: 1,234.5 credits", title: "Final settlement uses the selected model and actual usage" },
            { locale: "vi", label: "Ước tính tiêu tốn 1,234.5 điểm", title: "Quyết toán cuối cùng dựa trên mô hình và mức sử dụng thực tế" },
        ] as const;

        for (const { locale, label, title } of cases) {
            const markup = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "ready", credits: "1234.50000000" }} />, locale);

            expect(markup).toContain('data-testid="creative-credit-estimate"');
            expect(markup).toContain(`aria-label="${label}"`);
            expect(markup).toContain(`title="${title}"`);
            expect(markup.match(/>1,234\.5<\/span>/g)).toHaveLength(2);
        }
    });

    it("keeps smart-planning detail accessible without rendering it visibly", () => {
        const cases = [
            { locale: "zh-CN", label: "预计积分：智能规划后确定", compactLabel: "规划后确定" },
            { locale: "en", label: "Estimated credits: set after smart planning", compactLabel: "After planning" },
            { locale: "vi", label: "Điểm ước tính: xác định sau khi lập kế hoạch", compactLabel: "Sau lập kế hoạch" },
        ] as const;

        for (const { locale, label, compactLabel } of cases) {
            const planning = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "planning" }} />, locale);

            expect(planning).toContain(`aria-label="${label}"`);
            expect(planning).not.toContain(`>${label}</span>`);
            expect(planning).not.toContain(`>${compactLabel}</span>`);
        }
    });

    it("explains unavailable estimates without calling them free", () => {
        const unavailable = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "unavailable" }} />);

        expect(unavailable).toContain("暂不可估算");
        expect(unavailable).not.toContain("0 积分");
    });
});
