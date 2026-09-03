import { describe, expect, it } from "vitest";

import { billingCheckoutProviderOptions } from "./checkout-client";

describe("billing checkout providers", () => {
    it("offers ZaloPay in the user checkout mapping", () => {
        expect(billingCheckoutProviderOptions.map((provider) => provider.value)).toContain("zalopay");
    });
});
