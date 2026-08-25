import { describe, expect, it } from "vitest";

import { adminTopUpOrderActions, adminTopUpProviderLabel, resolveFormValidation } from "./billing-operations";

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
