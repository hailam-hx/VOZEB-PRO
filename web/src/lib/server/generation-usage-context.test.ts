import { describe, expect, it } from "vitest";

import { generationSystemAiUsageContext, systemAiTextUsageContext, usageRecoveryIdentity } from "./generation-usage-context";

const config = { logicalModel: "image-pro", model: "vendor-image", channelId: "channel-backup", capabilityProfile: { supportsIdempotency: true }, usagePricing: { logicalModelId: "image-pro", bindingId: "binding-backup" } };

describe("generation usage context", () => {
    it("keeps one business identity across failover attempts and snapshots each attempt", () => {
        const first = generationSystemAiUsageContext(config, "image", "image-task:task-one:attempt:1", "user-one");
        const second = generationSystemAiUsageContext(config, "image", "image-task:task-one:attempt:2", "user-one");

        expect(first).toMatchObject({
            userId: "user-one",
            channelId: "channel-backup",
            capability: "image",
            businessRequestId: "image-task:task-one",
            attemptNumber: 1,
            bindingId: "binding-backup",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "image-task:task-one:attempt:1",
        });
        expect(second).toMatchObject({ businessRequestId: "image-task:task-one", attemptNumber: 2, requestFingerprint: first?.requestFingerprint });
    });

    it("derives only known stable task identities for recovery", () => {
        expect(usageRecoveryIdentity("video-task:video-one")).toEqual({ taskType: "video", taskId: "video-one" });
        expect(usageRecoveryIdentity("unknown:one")).toBeUndefined();
    });

    it("creates a fully priced text attempt draft for non-task system AI calls", () => {
        const context = systemAiTextUsageContext({
            candidate: { channelId: "text-channel", upstreamModel: "vendor-text", binding: { id: "binding-text" }, capabilityProfile: { supportsIdempotency: true } },
            userId: "user-one",
            logicalModelId: "logical-text",
            businessRequestId: "prompt-optimize:one",
            requestFingerprint: "a".repeat(64),
            attemptNumber: 2,
        });

        expect(context).toMatchObject({
            userId: "user-one",
            channelId: "text-channel",
            capability: "text",
            businessRequestId: "prompt-optimize:one",
            requestFingerprint: "a".repeat(64),
            attemptNumber: 2,
            bindingId: "binding-text",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "prompt-optimize:one:attempt:2:text-channel:vendor-text",
        });
    });
});
