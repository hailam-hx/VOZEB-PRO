import { describe, expect, it } from "vitest";

import { parseDflopPricing } from "../dflop-pricing";
import { applyCapabilityProbeToPricingProfile, capabilityProbeFingerprint, capabilityProbeStillApplies, reapplyStoredCapabilityProbe, type CapabilityProbeResult } from "./provider-capability-probe";
import { DEFAULT_SYSTEM_PRICING_POLICY } from "./pricing-policy";
import { applyProviderPricingConversion, providerPricingProfileToCostRateCard } from "./provider-pricing";

const syncedAt = "2026-09-24T00:00:00.000Z";

function gptProfile(modelId = "gpt-6") {
    return parseDflopPricing(
        { input_per_1m: "4044", cached_input_per_1m: "404.4", output_per_1m: "20220", price_per_image: "80.88", supports_image_gen: true, supported_protocols: ["openai_chat", "openai_responses"] },
        { modelId, category: "text", endpointType: null, syncedAt },
    );
}

function qwenProfile() {
    return parseDflopPricing({ price_per_image: "15", price_per_image_large: "30", price_per_input_image: "1.2", endpoint_type: "images_generations" }, { modelId: "qwen-image-3.0-pro", category: "image", endpointType: "images_generations", syncedAt });
}

function probe(modelId: string, outcome: CapabilityProbeResult["outcome"], billingBasis: CapabilityProbeResult["billingEvidence"]["basis"] = "unresolved"): CapabilityProbeResult {
    return {
        version: 1,
        provider: "dflop",
        modelId,
        channelId: "dflop",
        bindingId: `dflop:${modelId}`,
        operationScope: "builtin_image_generation",
        endpoint: "/v1/responses",
        outcome,
        supported: outcome !== "unsupported",
        statusCode: outcome === "unsupported" ? 400 : 200,
        ...(outcome === "unsupported" ? { upstreamErrorCode: "tool_not_supported" } : {}),
        usageSeen: outcome !== "unsupported",
        imageOutputSeen: outcome !== "unsupported",
        billingEvidence: { basis: billingBasis, authoritative: billingBasis !== "unresolved", source: billingBasis === "unresolved" ? "none" : "response_usage" },
        probedAt: "2026-09-24T01:00:00.000Z",
        registryFingerprint: capabilityProbeFingerprint(gptProfile(modelId)),
    };
}

