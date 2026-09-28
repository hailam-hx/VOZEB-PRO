import { describe, expect, it } from "vitest";

import type { LogicalModel, LogicalModelBinding, SystemModelChannel } from "@/lib/auth/store-types";
import { normalizeImageQualityProfile, publicLogicalImageQualityProfile } from "@/lib/image-quality-profile";
import { ImageQualityResolutionError, resolveImageQualityForBinding } from "./image-quality-resolver";

const channel: SystemModelChannel = {
    id: "dflop",
    name: "DFLOP",
    baseUrl: "https://api.dflop.top/v1",
    apiKey: "secret",
    apiFormat: "openai",
    models: [],
    enabled: true,
    advancedConfig: {
        protocol: "dflop",
        textModel: "",
        imageModel: "",
        videoModel: "",
        createPath: "/images/generations",
        queryPath: "",
        requestTemplate: "",
        resultField: "",
        statusField: "",
        durationRange: "",
        referenceRule: "",
        supportsReferenceImage: true,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
    },
};
const validation = { status: "VALID" as const, reasons: [], validatedAt: "2026-09-25T00:00:00.000Z" };

function promptProfile() {
    return normalizeImageQualityProfile({
        version: 1,
        controlType: "prompt_flag",
        selectionMode: "explicit",
        source: "provider_preset",
        defaultValue: "standard",
        options: [
            { value: "standard", label: "标准", effect: { type: "prompt_flag", promptSuffix: "--sd", mutexGroup: "midjourney-quality" } },
            { value: "high", label: "高清", effect: { type: "prompt_flag", promptSuffix: "--hd", mutexGroup: "midjourney-quality" } },
        ],
        validation,
    })!;
}

function qwenProfile() {
    return normalizeImageQualityProfile({
        version: 1,
        controlType: "resolution_tier",
        selectionMode: "explicit",
        source: "provider_preset",
        defaultValue: "1k",
        options: [
            { value: "1k", label: "1K", effect: { type: "resolution_tier", resolutionTier: "1k", exactSizes: ["512x512", "1024x1024", "1024x1536", "1536x1024"], sizeByAspectRatio: { "1:1": "1024x1024" } } },
            { value: "2k", label: "2K", effect: { type: "resolution_tier", resolutionTier: "2k", exactSizes: ["1536x1536", "2048x2048", "2560x2560"], sizeByAspectRatio: { "1:1": "2048x2048" } } },
        ],
        validation,
    })!;
}

function seedreamProfile() {
    return normalizeImageQualityProfile({
        version: 1,
        controlType: "pixel_tier",
        selectionMode: "derived",
        source: "structured_upstream",
        options: [
            { value: "normal", label: "标准像素", effect: { type: "pixel_tier", pixelTier: "normal", maxMegapixels: "2.61" } },
            { value: "large", label: "大像素", effect: { type: "pixel_tier", pixelTier: "large", minMegapixels: "2.61" } },
        ],
        validation,
    })!;
}

function fixture(profile = promptProfile(), saleRateCard: LogicalModel["saleRateCard"] = { version: 1, components: [{ id: "image", dimension: "count", basis: "IMAGE_OUTPUT", unitPrice: "1" }] }) {
    const binding: LogicalModelBinding = {
        id: "binding-a",
        channelId: channel.id,
        upstreamModel: "model-a",
        enabled: true,
        priority: 1,
        imageQualityProfile: profile,
        generationParameters: {
            referenceInputs: [],
            aspectRatios: ["1:1", "16:9"],
            pixelSizes: ["1024x1024", "2048x2048", "1536x1536", "2560x2560"],
            supportsCustomSize: profile.controlType === "pixel_tier",
            qualities: [],
            resolutions: [],
            durationSeconds: [],
            videoReferenceModes: [],
            voices: [],
            formats: [],
        },
    };
    const logicalModel: LogicalModel = { id: "logical-image", name: "图片", capability: "image", enabled: true, saleRateCard, bindings: [binding] };
    channel.models = [binding.upstreamModel];
    return { binding, logicalModel };
}

