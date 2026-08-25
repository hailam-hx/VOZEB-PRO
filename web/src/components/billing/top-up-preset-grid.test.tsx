import { describe, expect, it, vi } from "vitest";

import { TopUpPresetGrid } from "@/components/billing/top-up-preset-grid";
import type { TopUpPreset } from "@/services/api/billing";
import { renderWithI18n } from "@/test/render-with-i18n";

describe("TopUpPresetGrid", () => {
    it("renders preset shortcuts and a separate custom VND action", () => {
        const presets: TopUpPreset[] = [
            { id: "starter", name: "入门充值", description: "适合轻量创作", nominalNativeAmount: "250000", enabled: true, sortOrder: 1 },
            { id: "studio", name: "工作室充值", description: "适合持续创作", nominalNativeAmount: "1000000", enabled: true, sortOrder: 2 },
        ];

        const markup = renderWithI18n(<TopUpPresetGrid presets={presets} selectedPresetId="starter" customSelected={false} onSelectPreset={vi.fn()} onSelectCustom={vi.fn()} />);

        expect(markup.match(/data-top-up-preset=/g)).toHaveLength(2);
        expect(markup).toContain('aria-pressed="true"');
        expect(markup).toContain('data-top-up-custom="true"');
        expect(markup).toContain("₫250,000");
    });
});
