import { fetchSafeOutbound } from "./safe-outbound-fetch";

export async function verifyDflopValidationAvatar(input: { baseUrl: string; apiKey: string; avatarId: string; fetcher?: typeof fetch }) {
    if (!input.apiKey || !input.avatarId.trim()) return false;
    if (process.env.VITEST && !input.fetcher) throw new Error("TEST_TRANSPORT_REQUIRED");
    const base = input.baseUrl.replace(/\/+$/, "");
    const root = base.endsWith("/v1") ? base : `${base}/v1`;
    try {
        const response = await (input.fetcher || fetchSafeOutbound)(`${root}/videos/avatars/${encodeURIComponent(input.avatarId.trim())}`, { headers: { Authorization: `Bearer ${input.apiKey}` }, cache: "no-store" });
        if (!response.ok) return false;
        const payload: unknown = await response.json();
        return Boolean(payload && typeof payload === "object" && "id" in payload && "status" in payload && payload.id === input.avatarId.trim() && payload.status === "ready");
    } catch {
        return false;
    }
}