describe("provider capability probe", () => {
    it("marks tool_not_supported as an operation-level unsupported result without blocking text pricing", () => {
        const applied = applyCapabilityProbeToPricingProfile(gptProfile(), probe("gpt-6", "unsupported"));
        const converted = applyProviderPricingConversion(applied, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T01:00:01.000Z");

        expect(converted.status).toBe("READY");
        expect(converted.operationPricingStatus).toMatchObject({ text_generation: { status: "READY" }, builtin_image_generation: { status: "UNSUPPORTED", reasons: ["TOOL_NOT_SUPPORTED"] } });
        expect(converted.raw.price_per_image).toBe("80.88");
        expect(converted.metadata).toMatchObject({ unscopedProviderPrices: { price_per_image: "80.88" }, capabilityProbes: { builtin_image_generation: { upstreamErrorCode: "tool_not_supported" } } });
        expect(providerPricingProfileToCostRateCard(converted)?.components.some((component) => component.operationScope === "builtin_image_generation")).toBe(false);
    });

    it("keeps a supported operation partial when the probe cannot establish its billing basis", () => {
        const applied = applyCapabilityProbeToPricingProfile(gptProfile(), probe("gpt-6", "supported", "unresolved"));
        const converted = applyProviderPricingConversion(applied, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T01:00:01.000Z");

        expect(converted.status).toBe("PARTIAL");
        expect(converted.operationPricingStatus?.builtin_image_generation).toEqual({ status: "PARTIAL", reasons: ["AMBIGUOUS_BILLING_AFTER_CAPABILITY_PROBE"] });
    });

    it("duplicates token components into the built-in image scope only when token-only billing is authoritative", () => {
        const applied = applyCapabilityProbeToPricingProfile(gptProfile(), probe("gpt-6", "supported", "token_only"));
        const converted = applyProviderPricingConversion(applied, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T01:00:01.000Z");
        const components = providerPricingProfileToCostRateCard(converted)!.components;

        expect(converted.status).toBe("READY");
        expect(converted.operationPricingStatus?.builtin_image_generation).toEqual({ status: "READY", reasons: [] });
        expect(components.filter((component) => component.operationScope === "text_generation")).toHaveLength(3);
        expect(components.filter((component) => component.operationScope === "builtin_image_generation")).toHaveLength(3);
        expect(components.some((component) => component.basis === "IMAGE_OUTPUT")).toBe(false);
    });

    it("projects token and per-image components into one built-in image operation only with additive billing evidence", () => {
        const applied = applyCapabilityProbeToPricingProfile(gptProfile(), probe("gpt-6", "supported", "token_plus_image"));
        const converted = applyProviderPricingConversion(applied, DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T01:00:01.000Z");
        const builtIn = providerPricingProfileToCostRateCard(converted)!.components.filter((component) => component.operationScope === "builtin_image_generation");

        expect(converted.status).toBe("READY");
        expect(builtIn.filter((component) => component.basis?.startsWith("TOKEN_"))).toHaveLength(3);
        expect(builtIn).toContainEqual(expect.objectContaining({ basis: "IMAGE_OUTPUT", unitPrice: "0.2022" }));
    });

    it("keeps GPT-6 and Astra evidence independent", () => {
        expect(() => applyCapabilityProbeToPricingProfile(gptProfile("gpt-6-astra"), probe("gpt-6", "unsupported"))).toThrow("探测结果模型不匹配");
    });

    it("invalidates saved evidence when the registry capability fingerprint changes", () => {
        const profile = gptProfile();
        const result = probe("gpt-6", "unsupported");

        expect(capabilityProbeStillApplies(result, profile)).toBe(true);
        expect(capabilityProbeStillApplies(result, { ...profile, raw: { ...profile.raw, supports_image_gen: false } })).toBe(false);
    });

    it("keeps Qwen partial with an authoritative-mapping reason when pixels alone do not prove billing tier", () => {
        const result: CapabilityProbeResult = {
            ...probe("qwen-image-3.0-pro", "supported"),
            operationScope: "standalone_image_generation",
            endpoint: "/v1/images/generations",
            registryFingerprint: capabilityProbeFingerprint(qwenProfile()),
            billingEvidence: { basis: "unresolved", authoritative: false, source: "none" },
            cases: [{ requestSize: "1024x1024", actualWidth: 1024, actualHeight: 1024, billingAmount: null }],
        };
        const converted = applyProviderPricingConversion(applyCapabilityProbeToPricingProfile(qwenProfile(), result), DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T01:00:01.000Z");

        expect(converted.status).toBe("PARTIAL");
        expect(converted.operationPricingStatus?.standalone_image_generation).toEqual({ status: "PARTIAL", reasons: ["MISSING_AUTHORITATIVE_SIZE_TIER_MAPPING"] });
        expect(converted.warnings).toContainEqual(expect.objectContaining({ code: "MISSING_AUTHORITATIVE_SIZE_TIER_MAPPING" }));
    });

    it("creates only exact audited Qwen size mappings when provider billing evidence is authoritative", () => {
        const result: CapabilityProbeResult = {
            ...probe("qwen-image-3.0-pro", "supported", "size_tier"),
            operationScope: "standalone_image_generation",
            endpoint: "/v1/images/generations",
            registryFingerprint: capabilityProbeFingerprint(qwenProfile()),
            billingEvidence: {
                basis: "size_tier",
                authoritative: true,
                source: "provider_task_record",
                sizeTierByRequestSize: { "512x512": "1K", "1024x1024": "1K", "1536x1536": "2K" },
            },
            cases: [
                { requestSize: "512x512", billingAmount: "15", providerUsageRecordId: "usage-1" },
                { requestSize: "1024x1024", billingAmount: "15", providerUsageRecordId: "usage-2" },
                { requestSize: "1536x1536", billingAmount: "30", providerUsageRecordId: "usage-3" },
            ],
        };
        const converted = applyProviderPricingConversion(applyCapabilityProbeToPricingProfile(qwenProfile(), result), DEFAULT_SYSTEM_PRICING_POLICY, "2026-09-24T01:00:01.000Z");
        const card = providerPricingProfileToCostRateCard(converted)!;

        expect(converted.status).toBe("READY");
        expect(converted.operationPricingStatus?.standalone_image_generation).toEqual({ status: "READY", reasons: [] });
        expect(card.components.filter((component) => component.basis === "IMAGE_OUTPUT" || component.basis === "IMAGE_LARGE")).toEqual([
            expect.objectContaining({ basis: "IMAGE_OUTPUT", when: { resolution: "512x512" } }),
            expect.objectContaining({ basis: "IMAGE_OUTPUT", when: { resolution: "1024x1024" } }),
            expect.objectContaining({ basis: "IMAGE_LARGE", when: { resolution: "1536x1536" } }),
        ]);
        expect(card.components).toContainEqual(expect.objectContaining({ basis: "IMAGE_INPUT", freeQuantity: "0" }));
    });

    it("does not mark exact Qwen probe dimensions stale when normalizing persisted settings", () => {
        const profile = qwenProfile();
        const result: CapabilityProbeResult = {
            ...probe("qwen-image-3.0-pro", "supported", "size_tier"),
            operationScope: "standalone_image_generation",
            endpoint: "/v1/images/generations",
            registryFingerprint: capabilityProbeFingerprint(profile),
            billingEvidence: {
                basis: "size_tier",
                authoritative: true,
                source: "provider_task_record",
                sizeTierByRequestSize: { "512x512": "1K", "2048x2048": "2K" },
            },
        };
        const applied = applyCapabilityProbeToPricingProfile(profile, result);
        const persisted = {
            ...applied,
            status: "STALE" as const,
            missingFields: ["image-output:resolution=512x512", "image-large:resolution=2048x2048"],
            warnings: [...applied.warnings, { code: "MISSING_UPSTREAM_VALUE" as const, field: "image-output:resolution=512x512", message: "stale" }, { code: "MISSING_UPSTREAM_VALUE" as const, field: "image-large:resolution=2048x2048", message: "stale" }],
        };

        const normalized = reapplyStoredCapabilityProbe(persisted);

        expect(normalized.status).toBe("READY");
        expect(normalized.missingFields).toEqual([]);
        expect(normalized.warnings.some((warning) => warning.code === "MISSING_UPSTREAM_VALUE")).toBe(false);
    });
});
