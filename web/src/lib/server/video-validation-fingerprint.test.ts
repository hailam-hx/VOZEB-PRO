import { describe, expect, it } from "vitest";

import { buildValidationExecutionSnapshot, buildVideoCanaryContractFingerprint, buildVideoValidationFingerprint } from "./video-validation-fingerprint";

const contract = {
    provider: "dflop",
    endpointType: "video_generation",
    endpoints: { create: "/videos/generations", query: "/videos/generations/:task_id" },
    protocol: { protocolId: "dflop", requestSchemaVersion: "request-v1", parserVersion: "parser-v1" },
    capabilityProfile: { generationParameters: { resolutions: ["720p", "480p"], durationSeconds: [10, 5] }, executionOptions: { watermark: false }, referenceContract: { modes: ["first_frame", "reference"] } },
    billing: { billingBasis: ["VIDEO_SECOND"], pricingRevision: "price-v1", normalizationRevision: "usage-v1", conversionRevision: "fx-v1", actualCostCapabilityRevision: "actual-v1" },
    runtime: { relevantConfigRevision: "channel-v1", credentialRevision: "credential-v1", idempotencyReplayContractRevision: "replay-v1" },
};

describe("video validation fingerprint", () => {
    it("shares a canary contract across model identity, price and capability values", () => {
        const first = buildVideoCanaryContractFingerprint({
            executionFingerprint: buildVideoValidationFingerprint(contract),
            caseId: "text-to-video",
            pricingComponents: [{ basis: "VIDEO_SECOND", dimension: "durationSeconds", when: { resolution: "720p" }, operationScope: "video_generation" }],
            usageAlgorithm: "per-second",
        });
        const second = buildVideoCanaryContractFingerprint({
            executionFingerprint: buildVideoValidationFingerprint({
                ...contract,
                capabilityProfile: { ...contract.capabilityProfile, generationParameters: { resolutions: ["1080p"], durationSeconds: [4] } },
                billing: { ...contract.billing, pricingRevision: "different-price", conversionRevision: "different-fx" },
                runtime: { ...contract.runtime, relevantConfigRevision: "different-model-and-base-url", credentialRevision: "different-key" },
            }),
            caseId: "text-to-video",
            pricingComponents: [{ basis: "VIDEO_SECOND", dimension: "durationSeconds", when: { resolution: "1080p" }, operationScope: "video_generation" }],
            usageAlgorithm: "per-second",
        });
        expect(first.hash).toBe(second.hash);
        expect(first.version).toBe(1);
    });

    it("separates request modes, endpoints, parsers and billing shapes", () => {
        const input: Parameters<typeof buildVideoCanaryContractFingerprint>[0] = {
            executionFingerprint: buildVideoValidationFingerprint(contract),
            caseId: "text-to-video",
            pricingComponents: [{ basis: "VIDEO_SECOND", dimension: "durationSeconds" }],
            usageAlgorithm: "per-second",
        };
        const base = buildVideoCanaryContractFingerprint(input).hash;
        for (const mode of ["image-to-video", "first-frame", "first-last-frame", "video-edit", "reference-video", "audio", "multi-step-workflow"]) expect(buildVideoCanaryContractFingerprint({ ...input, caseId: mode }).hash).not.toBe(base);
        expect(buildVideoCanaryContractFingerprint({ ...input, usageAlgorithm: "seedance-2.5-token" }).hash).not.toBe(base);
        expect(buildVideoCanaryContractFingerprint({ ...input, pricingComponents: [{ basis: "VIDEO_TOKEN", dimension: "outputTokens" }] }).hash).not.toBe(base);
        for (const changed of [
            { ...contract, endpoints: { ...contract.endpoints, create: "/other" } },
            { ...contract, protocol: { ...contract.protocol, parserVersion: "parser-v2" } },
        ])
            expect(buildVideoCanaryContractFingerprint({ ...input, executionFingerprint: buildVideoValidationFingerprint(changed) }).hash).not.toBe(base);
    });
    it("canonicalizes object keys and set-valued capability arrays", () => {
        const first = buildVideoValidationFingerprint(contract);
        const second = buildVideoValidationFingerprint({
            ...contract,
            capabilityProfile: {
                ...contract.capabilityProfile,
                generationParameters: { durationSeconds: [5, 10], resolutions: ["480p", "720p", "480p"] },
                referenceContract: { modes: ["reference", "first_frame"] },
            },
        });
        expect(first.fingerprintHash).toBe(second.fingerprintHash);
        expect(first).toMatchObject({ fingerprintVersion: 1, fingerprintHashAlgorithm: "sha256" });
    });

    it("changes for every execution, billing and replay contract dimension", () => {
        const base = buildVideoValidationFingerprint(contract).fingerprintHash;
        const changes = [
            { ...contract, provider: "other" },
            { ...contract, endpointType: "other" },
            { ...contract, endpoints: { ...contract.endpoints, query: "/other" } },
            { ...contract, protocol: { ...contract.protocol, requestSchemaVersion: "request-v2" } },
            { ...contract, protocol: { ...contract.protocol, parserVersion: "parser-v2" } },
            { ...contract, capabilityProfile: { ...contract.capabilityProfile, executionOptions: { watermark: true } } },
            { ...contract, billing: { ...contract.billing, pricingRevision: "price-v2" } },
            { ...contract, billing: { ...contract.billing, conversionRevision: "fx-v2" } },
            { ...contract, runtime: { ...contract.runtime, idempotencyReplayContractRevision: "replay-v2" } },
        ];
        for (const changed of changes) expect(buildVideoValidationFingerprint(changed).fingerprintHash).not.toBe(base);
    });

    it("binds reserve and submit to the same request identity", () => {
        const fingerprint = buildVideoValidationFingerprint(contract);
        const input = {
            fingerprint,
            bindingId: "binding-a",
            channelId: "channel-a",
            normalizedContext: { durationSeconds: "5", resolution: "480p" },
            pricingRevision: "price-v1",
            conversionRevision: "fx-v1",
            requestPayloadDigest: "payload-a",
            idempotencyKey: "validation:run:item",
        };
        const snapshot = buildValidationExecutionSnapshot(input);
        expect(buildValidationExecutionSnapshot(input).hash).toBe(snapshot.hash);
        for (const changed of [
            { ...input, bindingId: "binding-b" },
            { ...input, requestPayloadDigest: "payload-b" },
            { ...input, idempotencyKey: "different" },
            { ...input, normalizedContext: { ...input.normalizedContext, durationSeconds: "10" } },
        ])
            expect(buildValidationExecutionSnapshot(changed).hash).not.toBe(snapshot.hash);
    });
});
