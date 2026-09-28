import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { loadValidationFixturePack, verifyValidationFixturePack, type ValidationFixturePack } from "./validation-fixture-pack";

const bytes = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const video = {
    publicUrl: "https://media.example.com/talking.mp4",
    mimeType: "video/mp4",
    sha256,
    durationMs: 6000,
    width: 640,
    height: 360,
    audioPresent: true,
    speechPresent: true,
    faceCount: 1,
    purpose: "talking-video",
    annotationEvidence: "manual-review:2026-09-26",
    reachabilityEvidence: "external-check:2026-09-26",
};

function pack(asset = video): ValidationFixturePack {
    return { version: 1, assets: { "talking-video": asset } };
}

describe("validation fixture pack", () => {
    it("loads the bundled manifest without relying on the process working directory", async () => {
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_FIXTURE_MANIFEST_PATH", "");
        try {
            const manifest = await loadValidationFixturePack();
            expect(manifest.version).toBe(1);
            expect(manifest.assets["talking-video"]?.publicUrl).toBeNull();
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("requires public HTTPS, exact MIME, hash, duration, dimensions, audio and annotation evidence", async () => {
        const inspect = vi.fn(async () => ({ bytes, mimeType: "video/mp4", durationMs: 6000, width: 640, height: 360, audioPresent: true }));
        const result = await verifyValidationFixturePack(pack(), { inspect });
        expect(result.ready).toBe(true);
        expect(result.assets["talking-video"]?.verified).toBe(true);
        expect(inspect).toHaveBeenCalledWith(video.publicUrl);
    });

    it("rejects a changed file even when its URL and metadata look valid", async () => {
        const result = await verifyValidationFixturePack(pack(), { inspect: async () => ({ bytes: new Uint8Array([1]), mimeType: "video/mp4", durationMs: 6000, width: 640, height: 360, audioPresent: true }) });
        expect(result.assets["talking-video"]).toMatchObject({ verified: false, reason: "FIXTURE_HASH_MISMATCH" });
    });

    it("does not treat a server-side fetch alone as proof of external provider reachability", async () => {
        const result = await verifyValidationFixturePack(pack({ ...video, reachabilityEvidence: "" }), { inspect: async () => ({ bytes, mimeType: "video/mp4", durationMs: 6000, width: 640, height: 360, audioPresent: true }) });
        expect(result.assets["talking-video"]).toMatchObject({ verified: false, reason: "FIXTURE_EXTERNAL_REACHABILITY_UNVERIFIED" });
    });

    it("rejects localhost, signed URLs, unverified duration and missing speech evidence", async () => {
        const inspect = vi.fn(async () => ({ bytes, mimeType: "video/mp4", durationMs: 5000, width: 640, height: 360, audioPresent: true }));
        expect((await verifyValidationFixturePack(pack({ ...video, publicUrl: "https://localhost/source.mp4" }), { inspect })).assets["talking-video"]?.reason).toBe("FIXTURE_URL_UNSAFE");
        expect((await verifyValidationFixturePack(pack({ ...video, publicUrl: "https://media.example.com/source.mp4?X-Amz-Expires=60" }), { inspect })).assets["talking-video"]?.reason).toBe("FIXTURE_URL_EPHEMERAL");
        expect((await verifyValidationFixturePack(pack(), { inspect })).assets["talking-video"]?.reason).toBe("FIXTURE_DURATION_MISMATCH");
        expect((await verifyValidationFixturePack(pack({ ...video, annotationEvidence: "" }), { inspect })).assets["talking-video"]?.reason).toBe("FIXTURE_ANNOTATION_UNVERIFIED");
    });
});
