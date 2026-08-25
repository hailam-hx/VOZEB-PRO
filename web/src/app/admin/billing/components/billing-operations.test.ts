import { describe, expect, it } from "vitest";

import { resolveFormValidation } from "./billing-operations";

describe("admin billing form validation", () => {
    it("turns Ant Design validation rejection into an inline-validation result", async () => {
        const validationFailure = { values: { name: "" }, errorFields: [{ name: ["name"], errors: ["请输入名称"], warnings: [] }], outOfDate: false };

        await expect(resolveFormValidation(Promise.reject(validationFailure))).resolves.toBeNull();
    });
});
