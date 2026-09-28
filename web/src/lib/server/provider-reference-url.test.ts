import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getRegistration: vi.fn(),
    createExternalProviderUrl: vi.fn(),
    isSafeOutboundUrl: vi.fn(),
    getCreativeAsset: vi.fn(),
}));

vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.getRegistration }));
vi.mock("@/lib/server/object-storage-service", () => ({ createExternalProviderMediaReadUrl: mocks.createExternalProviderUrl }));
vi.mock("@/lib/server/outbound-url-security", () => ({ isSafeOutboundUrl: mocks.isSafeOutboundUrl }));
vi.mock("@/lib/server/creative-runtime-store", () => ({ getCreativeAsset: mocks.getCreativeAsset }));

import { resolveProviderReferenceUrls } from "./provider-reference-url";

describe("provider reference URL resolution", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY", "test-signing-key");
        mocks.isSafeOutboundUrl.mockResolvedValue(true);
        mocks.getCreativeAsset.mockResolvedValue(null);
    });

    afterEach(() => vi.unstubAllEnvs());

    it("prefers a direct signed object-storage URL for managed reference assets", async () => {
        mocks.getRegistration.mockResolvedValue({
            storageKey: "permanent/images/reference.png",
            ownerUserId: "user-one",
            storageProvider: "object",
            externalStorageId: "default",
            externalObjectKey: "hotx/reference.png",
        });
        mocks.createExternalProviderUrl.mockResolvedValue("https://objects.example.com/reference.png?X-Amz-Signature=secret");

        const result = await resolveProviderReferenceUrls([{ type: "image", url: "/api/reference-assets/permanent/images/reference.png" }], "http://localhost:3000", "user-one");

        expect(result[0]?.url).toBe("https://objects.example.com/reference.png?X-Amz-Signature=secret");
        expect(mocks.createExternalProviderUrl).toHaveBeenCalledWith(expect.objectContaining({ externalObjectKey: "hotx/reference.png" }));
    });

    it("uses a long-lived signed HOTX URL only when the configured origin is public", async () => {
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/images/reference.png", ownerUserId: "user-one", storageProvider: "local" });

        const [result] = await resolveProviderReferenceUrls([{ type: "image", url: "/api/reference-assets/permanent/images/reference.png" }], "https://media.example.com", "user-one");

        const url = new URL(result.url);
        expect(url.origin).toBe("https://media.example.com");
        expect(url.searchParams.get("purpose")).toBe("provider-read");
        expect(Number(url.searchParams.get("expires"))).toBeGreaterThan(Math.floor(Date.now() / 1000) + 50 * 60);
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://192.168.1.20:3000", "http://10.0.0.8:3000", "http://service.internal:3000", "http://video-worker:3000"])(
        "fails before the provider for a non-public managed-media origin: %s",
        async (origin) => {
            mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/images/reference.png", ownerUserId: "user-one", storageProvider: "local" });

            await expect(resolveProviderReferenceUrls([{ type: "image", url: "/api/reference-assets/permanent/images/reference.png" }], origin, "user-one")).rejects.toThrow("公网");
            expect(mocks.createExternalProviderUrl).not.toHaveBeenCalled();
        },
    );

    it("rejects external reference URLs that point to private networks", async () => {
        await expect(resolveProviderReferenceUrls([{ type: "image", url: "http://172.16.1.5/reference.png" }], "https://media.example.com", "user-one")).rejects.toThrow("公网");
    });

    it("rejects a public-looking hostname when DNS resolves it to a non-public address", async () => {
        mocks.isSafeOutboundUrl.mockResolvedValue(false);

        await expect(resolveProviderReferenceUrls([{ type: "image", url: "https://media.example.com/reference.png" }], "https://media.example.com", "user-one")).rejects.toThrow("公网");
    });

    it("does not expose a managed asset owned by another user", async () => {
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/images/reference.png", ownerUserId: "user-two", storageProvider: "object" });

        await expect(resolveProviderReferenceUrls([{ type: "image", url: "/api/reference-assets/permanent/images/reference.png" }], "https://media.example.com", "user-one")).rejects.toThrow("无权访问");
        expect(mocks.createExternalProviderUrl).not.toHaveBeenCalled();
    });

    it("uses the owned asset URL and server-verified duration instead of forged client fields", async () => {
        mocks.getCreativeAsset.mockResolvedValue({
            id: "asset-video",
            userId: "user-one",
            type: "video",
            status: "ready",
            serverUrl: "/api/reference-assets/permanent/videos/trusted.mp4",
            durationMs: 12_345,
            metadata: { mediaProbe: { status: "verified", source: "ffprobe" } },
        });
        mocks.getRegistration.mockResolvedValue({ storageKey: "permanent/videos/trusted.mp4", ownerUserId: "user-one", storageProvider: "object" });
        mocks.createExternalProviderUrl.mockResolvedValue("https://objects.example.com/trusted.mp4");

        const [result] = await resolveProviderReferenceUrls([{ type: "video", url: "https://attacker.example/long.mp4", assetId: "asset-video" }], "https://media.example.com", "user-one");

        expect(result).toMatchObject({ assetId: "asset-video", url: "https://objects.example.com/trusted.mp4", trustedDurationMs: 12_345, durationSource: "server-probed" });
    });
});
