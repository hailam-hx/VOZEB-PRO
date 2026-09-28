import { describe, expect, it, vi } from "vitest";

import { verifyDflopValidationAvatar } from "./dflop-special-avatar-fixture";

describe("pre-provisioned DFLOP avatar fixture", () => {
    it("accepts only an avatar owned by the configured key and returned ready", async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "avatar-ready", status: "ready" }), { headers: { "content-type": "application/json" } }));
        expect(await verifyDflopValidationAvatar({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", avatarId: "avatar-ready", fetcher })).toBe(true);
        expect(fetcher).toHaveBeenCalledWith("https://api.dflop.top/v1/videos/avatars/avatar-ready", expect.objectContaining({ headers: { Authorization: "Bearer secret" } }));
    });

    it("rejects pending or mismatched avatars", async () => {
        expect(await verifyDflopValidationAvatar({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", avatarId: "avatar-ready", fetcher: async () => new Response(JSON.stringify({ id: "other", status: "ready" })) })).toBe(false);
        expect(await verifyDflopValidationAvatar({ baseUrl: "https://api.dflop.top/v1", apiKey: "secret", avatarId: "avatar-ready", fetcher: async () => new Response(JSON.stringify({ id: "avatar-ready", status: "pending" })) })).toBe(false);
    });
});
