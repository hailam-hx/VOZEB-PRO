import { renderWithI18n as renderToStaticMarkup } from "@/test/render-with-i18n";
import { describe, expect, it } from "vitest";

import { CreativeCreditIndicator } from "./creative-credit-indicator";

describe("CreativeCreditIndicator", () => {
    it("shows the exact formatted estimate with an accessible settlement note", () => {
        const markup = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "ready", credits: "1234.50000000" }} />);

        expect(markup).toContain('data-testid="creative-credit-estimate"');
        expect(markup).toContain('aria-label="预计消耗 1,234.5 积分"');
        expect(markup).toContain("预计消耗 1,234.5 积分");
        expect(markup).toContain("实际按最终模型与用量结算");
    });

    it("explains non-numeric smart-planning and unavailable estimates without calling them free", () => {
        const planning = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "planning" }} />);
        const unavailable = renderToStaticMarkup(<CreativeCreditIndicator estimate={{ status: "unavailable" }} />);

        expect(planning).toContain("智能规划后确定");
        expect(unavailable).toContain("暂不可估算");
        expect(unavailable).not.toContain("0 积分");
    });
});
