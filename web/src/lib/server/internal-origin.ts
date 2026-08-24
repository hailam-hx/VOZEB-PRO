import { Agent, fetch as undiciFetch } from "undici";
import { createHash } from "node:crypto";

import { GENERATION_TRANSPORT_TIMEOUT_MS } from "@/lib/server/generation-http-lifecycle";
import { canonicalMultipartBodyDigest } from "@/lib/server/multipart-body-digest";
import { toUndiciRequestBody } from "@/lib/server/undici-request-body";
import { canonicalizeSystemAiQuery, finalizeSystemAiUsageRequestHeaders } from "@/lib/server/system-ai-billing";

const internalDispatcher = new Agent({
    headersTimeout: GENERATION_TRANSPORT_TIMEOUT_MS,
    bodyTimeout: GENERATION_TRANSPORT_TIMEOUT_MS,
});

export function resolveInternalOrigin(publicOrigin: string) {
    const configured = normalizeOrigin(process.env.VOZEB_PRO_INTERNAL_ORIGIN || "");
    if (configured) return configured;

    const publicUrl = parseOrigin(publicOrigin);
    if (publicUrl && isLoopbackHost(publicUrl.hostname)) return publicUrl.origin;
    if (process.env.VERCEL === "1") return publicUrl?.origin || publicOrigin;

    const port = process.env.PORT?.trim();
    if (port) return `http://127.0.0.1:${port}`;
    return publicUrl?.origin || "http://127.0.0.1:3000";
}

export function isInternalApiBaseUrl(baseUrl: string) {
    return baseUrl.trim().startsWith("/");
}

export async function fetchInternalApi(input: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method || "GET").toUpperCase();
    const target = new URL(input);
    const request = new Request(input, init);
    const bytes = method === "GET" || method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
    const headers = new Headers(request.headers);
    const multipart = Boolean(bytes && headers.get("content-type")?.toLowerCase().includes("multipart/form-data"));
    const bodyDigest = multipart
        ? await canonicalMultipartBodyDigest(await new Request(input, { method, headers: { "content-type": headers.get("content-type") || "" }, body: bytes }).formData())
        : createHash("sha256")
              .update(bytes || new Uint8Array())
              .digest("hex");
    finalizeSystemAiUsageRequestHeaders(headers, {
        method,
        canonicalPath: target.pathname,
        canonicalQuery: canonicalizeSystemAiQuery(target.searchParams),
        bodyDigest,
    });
    const body = await toUndiciRequestBody(bytes);
    return undiciFetch(input, { ...init, method, headers, body, dispatcher: internalDispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

function normalizeOrigin(value: string) {
    const parsed = parseOrigin(value.trim().replace(/\/+$/, ""));
    return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.origin : "";
}

function parseOrigin(value: string) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function isLoopbackHost(hostname: string) {
    const host = hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
