import { describe, expect, it, vi } from "vitest";

import { acquireMediaConcurrency, withMediaConcurrency } from "./media-concurrency";

describe("media concurrency", () => {
    it.each([false, true])("releases an unread response when its request aborts (already aborted: %s)", async (alreadyAborted) => {
        const identity = crypto.randomUUID();
        const abort = new AbortController();
        const cancel = vi.fn();
        const source = new ReadableStream<Uint8Array>({ cancel });
        const permit = acquireMediaConcurrency("local", identity, { perIdentity: 1 });
        if (alreadyAborted) abort.abort("client disconnected");
        const response = withMediaConcurrency(new Response(source), permit!, abort.signal);
        if (!alreadyAborted) abort.abort("client disconnected");

        const next = acquireMediaConcurrency("local", identity, { perIdentity: 1 });
        try {
            expect(next).not.toBeNull();
            expect(cancel).toHaveBeenCalledExactlyOnceWith("client disconnected");
        } finally {
            next?.release();
            await response.body?.cancel();
        }
    });

    it.each(["finish", "cancel", "error"])("removes the request abort listener after %s", async (outcome) => {
        const abort = new AbortController();
        const add = vi.spyOn(abort.signal, "addEventListener");
        const remove = vi.spyOn(abort.signal, "removeEventListener");
        const permit = acquireMediaConcurrency("local", crypto.randomUUID());
        const release = vi.spyOn(permit!, "release");
        const source = outcome === "error" ? new ReadableStream<Uint8Array>({ pull: () => Promise.reject(new Error("stream failed")) }) : new Response("media").body!;
        const response = withMediaConcurrency(new Response(source), permit!, abort.signal);
        if (outcome === "cancel") await response.body?.cancel();
        else if (outcome === "error") await expect(response.text()).rejects.toThrow("stream failed");
        else expect(await response.text()).toBe("media");

        expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
        expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
        abort.abort();
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("bounds one identity and releases the permit idempotently", () => {
        const identity = crypto.randomUUID();
        const first = acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1 });
        expect(first).not.toBeNull();
        expect(acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1 })).toBeNull();
        first?.release();
        first?.release();
        const next = acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1 });
        expect(next).not.toBeNull();
        next?.release();
    });

    it("bounds total concurrency across identities", () => {
        const scope = "proxy" as const;
        const first = acquireMediaConcurrency(scope, crypto.randomUUID(), { total: 1, perIdentity: 1 });
        expect(first).not.toBeNull();
        expect(acquireMediaConcurrency(scope, crypto.randomUUID(), { total: 1, perIdentity: 1 })).toBeNull();
        first?.release();
    });

    it("releases the permit after the response stream finishes or is cancelled", async () => {
        const finishedIdentity = crypto.randomUUID();
        const finished = acquireMediaConcurrency("public", finishedIdentity, { total: 2, perIdentity: 1 });
        expect(await withMediaConcurrency(new Response("media"), finished!).text()).toBe("media");
        const afterFinished = acquireMediaConcurrency("public", finishedIdentity, { total: 2, perIdentity: 1 });
        expect(afterFinished).not.toBeNull();
        afterFinished?.release();

        const cancelledIdentity = crypto.randomUUID();
        const cancelled = acquireMediaConcurrency("public", cancelledIdentity, { total: 2, perIdentity: 1 });
        await withMediaConcurrency(new Response("media"), cancelled!).body?.cancel();
        const afterCancelled = acquireMediaConcurrency("public", cancelledIdentity, { total: 2, perIdentity: 1 });
        expect(afterCancelled).not.toBeNull();
        afterCancelled?.release();
    });

    it("releases the permit when the source stream errors", async () => {
        const identity = crypto.randomUUID();
        const permit = acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1 });
        const source = new ReadableStream<Uint8Array>({ pull: () => Promise.reject(new Error("stream failed")) });
        await expect(withMediaConcurrency(new Response(source), permit!).arrayBuffer()).rejects.toThrow("stream failed");
        const next = acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1 });
        expect(next).not.toBeNull();
        next?.release();
    });

    it("cancels an unread source stream when its lease expires", async () => {
        vi.useFakeTimers();
        const identity = crypto.randomUUID();
        const cancel = vi.fn();
        const source = new ReadableStream<Uint8Array>({ cancel });
        const permit = acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1, leaseMs: 100 });
        withMediaConcurrency(new Response(source), permit!);

        await vi.advanceTimersByTimeAsync(100);
        expect(cancel).toHaveBeenCalledWith("Media concurrency lease expired");
        const next = acquireMediaConcurrency("local", identity, { total: 2, perIdentity: 1 });
        expect(next).not.toBeNull();
        next?.release();
        vi.useRealTimers();
    });
});
