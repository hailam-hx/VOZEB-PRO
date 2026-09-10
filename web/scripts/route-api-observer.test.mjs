import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { observeRouteApi } from "../e2e/route-api-observer";

const origin = "http://localhost:3100";
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function apiRequest(path, resourceType = "fetch") {
    const finished = deferred();
    const body = deferred();
    const request = { url: () => origin + path, resourceType: () => resourceType };
    const response = { request: () => request, status: () => 500, finished: () => finished.promise, text: () => body.promise };
    return { request, response, finished, body };
}

describe("fresh-page API observer", () => {
    it("collects only the owned page's requests and responses without navigation state", async () => {
        const previousPage = new EventEmitter();
        const page = new EventEmitter();
        const observer = observeRouteApi(page, origin);
        try {
            const previous = apiRequest("/api/admin/billing/orders");
            previousPage.emit("request", previous.request);
            previousPage.emit("response", previous.response);
            const current = apiRequest("/api/admin/referrals");
            page.emit("request", current.request);
            page.emit("response", current.response);
            current.finished.resolve(null);
            current.body.resolve("current page failure");
            await observer.settle();
            expect(observer.failures).toEqual([{ path: "/api/admin/referrals", status: 500, body: "current page failure" }]);
        } finally {
            observer.dispose();
        }
    });

    it("waits for current response headers, completion, and failure body", async () => {
        const page = new EventEmitter();
        const observer = observeRouteApi(page, origin);
        const current = apiRequest("/api/admin/billing/top-up-presets");
        try {
            page.emit("request", current.request);
            let settled = false;
            const completion = observer.settle().then(() => {
                settled = true;
            });
            await setImmediate();
            expect(settled).toBe(false);
            page.emit("response", current.response);
            current.finished.resolve(null);
            await setImmediate();
            expect(settled).toBe(false);
            current.body.resolve("current page failure");
            await completion;
            expect(observer.failures).toEqual([{ path: "/api/admin/billing/top-up-presets", status: 500, body: "current page failure" }]);
        } finally {
            observer.dispose();
        }
    });

    it.each(["net::ERR_CONNECTION_RESET", "net::ERR_ABORTED"])("settles never-response requests and reports %s", async (errorText) => {
        const page = new EventEmitter();
        const observer = observeRouteApi(page, origin);
        const current = apiRequest("/api/auth/session");
        current.request.failure = () => ({ errorText });
        try {
            page.emit("request", current.request);
            const completion = observer.settle();
            page.emit("requestfailed", current.request);
            await completion;
            expect(observer.failures).toEqual([{ path: "/api/auth/session", status: 0, body: errorText }]);
        } finally {
            observer.dispose();
        }
    });

    it("preserves the HTTP failure status when its body is unavailable", async () => {
        const page = new EventEmitter();
        const observer = observeRouteApi(page, origin);
        const current = apiRequest("/api/auth/session");
        current.response.text = async () => {
            throw new Error("response body unavailable");
        };
        try {
            page.emit("request", current.request);
            page.emit("response", current.response);
            current.finished.resolve(null);
            await observer.settle();
            expect(observer.failures).toEqual([{ path: "/api/auth/session", status: 500, body: "response body unavailable" }]);
        } finally {
            observer.dispose();
        }
    });

    it("includes requests started while previously observed requests are settling", async () => {
        const page = new EventEmitter();
        const observer = observeRouteApi(page, origin);
        const first = apiRequest("/api/announcements");
        first.response.status = () => 200;
        const second = apiRequest("/api/auth/session");
        try {
            page.emit("request", first.request);
            let settled = false;
            const completion = observer.settle().then(() => {
                settled = true;
            });
            page.emit("response", first.response);
            page.emit("request", second.request);
            first.finished.resolve(null);
            await setImmediate();
            expect(settled).toBe(false);
            page.emit("response", second.response);
            second.finished.resolve(null);
            second.body.resolve("late failure");
            await completion;
            expect(observer.failures).toEqual([{ path: "/api/auth/session", status: 500, body: "late failure" }]);
        } finally {
            observer.dispose();
        }
    });

    it("excludes long-lived EventSource streams and detaches listeners on disposal", async () => {
        const page = new EventEmitter();
        const observer = observeRouteApi(page, origin);
        page.emit("request", apiRequest("/api/agent/runs/run/events", "eventsource").request);
        await observer.settle();
        observer.dispose();
        expect(page.eventNames()).toEqual([]);
        expect(observer.failures).toEqual([]);
    });
});
