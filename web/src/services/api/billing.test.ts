import { afterEach, describe, expect, it, vi } from "vitest";

import { createTopUpOrder, listTopUpPresets, quoteTopUpOrder, subscribeTopUpOrder } from "./billing";

describe("top-up API client", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("uses top-up-named preset and quote routes with server-authoritative inputs", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ code: 0, data: { presets: [] }, msg: "" }) })
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ code: 0, data: { quote: { creditAmount: "10" } }, msg: "" }) });
        vi.stubGlobal("fetch", fetchMock);

        await listTopUpPresets();
        await quoteTopUpOrder({ customAmountVnd: "250000", userCouponId: "coupon-one" });

        expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/billing/top-ups/presets");
        expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/billing/top-ups/quotes");
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ customAmountVnd: "250000", userCouponId: "coupon-one" });
    });

    it("creates an order with only the selected preset and provider", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ code: 0, data: { order: { id: "order-one" } }, msg: "" }) });
        vi.stubGlobal("fetch", fetchMock);

        await createTopUpOrder({ presetId: "starter", provider: "stripe" });

        expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/billing/top-ups/orders");
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ presetId: "starter", provider: "stripe" });
    });

    it("subscribes to the top-up order route and closes after a terminal status", () => {
        class FakeEventSource {
            static instance: FakeEventSource;
            onmessage: ((event: MessageEvent<string>) => void) | null = null;
            onerror: (() => void) | null = null;
            close = vi.fn();
            constructor(readonly url: string) {
                FakeEventSource.instance = this;
            }
        }
        vi.stubGlobal("EventSource", FakeEventSource);
        const onOrder = vi.fn();

        subscribeTopUpOrder("order one", onOrder, vi.fn());
        FakeEventSource.instance.onmessage?.({ data: JSON.stringify({ code: 0, data: { order: { id: "order one", status: "paid" } }, msg: "" }) } as MessageEvent<string>);

        expect(FakeEventSource.instance.url).toBe("/api/billing/top-ups/orders/order%20one/events");
        expect(onOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "order one", status: "paid" }));
        expect(FakeEventSource.instance.close).toHaveBeenCalledOnce();
    });
});
