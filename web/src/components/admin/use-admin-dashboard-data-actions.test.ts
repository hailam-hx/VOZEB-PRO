import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ useRef: <T>(value: T) => ({ current: value }) }));

import { useAdminDashboardDataActions } from "./use-admin-dashboard-data-actions";

describe("admin dashboard billing summary", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("loads the PAYG summary from the standard API data envelope", async () => {
        const summary = { currencies: [], paidUsdValue: "0", refundedUsdValue: "0", nominalUsdValue: "0" };
        const setBillingSummary = vi.fn();
        const setBillingSummaryLoading = vi.fn();
        const messageError = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { summary }, msg: "" }), { status: 200, headers: { "Content-Type": "application/json" } })),
        );
        const state = new Proxy(
            {
                message: { error: messageError },
                setBillingSummary,
                setBillingSummaryLoading,
            },
            {
                get(target, property) {
                    if (property in target) return target[property as keyof typeof target];
                    if (String(property).endsWith("Ref")) return { current: 0 };
                    return undefined;
                },
            },
        );

        await useAdminDashboardDataActions({ state: state as never }).loadBillingSummary();

        expect(setBillingSummary).toHaveBeenCalledWith(summary);
        expect(setBillingSummaryLoading.mock.calls).toEqual([[true], [false]]);
        expect(messageError).not.toHaveBeenCalled();
    });
});
