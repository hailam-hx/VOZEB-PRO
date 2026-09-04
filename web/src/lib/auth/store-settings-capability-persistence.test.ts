import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.VOZEB_PRO_DATA_DIR;
const originalDatabaseProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;

import { getFreshAuthSettings, setAuthSettings } from "./store-settings-actions";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";

describe("file settings capability persistence", () => {
    let dataDir = "";

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "vozeb-capability-settings-"));
        vi.stubEnv("VOZEB_PRO_DATA_DIR", dataDir);
        vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", "file");
    });

    afterEach(async () => {
        await rm(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
        else process.env.VOZEB_PRO_DATA_DIR = originalDataDir;
        if (originalDatabaseProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
        else process.env.VOZEB_PRO_DATABASE_PROVIDER = originalDatabaseProvider;
    });

    it("writes a nested generation profile and exposes it through an immediate fresh read", async () => {
        const systemChannels = [{ id: "one", name: "渠道", baseUrl: "https://api.example.com/v1", apiKey: "", apiFormat: "openai" as const, models: ["image"], enabled: true }];
        const logicalModels = [
            {
                id: "image",
                name: "图片",
                capability: "image" as const,
                enabled: true,
                bindings: [
                    {
                        id: "image:one",
                        channelId: "one",
                        upstreamModel: "image",
                        enabled: true,
                        priority: 1,
                        generationParameters: normalizeGenerationParameters({
                            aspectRatios: ["16 : 9", "16:9"],
                            pixelSizes: ["1024 × 768"],
                            qualities: ["ultra"],
                            maxBatchSize: 2,
                            supportsCustomBatchSize: true,
                            customBatchSizeRange: { min: 3, max: 8 },
                            supportsCustomDuration: true,
                            customDurationRange: { min: 2.5, max: 12.5 },
                        })!,
                    },
                ],
            },
        ];

        await setAuthSettings({ systemChannels, logicalModels, defaultModels: { imageModel: "image", videoModel: "", textModel: "", audioModel: "", voiceCloneModel: "" } });

        await expect(getFreshAuthSettings()).resolves.toMatchObject({
            logicalModels: [
                {
                    bindings: [
                        {
                            generationParameters: {
                                aspectRatios: ["16:9"],
                                pixelSizes: ["1024x768"],
                                qualities: ["ultra"],
                                maxBatchSize: 2,
                                supportsCustomBatchSize: true,
                                customBatchSizeRange: { min: 3, max: 8 },
                                supportsCustomDuration: true,
                                customDurationRange: { min: 2.5, max: 12.5 },
                            },
                        },
                    ],
                },
            ],
        });
    });

    it("preserves arbitrary concrete defaults through a file write and fresh read", async () => {
        await setAuthSettings({ generationDefaults: { ...structuredClone((await getFreshAuthSettings()).generationDefaults), imageQuality: "ultra", videoQuality: "2K", videoSeconds: 1.5, audioVoice: "narrator", audioFormat: "m4a" } });

        await expect(getFreshAuthSettings()).resolves.toMatchObject({ generationDefaults: { imageQuality: "ultra", videoQuality: "2K", videoSeconds: 1.5, audioVoice: "narrator", audioFormat: "m4a" } });
    });
});
