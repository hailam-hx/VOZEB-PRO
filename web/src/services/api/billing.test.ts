import { afterEach, describe, expect, it, vi } from "vitest";

import { checkTopUpOrder, createTopUpOrder, listTopUpPresets, quoteTopUpOrder, subscribeTopUpOrder, syncTopUpOrder } from "./billing";

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

    it("syncs a top-up using only the encoded local order id", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ code: 0, data: { order: { id: "order one", status: "paid" }, syncStatus: "paid" }, msg: "" }) });
        vi.stubGlobal("fetch", fetchMock);

        await syncTopUpOrder("order one");

        expect(fetchMock).toHaveBeenCalledWith("/api/billing/top-ups/orders/order%20one/sync", expect.objectContaining({ method: "POST", cache: "no-store" }));
        expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
    });

    it("queries ZaloPay through sync while other providers only reload local state", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ code: 0, data: { order: { id: "zalo", provider: "zalopay" }, syncStatus: "pending" }, msg: "" }) })
            .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ code: 0, data: { order: { id: "stripe", provider: "stripe" } }, msg: "" }) });
        vi.stubGlobal("fetch", fetchMock);

        await checkTopUpOrder({ id: "zalo", provider: "zalopay" });
        await checkTopUpOrder({ id: "stripe", provider: "stripe" });

        expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/billing/top-ups/orders/zalo/sync");
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
        expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/billing/top-ups/orders/stripe");
        expect(fetchMock.mock.calls[1]?.[1]?.method).toBeUndefined();
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
