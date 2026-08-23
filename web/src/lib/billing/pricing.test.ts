import { describe, expect, it } from "vitest";

import {
    calculateFinalSaleCharge,
    calculatePricingReserve,
    normalizeBillableUsage,
    validatePricingRateCard,
    type PricingRateCardV1,
} from "./pricing";

const textRateCard: PricingRateCardV1 = {
    version: 1,
    components: [
        { id: "input", dimension: "inputTokens", unitPrice: "0.000000015" },
        { id: "output", dimension: "outputTokens", unitPrice: "0.000000025" },
    ],
};

describe("pricing", () => {
    it("reserves text from measured input and the requested maximum output", () => {
        const reserve = calculatePricingReserve({
            rateCard: textRateCard,
            usage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "120", maxOutputTokens: "80" }),
        });

        expect(reserve).toMatchObject({ credits: "0.0000038", usage: { inputTokens: "120", outputTokens: "80", source: "reserve" } });
    });

    it("rejects a text reserve without a requested output maximum", () => {
        expect(() =>
            calculatePricingReserve({
                rateCard: textRateCard,
                usage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "120" }),
            }),
        ).toThrow("最大输出 token");
    });

    it.each(["image", "video", "audio"] as const)("reserves %s with every configured price-affecting dimension", (capability) => {
        const rateCard: PricingRateCardV1 = {
            version: 1,
            components: [
                { id: "count", dimension: "count", unitPrice: "1" },
                { id: "quality", dimension: "quality", match: "hd", unitPrice: "2" },
                { id: "resolution", dimension: "resolution", match: "1920x1080", unitPrice: "3" },
                { id: "duration", dimension: "durationSeconds", unitPrice: "0.5" },
                { id: "format", dimension: "format", match: "mp4", unitPrice: "4" },
            ],
        };
        const usage = normalizeBillableUsage({ capability, source: "request", count: "2", quality: "hd", resolution: "1920x1080", durationSeconds: "5", format: "mp4" });

        expect(calculatePricingReserve({ rateCard, usage }).credits).toBe("22.5");
    });

    it("settles actual usage before derived and reserve usage, marking only reserve fallback as estimated", () => {
        const reserve = calculatePricingReserve({
            rateCard: textRateCard,
            usage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "100", maxOutputTokens: "100" }),
        });
        const derived = normalizeBillableUsage({ capability: "text", source: "derived", inputTokens: "100", outputTokens: "60" });
        const actual = normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "100", outputTokens: "40" });

        expect(calculateFinalSaleCharge({ rateCard: textRateCard, reserve, derivedUsage: derived, actualUsage: actual })).toMatchObject({ credits: "0.0000025", usage: { source: "actual" }, estimated: false });
        expect(calculateFinalSaleCharge({ rateCard: textRateCard, reserve, derivedUsage: derived })).toMatchObject({ credits: "0.000003", usage: { source: "derived" }, estimated: false });
        expect(calculateFinalSaleCharge({ rateCard: textRateCard, reserve })).toMatchObject({ credits: reserve.credits, usage: { source: "reserve" }, estimated: true });
    });

    it("derives sale charges only from sale usage and caps an invariant-violating charge at its reserve", () => {
        const reserve = calculatePricingReserve({
            rateCard: textRateCard,
            usage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "100", maxOutputTokens: "100" }),
        });
        const actual = normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "100", outputTokens: "1000" });

        expect(calculateFinalSaleCharge({ rateCard: textRateCard, reserve, actualUsage: actual, providerCostUsd: "999999" })).toMatchObject({ credits: reserve.credits, capped: true });
        expect(calculateFinalSaleCharge({ rateCard: textRateCard, reserve, actualUsage: actual, providerCostUsd: "0.0000001" }).credits).toBe(reserve.credits);
    });

    it("retains fractional component sums and rounds credits once at settlement", () => {
        const rateCard = validatePricingRateCard({
            version: 1,
            components: [
                { id: "input", dimension: "inputTokens", unitPrice: "0.000000004" },
                { id: "output", dimension: "outputTokens", unitPrice: "0.000000005" },
            ],
        });
        const reserve = calculatePricingReserve({ rateCard, usage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "1", maxOutputTokens: "1" }) });

        expect(reserve.credits).toBe("0.000000009");
        expect(calculateFinalSaleCharge({ rateCard, reserve, actualUsage: normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: "1", outputTokens: "1" }) }).credits).toBe("0.00000001");
    });

    it("allows an explicit zero-price component for a free model", () => {
        const rateCard = validatePricingRateCard({ version: 1, components: [{ id: "input", dimension: "inputTokens", unitPrice: "0" }] });

        expect(calculatePricingReserve({ rateCard, usage: normalizeBillableUsage({ capability: "text", source: "request", inputTokens: "20", maxOutputTokens: "10" }) }).credits).toBe("0");
    });
});
