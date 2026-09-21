import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    cleanupExpired: vi.fn(),
    getRegistration: vi.fn(),
    persistExternal: vi.fn(),
    register: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    stat: mocks.stat,
    unlink: mocks.unlink,
    writeFile: mocks.writeFile,
}));
vi.mock("@/lib/server/local-media-registry", () => ({
    getLocalMediaRegistration: mocks.getRegistration,
    registerLocalMediaAsset: mocks.register,
}));
vi.mock("@/lib/server/local-media-storage", () => ({
    cleanupExpiredLocalMediaAssets: mocks.cleanupExpired,
    createDatedMediaPath: vi.fn(() => "temporary/2026/01/01/images/file.png"),
    REFERENCE_MEDIA_ROOT: "C:\\tmp\\reference-assets",
}));
vi.mock("@/lib/server/object-storage-service", () => ({ persistExternalMediaIfEnabled: mocks.persistExternal }));

import { readReferenceAsset, writePersistentMediaBytes, writeReferenceMediaDataUrl } from "./reference-asset-store";

describe("reference asset lifecycle boundaries", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.persistExternal.mockResolvedValue(null);
    });

    it("does not run media cleanup from the online write path", async () => {
        await expect(writeReferenceMediaDataUrl("invalid", "image", { ownerUserId: "user-one", source: "test" })).rejects.toThrow("参考素材格式不正确");
        expect(mocks.cleanupExpired).not.toHaveBeenCalled();
    });

    it("leaves expired temporary files for reference-aware maintenance", async () => {
        const registration = { storageKey: "temporary/2026/01/01/images/20260101-000000-00000000-0000-4000-8000-000000000000.png" };
        mocks.stat.mockResolvedValue({ size: 12, mtimeMs: 0 });
        mocks.getRegistration.mockResolvedValue(registration);

        await expect(readReferenceAsset(registration.storageKey)).resolves.toMatchObject({ size: 12, registration });
        expect(mocks.unlink).not.toHaveBeenCalled();
    });

    it("persists a multi-megabyte upload from bytes without parsing a data URL", async () => {
        const bytes = new Uint8Array(15_409_730);

        await expect(
            writePersistentMediaBytes(bytes, "image/png", "image", {
                ownerUserId: "user-one",
                source: "creative-upload",
                originalName: "large.png",
                maxBytes: 20 * 1024 * 1024,
            }),
        ).resolves.toMatchObject({ bytes: bytes.byteLength, mimeType: "image/png", storage: "local" });

        expect(mocks.writeFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ byteLength: bytes.byteLength }));
        expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ bytes: bytes.byteLength, mimeType: "image/png" }));
    });
});
