import { afterEach, describe, expect, it, vi } from "vitest";

import { configuredValidationFixtures, validationFixtureUrl } from "./video-validation-fixtures";

const webp = new Uint8Array([82, 73, 70, 70, 24, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("video validation reference fixtures", () => {
    it("accepts two distinct public HTTPS images only after fetching and checking MIME and bytes", async () => {
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_IMAGE_FIXTURE_URL", "https://fixtures.example/first.webp");
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_LAST_FRAME_FIXTURE_URL", "https://fixtures.example/last.webp");
        const fetcher = vi.fn(async () => new Response(webp, { headers: { "content-type": "image/webp" } }));
        vi.stubGlobal("fetch", fetcher);
        expect(await configuredValidationFixtures()).toEqual({ image: true, lastFrame: true, video: false });
        expect(validationFixtureUrl({ role: "last_frame", fixture: "image" })).toBe("https://fixtures.example/last.webp");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("rejects localhost, a mismatched MIME, and identical first/last frame URLs", async () => {
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_IMAGE_FIXTURE_URL", "https://localhost/first.webp");
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_LAST_FRAME_FIXTURE_URL", "https://fixtures.example/last.webp");
        const fetcher = vi.fn(async () => new Response(webp, { headers: { "content-type": "text/html" } }));
        vi.stubGlobal("fetch", fetcher);
        expect(await configuredValidationFixtures()).toEqual({ image: false, lastFrame: false, video: false });
        expect(fetcher).toHaveBeenCalledTimes(1);
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_IMAGE_FIXTURE_URL", "https://fixtures.example/last.webp");
        expect(await configuredValidationFixtures()).toEqual({ image: false, lastFrame: false, video: false });
    });
});