function resolve(profile = promptProfile(), input: Partial<Parameters<typeof resolveImageQualityForBinding>[0]> = {}) {
    const { logicalModel: inputLogicalModel, ...overrides } = input;
    const { binding, logicalModel } = fixture(profile, inputLogicalModel?.saleRateCard);
    const aggregate = publicLogicalImageQualityProfile([{ id: binding.id, imageQualityProfile: profile }])!;
    return resolveImageQualityForBinding({
        logicalModel,
        binding,
        channel,
        userPrompt: "a cat --sd",
        intent: { value: profile.defaultValue, logicalProfileRevision: aggregate?.profileRevision, optionRevision: aggregate?.options.find((option) => option.value === profile.defaultValue)?.optionRevision },
        requestedSize: "1024x1024",
        requestCount: 1,
        ...overrides,
    });
}

describe("resolveImageQualityForBinding", () => {
    it("resolves prompt flags without mutating the public prompt", () => {
        const context = resolve(promptProfile(), { intent: { value: "high" } });
        expect(context).toMatchObject({ selectedQualityValue: "high", resolvedPromptSuffix: "--hd", effectivePrompt: "a cat --hd", requestCount: 1, billableOutputCount: 1 });
    });

    it("uses the provider fixed output count independently of request count", () => {
        const profile = promptProfile();
        const { binding, logicalModel } = fixture(profile);
        binding.providerPricingProfile = {
            provider: "dflop",
            modelId: binding.upstreamModel,
            status: "READY",
            syncedAt: "2026-09-25T00:00:00.000Z",
            dimensions: [],
            unknownFields: [],
            missingFields: [],
            warnings: [],
            raw: {},
            metadata: { imagesPerRequest: 4 },
        };
        const context = resolveImageQualityForBinding({ logicalModel, binding, channel, userPrompt: "cat", intent: { value: "standard" }, requestCount: 1 });
        expect(context).toMatchObject({ requestCount: 1, billableOutputCount: 4 });
    });

    it.each([
        ["1k", "1024x1024", "1k"],
        ["2k", "2048x2048", "2k"],
    ])("resolves supported Qwen %s exact sizes", (value, size, tier) => {
        const profile = qwenProfile();
        expect(resolve(profile, { intent: { value }, requestedSize: size })).toMatchObject({
            resolvedSize: size,
            resolvedResolutionTier: tier,
            optionRevision: profile.options.find((option) => option.value === value)?.optionRevision,
        });
    });

    it("uses only an explicit ratio mapping and never guesses Qwen sizes", () => {
        expect(resolve(qwenProfile(), { intent: { value: "2k" }, requestedSize: undefined, requestedAspectRatio: "1:1" }).resolvedSize).toBe("2048x2048");
        expect(() => resolve(qwenProfile(), { intent: { value: "2k" }, requestedSize: undefined, requestedAspectRatio: "16:9" })).toThrowError(expect.objectContaining({ code: "QUALITY_OPTION_UNAVAILABLE" }));
    });

    it("accepts an exact-size sale condition for a normalized Qwen resolution tier", () => {
        const saleRateCard = { version: 1 as const, components: [{ id: "exact", dimension: "count" as const, basis: "IMAGE_OUTPUT" as const, unitPrice: "1", when: { resolution: "1024x1024" } }] };
        expect(resolve(qwenProfile(), { intent: { value: "1k" }, requestedSize: undefined, requestedAspectRatio: "1:1", logicalModel: { saleRateCard } as LogicalModel })).toMatchObject({
            resolvedSize: "1024x1024",
            resolvedResolutionTier: "1k",
        });
    });

    it("rejects forged Qwen sizes outside the selected tier", () => {
        expect(() => resolve(qwenProfile(), { intent: { value: "1k" }, requestedSize: "2048x2048" })).toThrowError(expect.objectContaining({ code: "QUALITY_OPTION_UNAVAILABLE" }));
    });

    it.each([
        ["1000x1000", "normal"],
        ["2610x1000", "normal"],
        ["2611x1000", "large"],
    ])("derives Seedream %s as %s from the official threshold", (size, expectedTier) => {
        const rateCard = {
            version: 1 as const,
            components: [
                { id: "normal", dimension: "count" as const, basis: "IMAGE_OUTPUT" as const, unitPrice: "1", when: { megapixelTier: "normal" }, megapixelThreshold: "2.61" },
                { id: "large", dimension: "count" as const, basis: "IMAGE_LARGE" as const, unitPrice: "2", when: { megapixelTier: "large" }, megapixelThreshold: "2.61" },
            ],
        };
        const { binding, logicalModel } = fixture(seedreamProfile(), rateCard);
        expect(resolveImageQualityForBinding({ logicalModel, binding, channel, userPrompt: "cat", intent: {}, requestedSize: size, requestCount: 1 })).toMatchObject({ resolvedPixelTier: expectedTier, resolvedSize: size });
    });

    it("requires exact dimensions for derived pixel tiers and ignores a client tier", () => {
        const rateCard = { version: 1 as const, components: [{ id: "normal", dimension: "count" as const, basis: "IMAGE_OUTPUT" as const, unitPrice: "1", when: { megapixelTier: "normal" }, megapixelThreshold: "2.61" }] };
        const { binding, logicalModel } = fixture(seedreamProfile(), rateCard);
        expect(() => resolveImageQualityForBinding({ logicalModel, binding, channel, userPrompt: "cat", intent: { value: "large" }, requestedAspectRatio: "1:1" })).toThrowError(expect.objectContaining({ code: "QUALITY_CONTEXT_UNRESOLVABLE" }));
    });

    it("rejects blocking manual validation", () => {
        const profile = normalizeImageQualityProfile({
            ...promptProfile(),
            source: "manual",
            validation: { status: "DRIFT", reasons: [{ code: "UPSTREAM_SIZE_REMOVED", message: "尺寸已失效", severity: "blocking" }], validatedAt: "2026-09-25T00:00:00.000Z" },
        })!;
        expect(() => resolve(profile)).toThrowError(expect.objectContaining({ code: "QUALITY_CONTEXT_UNRESOLVABLE" }));
    });

    it("rejects removed and semantically changed options but preserves unchanged options", () => {
        const profile = promptProfile();
        const aggregate = publicLogicalImageQualityProfile([{ id: "binding-a", imageQualityProfile: profile }])!;
        const { binding, logicalModel } = fixture(profile);
        expect(() => resolveImageQualityForBinding({ logicalModel, binding, channel, userPrompt: "cat", intent: { value: "missing", logicalProfileRevision: "old", optionRevision: "old" } })).toThrowError(
            expect.objectContaining({ code: "QUALITY_OPTION_UNAVAILABLE" }),
        );
        expect(() => resolveImageQualityForBinding({ logicalModel, binding, channel, userPrompt: "cat", intent: { value: "high", logicalProfileRevision: "old", optionRevision: "changed" } })).toThrowError(
            expect.objectContaining({ code: "QUALITY_PROFILE_CHANGED" }),
        );
        const current = aggregate.options.find((option) => option.value === "high")!;
        expect(resolveImageQualityForBinding({ logicalModel, binding, channel, userPrompt: "cat", intent: { value: "high", logicalProfileRevision: "old", optionRevision: current.optionRevision } }).selectedQualityValue).toBe("high");
    });

    it("does not allow model variants to cross logical model boundaries", () => {
        const profile = normalizeImageQualityProfile({
            version: 1,
            controlType: "model_variant",
            selectionMode: "explicit",
            source: "manual",
            options: [{ value: "high", label: "高清", effect: { type: "model_variant", targetBindingId: "other-binding" } }],
            validation,
        })!;
        expect(() => resolve(profile, { intent: { value: "high" } })).toThrowError(expect.objectContaining({ code: "QUALITY_TARGET_BINDING_INVALID" }));
    });

    it("exposes typed domain error metadata", () => {
        const error = new ImageQualityResolutionError("QUALITY_PROFILE_CHANGED", "画质配置已更新", "current-revision", 409);
        expect(error).toMatchObject({ code: "QUALITY_PROFILE_CHANGED", currentProfileRevision: "current-revision", status: 409 });
    });
});
