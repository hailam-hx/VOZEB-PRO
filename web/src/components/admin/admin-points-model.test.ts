import { describe, expect, it } from "vitest";

import { projectAdminPointAdjustment } from "./admin-points-model";

describe("admin points adjustment projection", () => {
    it("projects an increase without losing decimal precision", () => {
        expect(projectAdminPointAdjustment({ settledBalance: "10.5", heldBalance: "2", operation: "increase", amount: "1.25000001" })).toEqual({ balanceAfter: "11.75000001", availableAfter: "9.75000001", valid: true });
    });

    it("blocks a deduction below the active hold boundary", () => {
        expect(projectAdminPointAdjustment({ settledBalance: "10.5", heldBalance: "8", operation: "decrease", amount: "3" })).toEqual({ balanceAfter: "7.5", availableAfter: "-0.5", valid: false, error: "扣减后结算余额不能低于当前预留积分" });
    });

    it("does not produce a preview for incomplete or over-precision input", () => {
        expect(projectAdminPointAdjustment({ settledBalance: "10.5", heldBalance: "0", operation: "increase", amount: "" })).toEqual({ valid: false });
        expect(projectAdminPointAdjustment({ settledBalance: "10.5", heldBalance: "0", operation: "increase", amount: "0.123456789" })).toEqual({ valid: false, error: "调整积分最多保留 8 位小数" });
    });
});
