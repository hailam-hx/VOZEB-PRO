import type { Page, Request, Response } from "@playwright/test";

export type ApiFailure = { path: string; status: number; body: string };
type PendingRequest = { done: Promise<void>; finish: () => void; failure?: ApiFailure };

export function observeRouteApi(page: Page, origin: string) {
    const failures: ApiFailure[] = [];
    const pending = new Map<Request, PendingRequest>();
    const onRequest = (request: Request) => {
        const url = new URL(request.url());
        // EventSource connections intentionally stay open across the page's lifetime.
        if (url.origin !== origin || !url.pathname.startsWith("/api/") || request.resourceType() === "eventsource") return;
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
            finish = resolve;
        });
        pending.set(request, { done, finish });
    };
    const finishRequest = (request: Request, entry: PendingRequest) => {
        if (pending.get(request) !== entry) return;
        pending.delete(request);
        entry.finish();
    };
    const recordFailure = (request: Request, entry: PendingRequest, body: string) => {
        if (entry.failure) entry.failure.body = body;
        else failures.push({ path: new URL(request.url()).pathname, status: 0, body });
    };
    const onResponse = async (response: Response) => {
        const request = response.request();
        const entry = pending.get(request);
        if (!entry) return;
        if (response.status() >= 400) {
            entry.failure = { path: new URL(request.url()).pathname, status: response.status(), body: "<unreadable>" };
            failures.push(entry.failure);
        }
        try {
            const error = await response.finished();
            if (pending.get(request) !== entry) return;
            if (error) throw error;
            if (entry.failure) entry.failure.body = await response.text();
        } catch (error) {
            if (pending.get(request) === entry) recordFailure(request, entry, error instanceof Error ? error.message : "<unreadable>");
        } finally {
            finishRequest(request, entry);
        }
    };
    const onFailed = (request: Request) => {
        const entry = pending.get(request);
        if (!entry) return;
        recordFailure(request, entry, request.failure()?.errorText || "API request failed");
        finishRequest(request, entry);
    };
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
    return {
        failures,
        async settle() {
            while (pending.size) await Promise.all([...pending.values()].map((entry) => entry.done));
        },
        dispose() {
            page.off("request", onRequest);
            page.off("response", onResponse);
            page.off("requestfailed", onFailed);
            for (const entry of pending.values()) entry.finish();
            pending.clear();
        },
    };
}
