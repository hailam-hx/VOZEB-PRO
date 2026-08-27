import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, getAuthSettings, setAuthSettings } from "@/lib/auth/store";
import { readAuthDb } from "@/lib/auth/store-repository";
import { resolveImageGenerationCandidates } from "@/lib/server/capability-constraints";
import { toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { createImageTask, getImageTask } from "@/lib/server/image-task-store";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";

const previousProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const previousDataDir = process.env.VOZEB_PRO_DATA_DIR;
const previousEncryptionKey = process.env.VOZEB_PRO_ENCRYPTION_KEY;
let dataDir = "";

describe("generation capability recovery integration", () => {
    beforeAll(async () => {
        dataDir = await mkdtemp(join(tmpdir(), "vozeb-capability-recovery-"));
        process.env.VOZEB_PRO_DATABASE_PROVIDER = "file";
        process.env.VOZEB_PRO_DATA_DIR = dataDir;
        process.env.VOZEB_PRO_ENCRYPTION_KEY = "ab".repeat(32);
    });

    afterAll(async () => {
        vi.unstubAllGlobals();
        if (previousProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
        else process.env.VOZEB_PRO_DATABASE_PROVIDER = previousProvider;
        if (previousDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
        else process.env.VOZEB_PRO_DATA_DIR = previousDataDir;
        if (previousEncryptionKey === undefined) delete process.env.VOZEB_PRO_ENCRYPTION_KEY;
        else process.env.VOZEB_PRO_ENCRYPTION_KEY = previousEncryptionKey;
        await rm(dataDir, { recursive: true, force: true });
    });

    it("stops a scheduled Auto image before attempt, billing, or provider submission when the binding capability changes", async () => {
        const providerFetch = vi.fn();
        vi.stubGlobal("fetch", providerFetch);
        await setAuthSettings(mediaSettings("high"));
        const initialSettings = await getAuthSettings();
        const routed = resolveLogicalModelCandidates(initialSettings, "image", "image-logical").map(toSystemGenerationChannel);
        const resolved = resolveImageGenerationCandidates(routed, { quality: "auto", size: "auto", count: 1 }, initialSettings.generationDefaults, 0, false);
        expect(resolved.candidates[0]).toMatchObject({ logicalModel: "image-logical", quality: "high", size: "1:1", count: 1 });

        const task = await createImageTask({
            userId: "recovery-user",
            username: "recovery-user",
            displayName: "Recovery User",
            kind: "generation",
            source: "image-workbench",
            config: resolved.candidates[0],
            candidateConfigs: resolved.candidates.slice(1),
            prompt: "draw a lighthouse",
            references: [],
        });
        await scheduleGenerationTask("image", task.id, { executionPhase: "created", nextPollAt: Date.now() });

        await setAuthSettings(mediaSettings("low"));
        const result = await runGenerationTaskRecoveryBatch({ origin: "http://internal", publicOrigin: "http://public", workerId: "capability-integration-worker", taskIds: [task.id], limit: 1 });

        expect(result).toMatchObject({ claimed: 1, failed: 1 });
        const failedTask = await getImageTask(task.id);
        expect(failedTask).toMatchObject({ status: "error", attempts: [] });
        expect(failedTask?.billing).toBeUndefined();
        expect((await readAuthDb()).providerUsageAttempts).toEqual([]);
        expect(providerFetch).not.toHaveBeenCalled();
    });
});

function mediaSettings(quality: "low" | "high") {
    return {
        generationDefaults: { ...DEFAULT_SETTINGS.generationDefaults, imageQuality: "high", imageSize: "1:1", imageCount: 1 },
        systemChannels: [
            {
                id: "image-channel",
                name: "Image Channel",
                baseUrl: "https://provider.example.com/v1",
                apiKey: "provider-secret",
                apiFormat: "openai" as const,
                models: ["image-upstream"],
                enabled: true,
            },
        ],
        logicalModels: [
            {
                id: "image-logical",
                name: "Image Logical",
                capability: "image" as const,
                enabled: true,
                bindings: [
                    {
                        id: "image-binding",
                        channelId: "image-channel",
                        upstreamModel: "image-upstream",
                        enabled: true,
                        priority: 1,
                        generationParameters: {
                            referenceInputs: [],
                            aspectRatios: ["1:1"],
                            pixelSizes: [],
                            supportsCustomSize: false,
                            qualities: [quality],
                            resolutions: [],
                            durationSeconds: [],
                            videoReferenceModes: [],
                            voices: [],
                            formats: [],
                            maxBatchSize: 1,
                        },
                    },
                ],
            },
        ],
        defaultModels: { ...DEFAULT_SETTINGS.defaultModels, imageModel: "image-logical" },
    };
}
