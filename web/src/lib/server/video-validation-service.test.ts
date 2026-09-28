import { describe, expect, it, vi } from "vitest";

import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store-types";
import { decimal } from "@/lib/billing/decimal";
import { buildVideoValidationPreview, startVideoValidationRunWithDependencies } from "./video-validation-service";

const channel: SystemModelChannel = {
    id: "dflop",
    name: "DFLOP",
    baseUrl: "https://api.dflop.top/v1",
    apiKey: "secret",
    hasApiKey: true,
    apiFormat: "openai",
    models: ["cheap", "expensive"],
    enabled: true,
    advancedConfig: {
        protocol: "dflop",
        textModel: "",
        imageModel: "",
        videoModel: "",
        createPath: "/videos/generations",
        queryPath: "/videos/generations/:task_id",
        requestTemplate: "{}",
        resultField: "video_url",
        statusField: "status",
        durationRange: "",
        referenceRule: "",
        supportsReferenceImage: false,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
    },
};

function model(id: string, price: string): LogicalModel {
    return {
        id,
        name: id,
        capability: "video",
        enabled: true,
        bindings: [
            {
                id: `${id}-binding`,
                channelId: "dflop",
                upstreamModel: id,
                enabled: true,
                priority: 1,
                generationParameters: {
                    referenceInputs: [],
                    aspectRatios: ["16:9"],
                    pixelSizes: [],
                    supportsCustomSize: false,
                    qualities: [],
                    resolutions: ["720"],
                    durationMode: "discrete",
                    durationSeconds: [5],
                    videoReferenceModes: [],
                    voices: [],
                    formats: [],
                },
                providerPricingProfile: {
                    provider: "dflop",
                    modelId: id,
                    status: "READY",
                    syncedAt: "2026-09-26T00:00:00.000Z",
                    raw: {},
                    dimensions: [
                        {
                            id: "seconds",
                            kind: "VIDEO_SECOND",
                            unit: "dflop_credit/second",
                            source: "upstream",
                            upstreamValue: decimal(price).times(decimal(400)).toString(),
                            effectiveValue: decimal(price).times(decimal(400)).toString(),
                            providerCostHotxCredits: price,
                            syncedAt: "2026-09-26T00:00:00.000Z",
                        },
                    ],
                    unknownFields: [],
                    missingFields: [],
                    warnings: [],
                },
                costRateCard: { version: 1, revision: `${id}-price`, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: price, when: { resolution: "720p" } }] },
            },
        ],
    };
}

const request = { mode: "family_sample" as const, maxBudgetHotxCredits: "10", concurrency: 1, readyPricingOnly: true as const };

