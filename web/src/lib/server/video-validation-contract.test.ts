import { describe, expect, it } from "vitest";

import { buildVideoContractCases, describeVideoContract, validateStaticVideoContract, videoContractFamilyFingerprint } from "./video-validation-contract";

const operation = {
    createPath: "/videos/generations",
    imageToVideoPath: "/videos/generations",
    queryPath: "/videos/generations/:task_id",
    cancelPath: "/videos/generations/:task_id/cancel",
    requestTemplate: '{"model":"{{model}}","content":"{{content}}","duration":"{{duration}}"}',
    resultField: "content.video_url",
    statusField: "status",
    supportsReferenceImage: true,
    supportsReferenceVideo: false,
    supportsReferenceAudio: false,
};

const profile = {
    referenceInputs: ["image" as const],
    aspectRatios: ["16:9"],
    pixelSizes: [],
    supportsCustomSize: false,
    qualities: [],
    resolutions: ["720"],
    durationMode: "discrete" as const,
    durationSeconds: [5],
    videoReferenceModes: ["reference" as const, "first_frame" as const, "first_last" as const],
    voices: [],
    formats: [],
};

function descriptor(overrides: Record<string, unknown> = {}) {
    return describeVideoContract({
        protocol: "dflop",
        modelId: "seedance-one",
        modelLabel: "Seedance One",
        operation,
        generationParameters: profile,
        billingBases: ["VIDEO_SECOND"],
        runtimeOptions: { watermark: false, generateAudio: false },
        ...overrides,
    });
}

describe("video validation contract", () => {
    it("groups identical execution-query-pricing contracts", () => {
        const first = descriptor();
        const renamed = descriptor({ modelId: "renamed", modelLabel: "Renamed" });
        expect(videoContractFamilyFingerprint(first)).toBe(videoContractFamilyFingerprint(renamed));
    });

    it("separates reference contracts", () => {
        const first = descriptor();
        const second = descriptor({ generationParameters: { ...profile, videoReferenceModes: ["reference"] } });
        expect(videoContractFamilyFingerprint(first)).not.toBe(videoContractFamilyFingerprint(second));
    });

    it("separates billing bases", () => {
        expect(videoContractFamilyFingerprint(descriptor({ billingBases: ["VIDEO_SECOND"] }))).not.toBe(videoContractFamilyFingerprint(descriptor({ billingBases: ["VIDEO_TOKEN"] })));
    });

    it("is stable across object key order", () => {
        expect(videoContractFamilyFingerprint(descriptor({ runtimeOptions: { watermark: false, generateAudio: false } }))).toBe(videoContractFamilyFingerprint(descriptor({ runtimeOptions: { generateAudio: false, watermark: false } })));
    });

    it("changes when an execution contract field changes", () => {
        const first = descriptor();
        for (const changed of [
            descriptor({ operation: { ...operation, createPath: "/other" } }),
            descriptor({ operation: { ...operation, requestTemplate: '{"prompt":"{{prompt}}"}' } }),
            descriptor({ operation: { ...operation, resultField: "video_url" } }),
            descriptor({ runtimeOptions: { watermark: false, seed: -1 } }),
        ]) {
            expect(videoContractFamilyFingerprint(first)).not.toBe(videoContractFamilyFingerprint(changed));
        }
    });

    it("builds only applicable contract cases", () => {
        const cases = buildVideoContractCases({ operation, generationParameters: profile, runtimeOptions: { watermark: false } });
        expect(cases.filter((item) => item.applicability === "APPLICABLE").map((item) => item.id)).toEqual(
            expect.arrayContaining([
                "text-to-video",
                "image-to-video",
                "first-frame",
                "first-last-frame",
                "resolution",
                "duration",
                "ratio",
                "watermark",
                "bearer-auth",
                "idempotency",
                "cancel",
                "error-400",
                "error-402",
                "error-429",
                "error-503",
                "timeout",
                "submission-uncertain",
            ]),
        );
        expect(cases.find((item) => item.id === "audio")).toMatchObject({ applicability: "NOT_APPLICABLE" });
    });

    it("does not advertise image-to-video when the binding lacks the reference mode", () => {
        const cases = buildVideoContractCases({
            operation,
            generationParameters: { ...profile, videoReferenceModes: [] },
        });
        expect(cases.find((item) => item.id === "image-to-video")).toMatchObject({ applicability: "NOT_APPLICABLE" });
    });

    it("reports incomplete static contracts without throwing", () => {
        expect(validateStaticVideoContract({ operation: { ...operation, queryPath: "" }, generationParameters: profile })).toEqual({
            status: "FAILED",
            reasons: ["QUERY_PATH_MISSING"],
        });
    });
});
