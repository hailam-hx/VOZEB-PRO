import { describe, expect, it } from "vitest";

import type { LogicalModelBinding, SystemModelChannel } from "@/lib/auth/store-types";
import { probeVideoBinding } from "./video-validation-probe";

const operation = { capability: "video" as const, createPath: "/videos", queryPath: "/videos/:task_id", requestTemplate: "{}", resultField: "video_url", statusField: "status" };
const channel: SystemModelChannel = { id: "channel", name: "DFLOP", baseUrl: "https://api.dflop.top/v1", apiKey: "", hasApiKey: true, apiFormat: "openai", models: ["video"], enabled: true };
const binding: LogicalModelBinding = {
    id: "binding",
    channelId: "channel",
    upstreamModel: "video",
    enabled: true,
    priority: 1,
    generationParameters: { referenceInputs: [], aspectRatios: ["16:9"], pixelSizes: [], supportsCustomSize: false, qualities: [], resolutions: ["720"], durationMode: "discrete", durationSeconds: [5], videoReferenceModes: [], voices: [], formats: [] },
    providerPricingProfile: { provider: "dflop", modelId: "video", status: "READY", syncedAt: "2026-09-26T00:00:00.000Z", raw: {}, dimensions: [], unknownFields: [], missingFields: [], warnings: [] },
    costRateCard: { version: 1, components: [{ id: "seconds", dimension: "durationSeconds", basis: "VIDEO_SECOND", unitPrice: "0.2268", when: { resolution: "720p" } }] },
};

describe("video validation probe", () => {
    it("classifies a complete binding as CONTRACT_READY", () => {
        expect(probeVideoBinding({ binding, channel, operation, credentialAvailable: true, eligible: true })).toMatchObject({ status: "CONTRACT_READY", reasonCode: "READY" });
    });

    it("classifies incomplete capability", () => {
        expect(probeVideoBinding({ binding: { ...binding, generationParameters: undefined }, channel, operation, credentialAvailable: true, eligible: true })).toMatchObject({
            status: "CAPABILITY_INCOMPLETE",
            reasonCode: "GENERATION_PARAMETERS_MISSING",
        });
    });

    it("classifies incomplete pricing", () => {
        expect(probeVideoBinding({ binding: { ...binding, providerPricingProfile: { ...binding.providerPricingProfile!, status: "PARTIAL" } }, channel, operation, credentialAvailable: true, eligible: true })).toMatchObject({
            status: "PRICING_INCOMPLETE",
            reasonCode: "PRICING_NOT_READY",
        });
    });

    it("classifies unavailable authentication without accepting a secret", () => {
        expect(probeVideoBinding({ binding, channel, operation, credentialAvailable: false, eligible: true })).toMatchObject({ status: "AUTH_UNAVAILABLE", reasonCode: "CREDENTIAL_UNAVAILABLE" });
    });

    it("classifies unknown billing review separately", () => {
        expect(
            probeVideoBinding({ binding: { ...binding, providerPricingProfile: { ...binding.providerPricingProfile!, status: "NEEDS_REVIEW", unknownFields: ["mystery_price"] } }, channel, operation, credentialAvailable: true, eligible: true }),
        ).toMatchObject({
            status: "NEEDS_REVIEW",
            reasonCode: "PRICING_NEEDS_REVIEW",
        });
    });
});