describe("video validation service", () => {
    it("uses a verified special fixture and source pricing for the lipsync dry-run without selecting an unverified workflow", async () => {
        const lipsync = model("dh-lipsync", "0.01");
        lipsync.bindings[0]!.providerPricingProfile = {
            ...lipsync.bindings[0]!.providerPricingProfile!,
            raw: { price_per_video_second: "4.044" },
            conversion: { dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", hotxUsdPerCredit: "1", pricingPolicyVersion: "policy-v1", calculatedAt: "2026-09-26T00:00:00.000Z" },
        };
        const fixture = (name: string, mimeType: string, durationMs: number, audioPresent: boolean) => ({
            verified: true,
            asset: {
                publicUrl: `https://fixtures.example/${name}`,
                mimeType,
                sha256: "a".repeat(64),
                durationMs,
                width: mimeType === "video/mp4" ? 640 : null,
                height: mimeType === "video/mp4" ? 360 : null,
                audioPresent,
                speechPresent: true,
                faceCount: 1,
                purpose: name,
                annotationEvidence: "manual-review",
            },
        });
        const preview = await buildVideoValidationPreview({
            request,
            logicalModels: [lipsync],
            channels: [channel],
            pricingPolicyVersion: "policy-v1",
            specialFixturePack: { ready: true, assets: { "talking-video": fixture("talking.mp4", "video/mp4", 6000, true), "driving-audio": fixture("driver.mp3", "audio/mpeg", 5000, true) } },
        });
        expect(preview.items[0]).toMatchObject({ contractReady: true, liveSelected: true, estimatedProviderCost: { amount: "20.22", currency: "DFLOP_CREDITS" }, estimatedCredits: "0.05055" });
        expect(preview.items[0]?.normalizedContext?.special).toMatchObject({ kind: "lipsync" });
        const noFace = await buildVideoValidationPreview({
            request,
            logicalModels: [lipsync],
            channels: [channel],
            pricingPolicyVersion: "policy-v1",
            specialFixturePack: {
                ready: true,
                assets: { "talking-video": { ...fixture("talking.mp4", "video/mp4", 6000, true), asset: { ...fixture("talking.mp4", "video/mp4", 6000, true).asset, faceCount: 0 } }, "driving-audio": fixture("driver.mp3", "audio/mpeg", 5000, true) },
            },
        });
        expect(noFace.items[0]).toMatchObject({ contractReady: false, skipReason: "FIXTURE_FACE_UNVERIFIED" });
    });

    it("keeps motion blocked until its tier and matching portrait are verified", async () => {
        const motion = model("dh-motion", "0.01");
        motion.bindings[0]!.providerPricingProfile = {
            ...motion.bindings[0]!.providerPricingProfile!,
            raw: { video_price_tiers: { fast: "4.044" } },
            conversion: { dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", hotxUsdPerCredit: "1", pricingPolicyVersion: "policy-v1", calculatedAt: "2026-09-26T00:00:00.000Z" },
        };
        const asset = (name: string, faceCount: number) => ({
            verified: true,
            asset: {
                publicUrl: `https://fixtures.example/${name}`,
                mimeType: name.endsWith("mp4") ? "video/mp4" : "image/webp",
                sha256: "b".repeat(64),
                durationMs: name.endsWith("mp4") ? 5000 : null,
                width: 640,
                height: 360,
                audioPresent: false,
                speechPresent: false,
                faceCount,
                purpose: name,
                annotationEvidence: "manual-review",
            },
        });
        const specialFixturePack = { ready: true, assets: { "motion-source": asset("motion.mp4", 1), "portrait-1": asset("portrait.webp", 1) } };
        const blocked = await buildVideoValidationPreview({ request, logicalModels: [motion], channels: [channel], pricingPolicyVersion: "policy-v1", specialFixturePack });
        expect(blocked.items[0]).toMatchObject({ contractReady: false, skipReason: "MOTION_TIER_UNVERIFIED" });
        motion.bindings[0]!.generationParameters!.resolutions = ["fast"];
        const ready = await buildVideoValidationPreview({ request, logicalModels: [motion], channels: [channel], pricingPolicyVersion: "policy-v1", specialFixturePack });
        expect(ready.items[0]).toMatchObject({ contractReady: true, estimatedProviderCost: { amount: "20.22" }, estimatedCredits: "0.05055" });
    });

    it("captures clip ASR and compose costs as separate steps only with a verified template", async () => {
        const clip = model("clip-compose", "0.12");
        clip.bindings[0]!.providerPricingProfile = {
            ...clip.bindings[0]!.providerPricingProfile!,
            raw: { price_per_video_task: "48" },
            conversion: { dflopCreditsPerCny: "60", dflopCreditsPerCnySource: "upstream", cnyToUsd: "0.15", hotxUsdPerCredit: "1", pricingPolicyVersion: "policy-v1", calculatedAt: "2026-09-26T00:00:00.000Z" },
        };
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_CLIP_TEMPLATE_ID", "style-1");
        try {
            const preview = await buildVideoValidationPreview({
                request,
                logicalModels: [clip],
                channels: [channel],
                pricingPolicyVersion: "policy-v1",
                specialFixturePack: {
                    ready: true,
                    assets: {
                        "talking-video": {
                            verified: true,
                            asset: {
                                publicUrl: "https://fixtures.example/talk.mp4",
                                mimeType: "video/mp4",
                                sha256: "c".repeat(64),
                                durationMs: 6000,
                                width: 640,
                                height: 360,
                                audioPresent: true,
                                speechPresent: true,
                                faceCount: 1,
                                purpose: "talking",
                                annotationEvidence: "manual",
                                reachabilityEvidence: "external",
                            },
                        },
                    },
                },
                verifyClipTemplate: async () => true,
            });
            expect(preview.items[0]).toMatchObject({
                contractReady: true,
                estimatedCredits: "0.12",
                estimatedProviderCost: { amount: "48" },
                boundEvidence: {
                    stepCosts: [
                        { step: "ASR", amount: "0" },
                        { step: "COMPOSE", amount: "48" },
                    ],
                },
            });
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("checks a pre-provisioned avatar is ready but still blocks conflicting avatar pricing", async () => {
        const avatar = model("dh-avatar", "0.01");
        vi.stubEnv("VOZEB_PRO_VIDEO_VALIDATION_AVATAR_ID", "avatar-ready");
        const verifyAvatarReady = vi.fn(async () => true);
        try {
            const preview = await buildVideoValidationPreview({
                request,
                logicalModels: [avatar],
                channels: [channel],
                pricingPolicyVersion: "policy-v1",
                specialFixturePack: {
                    ready: true,
                    assets: {
                        "driving-audio": {
                            verified: true,
                            asset: {
                                publicUrl: "https://fixtures.example/driver.mp3",
                                mimeType: "audio/mpeg",
                                sha256: "d".repeat(64),
                                durationMs: 6000,
                                width: null,
                                height: null,
                                audioPresent: true,
                                speechPresent: true,
                                faceCount: null,
                                purpose: "driver",
                                annotationEvidence: "manual",
                                reachabilityEvidence: "external",
                            },
                        },
                    },
                },
                verifyAvatarReady,
            });
            expect(verifyAvatarReady).toHaveBeenCalledWith("avatar-ready");
            expect(preview.items[0]).toMatchObject({ contractReady: false, skipReason: "AVATAR_PRICING_SOURCE_CONFLICT" });
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it("keeps documented DFLOP workflows out of the generic T2V canary and blocks conflicting Grok prices", async () => {
        const grok = model("grok-imagine-video", "0.015");
        grok.bindings[0]!.generationParameters!.resolutions = [];
        grok.bindings[0]!.costRateCard!.components[0]!.when = undefined;
        const lipsync = model("dh-lipsync", "0.01");
        const clip = model("clip-compose", "0.12");
        const ordinary = model("ordinary-video", "0.02");
        const preview = await buildVideoValidationPreview({ request, logicalModels: [grok, lipsync, clip, ordinary], channels: [channel], pricingPolicyVersion: "policy-v1" });
        expect(preview.items.find((item) => item.logicalModelId === "grok-imagine-video")).toMatchObject({ caseId: "text-to-video", contractReady: false, skipReason: "GROK_PRICING_SOURCE_CONFLICT" });
        expect(preview.items.find((item) => item.logicalModelId === "dh-lipsync")).toMatchObject({ caseId: "lipsync", contractReady: false, skipReason: "FIXTURE_URL_UNSAFE" });
        expect(preview.items.find((item) => item.logicalModelId === "clip-compose")).toMatchObject({ caseId: "clip-compose-workflow", contractReady: false, skipReason: "FIXTURE_URL_UNSAFE" });
        expect(preview.items.find((item) => item.logicalModelId === "ordinary-video")).toMatchObject({ caseId: "text-to-video", contractReady: true, liveSelected: true });
        expect(preview.plannedLiveCanaries).toBe(1);
    });
    it("shares a canary across different model prices while choosing the cheapest binding", async () => {
        const preview = await buildVideoValidationPreview({ request, logicalModels: [model("expensive", "0.56133"), model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" });
        expect(preview).toMatchObject({ selectedModels: 2, runnableModels: 1, estimatedCredits: "1.134", fingerprintCount: 1, plannedLiveCanaries: 1 });
        expect(preview.items.filter((item) => item.liveSelected).map((item) => item.bindingId)).toEqual(["cheap-binding"]);
        expect(preview.items.find((item) => item.bindingId === "expensive-binding")).toMatchObject({ liveSelected: false, skipReason: "SKIPPED_CANARY_NOT_SELECTED", contractReady: true });
        expect(preview.items[0]?.fingerprintHash).not.toBe(preview.items[1]?.fingerprintHash);
        expect(preview.canaryGroups?.[0]).toMatchObject({ modelsInGroup: ["expensive", "cheap"], selectedCanaryModel: "cheap", selectedTestCase: "text-to-video" });
        expect(preview.revision).toMatch(/^video-validation-preview:/);
    });

    it("builds a dry-run canary decision per fingerprint with pricing and execution evidence", async () => {
        const first = model("a", "0.2268");
        const second = model("b", "0.2268");
        for (const logical of [first, second]) {
            logical.bindings[0]!.upstreamModel = "same-upstream";
            logical.bindings[0]!.costRateCard = { ...logical.bindings[0]!.costRateCard!, revision: "same-price" };
            logical.bindings[0]!.providerPricingProfile = { ...logical.bindings[0]!.providerPricingProfile!, modelId: "same-upstream" };
        }
        const preview = await buildVideoValidationPreview({ request, logicalModels: [first, second], channels: [channel], pricingPolicyVersion: "policy-v1" });
        expect(preview).toMatchObject({ totalModels: 2, contractReadyModels: 2, partialModels: 0, blockedModels: 0, fingerprintCount: 1, plannedLiveCanaries: 1 });
        expect(preview.canaryGroups).toHaveLength(1);
        expect(preview.canaryGroups?.[0]).toMatchObject({
            modelsInGroup: ["a", "b"],
            selectedCanaryModel: "a",
            selectionReason: "LOWEST_ESTIMATED_CREDITS",
            minimumDuration: "5",
            minimumResolution: "720p",
            audioEnabled: false,
            estimatedCredits: "1.134",
            providerId: "dflop",
            liveSubmitEligible: true,
            blockedReason: null,
        });
        expect(preview.canaryGroups?.[0]?.contractFingerprint.hash).toMatch(/^[a-f0-9]{64}$/);
        expect(preview.canaryGroups?.[0]?.pricingSnapshot).toMatchObject({ rateCardRevision: "same-price", pricingPolicyVersion: "policy-v1" });
    });

    it("marks a key-visible DFLOP model missing from the public registry for audit", async () => {
        const missing = model("doubao-seedance-2.0-2", "0.2268");
        const registryChannel = {
            ...channel,
            advancedConfig: {
                ...channel.advancedConfig!,
                modelDiscovery: { "doubao-seedance-2.0-2": { kind: "video" as const, matched: false, routable: true } },
            },
        };
        const preview = await buildVideoValidationPreview({ request, logicalModels: [missing], channels: [registryChannel], pricingPolicyVersion: "policy-v1" });
        expect(preview.items[0]?.auditFlags).toContain("PUBLIC_REGISTRY_MISMATCH");
        const independentlyAudited = await buildVideoValidationPreview({ request, logicalModels: [missing], channels: [channel], pricingPolicyVersion: "policy-v1", publicRegistryModelIds: new Map([["dflop", new Set(["another-model"])]]) });
        expect(independentlyAudited.items[0]?.auditFlags).toContain("PUBLIC_REGISTRY_MISMATCH");
    });

    it("skips an unchanged passed binding in changed-model mode", async () => {
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "1".repeat(64));
        const base = await buildVideoValidationPreview({ request, logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" });
        const previous = base.items[0]!;
        const latestVerifications = new Map([[`${previous.bindingId}:${previous.caseId}`, { fingerprintVersion: 1, fingerprintHash: previous.fingerprintHash!, status: "PASSED" }]]);
        const preview = await buildVideoValidationPreview({ request: { ...request, mode: "changed_models" }, logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1", latestVerifications });
        expect(preview.items[0]).toMatchObject({ liveSelected: false, skipReason: "SKIPPED_UNCHANGED" });
        vi.unstubAllEnvs();
    });

    it("keeps price changes in the execution fingerprint for changed-model verification", async () => {
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "1".repeat(64));
        const first = await buildVideoValidationPreview({ request, logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" });
        const previous = first.items[0]!;
        const changed = await buildVideoValidationPreview({
            request: { ...request, mode: "changed_models" },
            logicalModels: [model("cheap", "0.3")],
            channels: [channel],
            pricingPolicyVersion: "policy-v1",
            latestVerifications: new Map([[`${previous.bindingId}:${previous.caseId}`, { fingerprintVersion: previous.fingerprintVersion!, fingerprintHash: previous.fingerprintHash!, status: "PASSED" }]]),
        });
        expect(changed.items[0]).toMatchObject({ liveSelected: true });
        expect(changed.items[0]?.fingerprintHash).not.toBe(previous.fingerprintHash);
        expect(changed.items[0]?.contractFingerprintHash).toBe(previous.contractFingerprintHash);
        vi.unstubAllEnvs();
    });

    it("requires a new live canary when the runtime endpoint changes", async () => {
        const base = await buildVideoValidationPreview({ request, logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" });
        const changed = await buildVideoValidationPreview({
            request,
            logicalModels: [model("cheap", "0.2268")],
            channels: [{ ...channel, advancedConfig: { ...channel.advancedConfig!, queryPath: "/video/status/:id" } }],
            pricingPolicyVersion: "policy-v1",
        });
        expect(changed.items[0]?.fingerprintHash).not.toBe(base.items[0]?.fingerprintHash);
        expect(changed.items[0]?.liveSelected).toBe(true);
    });

    it("requires live after a latest FAIL and holds UNKNOWN for reconciliation", async () => {
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "1".repeat(64));
        const snapshot = { logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" };
        const base = await buildVideoValidationPreview({ request, ...snapshot });
        const candidate = base.items[0]!;
        const key = `${candidate.bindingId}:${candidate.caseId}`;
        const failed = await buildVideoValidationPreview({ request: { ...request, mode: "changed_models" }, ...snapshot, latestVerifications: new Map([[key, { fingerprintVersion: 1, fingerprintHash: candidate.fingerprintHash!, status: "FAILED" }]]) });
        expect(failed.items[0]).toMatchObject({ liveSelected: true });
        const unknown = await buildVideoValidationPreview({ request: { ...request, mode: "changed_models" }, ...snapshot, latestVerifications: new Map([[key, { fingerprintVersion: 1, fingerprintHash: candidate.fingerprintHash!, status: "UNKNOWN" }]]) });
        expect(unknown.items[0]).toMatchObject({ liveSelected: false, skipReason: "NEEDS_RECONCILIATION" });
        vi.unstubAllEnvs();
    });

    it("keeps contract-only free and never invokes generation dependencies", async () => {
        const outbound = vi.spyOn(globalThis, "fetch");
        const preview = await buildVideoValidationPreview({ request: { ...request, mode: "contract_only" }, logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" });
        expect(preview.estimatedProviderCostHotxCredits).toBe("0");
        expect(preview.skippedCases).toBe(0);
        expect(preview.items.every((item) => !item.liveSelected)).toBe(true);
        expect(outbound).not.toHaveBeenCalled();
        outbound.mockRestore();
    });

    it("does not mark a contract-only case passed when its cost bound is unavailable", async () => {
        const candidate = model("token-priced", "0.2268");
        candidate.bindings[0]!.costRateCard = { version: 1, revision: "token", components: [{ id: "tokens", dimension: "durationSeconds", basis: "VIDEO_TOKEN", unitPrice: "1" }] };
        const snapshot = { logicalModels: [candidate], channels: [channel], pricingPolicyVersion: "policy-v1" };
        const command = { ...request, mode: "contract_only" as const };
        const preview = await buildVideoValidationPreview({ request: command, ...snapshot });
        expect(preview.items[0]?.probe.status).toBe("CONTRACT_READY");
        expect(preview.items[0]?.skipReason).toBeTruthy();
        expect(preview.skippedCases).toBe(1);
        const result = await startVideoValidationRunWithDependencies({ ...command, previewRevision: preview.revision }, { actorId: "admin", loadSnapshot: async () => snapshot, createRun: async () => undefined });
        expect(result.items[0]).toMatchObject({ status: "skipped", reasonCode: preview.items[0]?.skipReason });
        expect(result.run.skippedCount).toBe(1);
    });

    it("creates separate live cases for each declared reference contract", async () => {
        const referenced = model("cheap", "0.2268");
        referenced.bindings[0]!.generationParameters = {
            ...referenced.bindings[0]!.generationParameters!,
            referenceInputs: ["image"],
            videoReferenceModes: ["reference", "first_frame", "first_last"],
        };
        const referencedChannel: SystemModelChannel = {
            ...channel,
            advancedConfig: { ...channel.advancedConfig!, supportsReferenceImage: true, imageToVideoPath: "/videos/generations" },
        };
        const preview = await buildVideoValidationPreview({
            request: { ...request, mode: "all_models_minimum" },
            logicalModels: [referenced],
            channels: [referencedChannel],
            pricingPolicyVersion: "policy-v1",
            referenceFixtures: { image: true, video: false },
        });
        expect(preview.items.map((item) => item.caseId)).toEqual(["text-to-video", "image-to-video", "first-frame", "first-last-frame"]);
        expect(preview.items.every((item) => item.liveSelected)).toBe(true);
    });

    it("keeps reference cases visible but skips paid execution when the fixture is unavailable", async () => {
        const referenced = model("cheap", "0.2268");
        referenced.bindings[0]!.generationParameters = {
            ...referenced.bindings[0]!.generationParameters!,
            referenceInputs: ["image"],
            videoReferenceModes: ["reference"],
        };
        const referencedChannel: SystemModelChannel = { ...channel, advancedConfig: { ...channel.advancedConfig!, supportsReferenceImage: true, imageToVideoPath: "/videos/generations" } };
        const preview = await buildVideoValidationPreview({
            request: { ...request, mode: "all_models_minimum" },
            logicalModels: [referenced],
            channels: [referencedChannel],
            pricingPolicyVersion: "policy-v1",
            referenceFixtures: { image: false, video: false },
        });
        expect(preview.items.find((item) => item.caseId === "image-to-video")).toMatchObject({ liveSelected: false, skipReason: "REFERENCE_FIXTURE_UNAVAILABLE" });
        expect(preview.items.find((item) => item.caseId === "text-to-video")?.liveSelected).toBe(true);
    });

    it("requires a distinct verified last-frame asset before admitting first-last-frame", async () => {
        const referenced = model("frames", "0.2268");
        referenced.bindings[0]!.generationParameters = { ...referenced.bindings[0]!.generationParameters!, referenceInputs: ["image"], videoReferenceModes: ["first_frame", "first_last"] };
        const referencedChannel = { ...channel, advancedConfig: { ...channel.advancedConfig!, supportsReferenceImage: true, imageToVideoPath: "/videos/generations" } };
        const preview = await buildVideoValidationPreview({ request, logicalModels: [referenced], channels: [referencedChannel], pricingPolicyVersion: "policy-v1", referenceFixtures: { image: true, lastFrame: false, video: false } });
        expect(preview.items.find((item) => item.caseId === "first-frame")?.skipReason).toBeUndefined();
        expect(preview.items.find((item) => item.caseId === "first-last-frame")?.skipReason).toBe("REFERENCE_FIXTURE_UNAVAILABLE");
    });

    it("rejects a stale preview before creating a run", async () => {
        const initial = await buildVideoValidationPreview({ request, logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" });
        const createRun = vi.fn();
        await expect(
            startVideoValidationRunWithDependencies(
                { ...request, previewRevision: initial.revision },
                { actorId: "admin", loadSnapshot: async () => ({ logicalModels: [model("cheap", "0.56133")], channels: [channel], pricingPolicyVersion: "policy-v1" }), createRun },
            ),
        ).rejects.toMatchObject({ code: "REVISION_CHANGED", status: 409 });
        expect(createRun).not.toHaveBeenCalled();
    });

    it("shows an unchanged passed binding as skipped in preview and run", async () => {
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "1".repeat(64));
        const snapshot = { logicalModels: [model("cheap", "0.2268")], channels: [channel], pricingPolicyVersion: "policy-v1" };
        const first = await buildVideoValidationPreview({ request, ...snapshot });
        const prior = first.items[0]!;
        const latest = new Map([[`${prior.bindingId}:${prior.caseId}`, { fingerprintVersion: 1, fingerprintHash: prior.fingerprintHash!, status: "PASSED" }]]);
        const initial = await buildVideoValidationPreview({ request, ...snapshot, latestVerifications: latest });
        const createRun = vi.fn();
        const result = await startVideoValidationRunWithDependencies(
            { ...request, previewRevision: initial.revision },
            {
                actorId: "admin",
                loadSnapshot: async () => snapshot,
                loadLatestVerifications: async () => latest,
                createRun,
            },
        );
        expect(result.run.status).toBe("completed");
        expect(result.items[0]).toMatchObject({ status: "skipped", reasonCode: "SKIPPED_UNCHANGED", estimatedCostHotxCredits: "0" });
        expect(result.items[0]).not.toHaveProperty("fingerprintSnapshot");
        expect(result.preview.items[0]).not.toHaveProperty("fingerprintSnapshot");
        vi.unstubAllEnvs();
    });
});
