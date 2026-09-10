import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { observeRouteApi } from "../e2e/route-api-observer";

const origin = "http://localhost:3100";
function createPage() {
    const page = new EventEmitter();
    const frame = {};
    page.mainFrame = () => frame;
    return page;
}
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function apiRequest(path, resourceType = "fetch") {
    const headers = deferred();
    const body = deferred();
    const request = { url: () => origin + path, resourceType: () => resourceType, response: () => headers.promise };
    const response = { request: () => request, url: request.url, status: () => 500, finished: () => body.promise.then(() => null), text: () => body.promise };
    return { request, response, headers, body };
}

describe("route API observer", () => {
    it("ignores a previous route's delayed response", async () => {
        const page = createPage();
        const previous = apiRequest("/api/admin/billing/orders");
        page.emit("request", previous.request);
        const observer = observeRouteApi(page, origin);
        page.emit("framenavigated", page.mainFrame());
        try {
            page.emit("response", previous.response);
            previous.headers.resolve(previous.response);
            previous.body.resolve("previous route failure");
            await observer.settle();
            expect(observer.failures).toEqual([]);
        } finally {
            observer.dispose();
        }
    });

    it("waits for a current route's delayed response body and records its failure", async () => {
        const page = createPage();
        const observer = observeRouteApi(page, origin);
        page.emit("framenavigated", page.mainFrame());
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
            current.headers.resolve(current.response);
            await setImmediate();
            expect(settled).toBe(false);
            current.body.resolve("current route failure");
            await completion;
            expect(observer.failures).toEqual([{ path: "/api/admin/billing/top-up-presets", status: 500, body: "current route failure" }]);
        } finally {
            observer.dispose();
        }
    });

    it("does not wait for long-lived EventSource requests", async () => {
        const page = createPage();
        const observer = observeRouteApi(page, origin);
        page.emit("framenavigated", page.mainFrame());
        try {
            page.emit("request", apiRequest("/api/agent/runs/run/events", "eventsource").request);
            await observer.settle();
            expect(observer.failures).toEqual([]);
        } finally {
            observer.dispose();
        }
    });

    it("does not wait for old-document requests started before the target navigation commits", async () => {
        const page = createPage();
        const observer = observeRouteApi(page, origin);
        try {
            page.emit("request", apiRequest("/api/public/gallery").request);
            page.emit("framenavigated", {});
            page.emit("request", apiRequest("/api/announcements").request);
            page.emit("framenavigated", page.mainFrame());
            const current = apiRequest("/api/admin/billing/summary");
            page.emit("request", current.request);
            current.headers.resolve(current.response);
            current.body.resolve("current route failure");
            let settled = false;
            const completion = observer.settle().then(() => {
                settled = true;
            });
            await setImmediate();
            expect(settled).toBe(true);
            await completion;
            expect(observer.failures).toEqual([{ path: "/api/admin/billing/summary", status: 500, body: "current route failure" }]);
        } finally {
            observer.dispose();
        }
    });
});
