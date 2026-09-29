import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyChannelProtocol, emptyAdvancedConfig, resolveChannelModelAdvancedConfig } from "@/lib/channel-protocol-registry";
import { createProtocolFixtureServer } from "../../../scripts/protocol-fixture-server.mjs";
import { createUpstream } from "./video-generation-application";

describe("DFLOP Seedance reference video", () => {
    let close: (() => Promise<void>) | undefined;

    beforeEach(() => {
        vi.stubEnv("VOZEB_PRO_ALLOW_PRIVATE_UPSTREAMS", "1");
        vi.stubEnv("VOZEB_PRO_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1");
    });

    afterEach(async () => {
        await close?.();
        vi.unstubAllEnvs();
    });

    it("submits one video and three image references with a required resolution", async () => {
        const fixture = createProtocolFixtureServer({ dflop: true });
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Fixture port missing");
        const origin = `http://127.0.0.1:${address.port}`;
        close = () => new Promise<void>((resolve, reject) => fixture.server.close((error?: Error) => (error ? reject(error) : resolve())));
        const model = "doubao-seedance-2.5";
        const configured = applyChannelProtocol(
            { id: "fixture", name: "fixture", baseUrl: origin, apiKey: "fixture-key", apiFormat: "openai", models: [model], enabled: true, advancedConfig: { ...emptyAdvancedConfig(), protocol: "dflop", modelCapabilities: { [model]: "video" } } },
            "dflop",
        );
        const channel = { model, baseUrl: origin, apiKey: "fixture-key", apiFormat: "openai", advancedConfig: resolveChannelModelAdvancedConfig(configured.advancedConfig, model) } as never;
        const references = [{ type: "video" as const, url: `${origin}/media/depth.mp4`, role: "reference" as const }, ...[1, 2, 3].map((index) => ({ type: "image" as const, url: `${origin}/media/ref-${index}.png`, role: "reference" as const }))];
        const raw = { size: "9:16", vquality: "720p", videoSeconds: 4 };
        const multipliers = { imageQuality: {}, videoQuality: { "720": 1 }, videoSeconds: { "4": 1 } } as never;

        await expect(createUpstream("fixture-user", "", "", channel, "Follow the motion", raw, references, multipliers, "fixture-request")).resolves.toMatchObject({ id: expect.stringMatching(/^fixture-dflop-video-/) });
        const requests = fixture.requests.filter((request) => request.method === "POST" && request.path.endsWith("/videos/generations"));
        expect(requests).toHaveLength(1);
        const payload = JSON.parse(requests[0].body.toString());
        expect(payload).toMatchObject({ model, resolution: "720p", ratio: "9:16", duration: 4 });
        expect(payload.content).toEqual([
            { type: "text", text: "Follow the motion" },
            { type: "video_url", role: "reference_video", video_url: { url: references[0].url } },
            ...references.slice(1).map((reference) => ({ type: "image_url", role: "reference_image", image_url: { url: reference.url } })),
        ]);

        await expect(createUpstream("fixture-user", "", "", channel, "Follow the motion", { ...raw, vquality: "auto" }, references, multipliers, "fixture-no-resolution")).rejects.toThrow("参考视频需要明确选择清晰度");
        expect(fixture.requests.filter((request) => request.method === "POST" && request.path.endsWith("/videos/generations"))).toHaveLength(1);
    });
});
