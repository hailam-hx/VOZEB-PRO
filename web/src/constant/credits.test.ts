import { describe, expect, it } from "vitest";
import { formatCreditAmount, requestCreditCost } from "./credits";

describe("requestCreditCost", () => {
    it("uses the shared Decimal sale rate card and keeps custom channels free", () => {
        const options = {
            model: "gpt-image",
            logicalModels: [{ id: "gpt-image", name: "GPT Image", capability: "image" as const, enabled: true, saleRateCard: { version: 1 as const, revision: "image-v2", components: [{ id: "count", dimension: "count" as const, unitPrice: "2" }] }, bindings: [] }],
            kind: "image" as const,
            count: 3,
        };
        expect(requestCreditCost({ ...options, apiSource: "system" })).toBe("6");
        expect(requestCreditCost({ ...options, apiSource: "custom" })).toBe("0");
    });

    it("does not round fractional components before the final estimate", () => {
        expect(
            requestCreditCost({
                apiSource: "system",
                model: "image-pro",
                logicalModels: [{ id: "image-pro", name: "Image Pro", capability: "image", enabled: true, saleRateCard: { version: 1, revision: "image-v3", components: [{ id: "mp", dimension: "megapixels", unitPrice: "0.000000003" }] }, bindings: [] }],
                kind: "image",
                count: "2",
                resolution: "1920x1080",
            }),
        ).toBe("0.00000002");
    });

    it("formats settled credits without converting large decimal values to floating point", () => {
        expect(formatCreditAmount("1234567890123456789012.12345678")).toBe("1,234,567,890,123,456,789,012.12345678");
    });

    it("uses public model limits to calculate the same upper-bound text reserve", () => {
        expect(
            requestCreditCost({
                apiSource: "system",
                model: "text-pro",
                logicalModels: [
                    {
                        id: "text-pro",
                        name: "Text Pro",
                        capability: "text",
                        enabled: true,
                        saleRateCard: {
                            version: 1,
                            revision: "text-v1",
                            components: [
                                { id: "input", dimension: "inputTokens", unitPrice: "1", per: "1000" },
                                { id: "output", dimension: "outputTokens", unitPrice: "2", per: "1000" },
                            ],
                        },
                        bindings: [{ id: "binding", channelId: "channel", upstreamModel: "text-pro", enabled: true, priority: 1, capabilityProfile: { maxOutputTokens: 2000 } }],
                    },
                ],
                kind: "text",
                characters: "hello",
            }),
        ).toBe("4.005");
    });
});
