import { describe, expect, it } from "vitest";

import { generationSystemAiUsageContext, usageRecoveryIdentity } from "./generation-usage-context";

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
});
