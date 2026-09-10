import type { Frame, Page, Request } from "@playwright/test";

export type ApiFailure = { path: string; status: number; body: string };

export function observeRouteApi(page: Page, origin: string) {
    const failures: ApiFailure[] = [];
    const pending = new Set<Promise<void>>();
    let committed = false;
    const onNavigation = (frame: Frame) => {
        if (frame === page.mainFrame()) committed = true;
    };
    const onRequest = (request: Request) => {
        const url = new URL(request.url());
        // EventSource connections intentionally stay open across the page's lifetime.
        if (!committed || url.origin !== origin || !url.pathname.startsWith("/api/") || request.resourceType() === "eventsource") return;
        const read = (async () => {
            let status = 0;
            try {
                const response = await request.response();
                if (!response) throw new Error(request.failure()?.errorText || "API request failed");
                const error = await response.finished();
                if (error) throw error;
                status = response.status();
                if (status >= 400) failures.push({ path: url.pathname, status, body: await response.text() });
            } catch (error) {
                failures.push({ path: url.pathname, status, body: error instanceof Error ? error.message : "<unreadable>" });
            }
        })();
        pending.add(read);
        void read.then(() => pending.delete(read));
    };
    page.on("framenavigated", onNavigation);
    page.on("request", onRequest);
    return {
        failures,
        async settle() {
            while (pending.size) await Promise.all(pending);
        },
        dispose() {
            page.off("framenavigated", onNavigation);
            page.off("request", onRequest);
        },
    };
}
