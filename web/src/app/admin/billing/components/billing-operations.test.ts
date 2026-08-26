import { describe, expect, it } from "vitest";

import { adminTopUpOrderActions, adminTopUpProviderLabel, formatPricingRateCardForAdmin, formatProviderCostUnitForAdmin, resolveFormValidation } from "./billing-operations";

describe("admin billing form validation", () => {
    it("turns Ant Design validation rejection into an inline-validation result", async () => {
        const validationFailure = { values: { name: "" }, errorFields: [{ name: ["name"], errors: ["请输入名称"], warnings: [] }], outOfDate: false };

        await expect(resolveFormValidation(Promise.reject(validationFailure))).resolves.toBeNull();
    });
});

describe("admin top-up order presentation", () => {
    it("labels manual payment and exposes only valid finance actions", () => {
        expect(adminTopUpProviderLabel("manual")).toBe("人工确认");
        expect(adminTopUpProviderLabel("stripe")).toBe("stripe");
        expect(adminTopUpOrderActions({ provider: "manual", status: "pending" })).toEqual(["receive", "close"]);
        expect(adminTopUpOrderActions({ provider: "manual", status: "paid" })).toEqual(["refund"]);
        expect(adminTopUpOrderActions({ provider: "stripe", status: "pending" })).toEqual([]);
        expect(adminTopUpOrderActions({ provider: "stripe", status: "paid" })).toEqual(["refund"]);
        expect(adminTopUpOrderActions({ provider: "manual", status: "canceled" })).toEqual([]);
    });
});

describe("admin pricing summaries", () => {
    it("shows a conditional video sale rate without exposing the revision fingerprint", () => {
        const summary = formatPricingRateCardForAdmin(
            {
                version: 1,
                revision: 'rate-card-v1:[{"id":"video-duration","dimension":"durationSeconds","unitPrice":"0.04","per":"1","when":{"quality":"standard","resolution":"1280x720","format":"mp4"}}]',
                components: [
                    {
                        id: "video-duration",
                        dimension: "durationSeconds",
                        unitPrice: "0.04",
                        per: "1",
                        when: { quality: "standard", resolution: "1280x720", format: "mp4" },
                    },
                ],
            },
            "积分",
        );

        expect(summary).toEqual({
            versionLabel: "价格卡 v1",
            componentLabels: ["时长：0.04 积分 / 1 秒（质量 standard · 分辨率 1280x720 · 格式 mp4）"],
        });
        expect(JSON.stringify(summary)).not.toContain("rate-card-v1:");
    });

    it("distinguishes provider-native cost from its USD conversion", () => {
        expect(
            formatProviderCostUnitForAdmin({
                kind: "provider-native",
                provider: "Dflop",
                unit: "Dflop-point",
                usdConversion: { version: "dflop-points-v1", usdPerUnit: "0.01666667" },
            }),
        ).toEqual({
            priceUnit: "Dflop-point",
            conversionLabel: "Dflop · 1 Dflop-point = 0.01666667 USD · dflop-points-v1",
        });
    });
});
