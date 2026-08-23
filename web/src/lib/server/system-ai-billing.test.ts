import { describe, expect, it } from "vitest";

import {
    hasSystemAiCharge,
    readSystemAiBilling,
    readSystemAiUsageBilling,
    readVerifiedSystemAiBusinessRequestId,
    readVerifiedSystemAiUsageContext,
    systemAiBillingHeaders,
    systemAiIdempotencyKey,
    systemAiPointsIdempotencyKey,
    systemAiRequestFingerprint,
    systemAiUsageRequestFingerprint,
    systemAiUsageResponseHeaders,
} from "./system-ai-billing";

describe("system AI billing helpers", () => {
    it("preserves a zero-cost consumption record so its quota can be refunded", () => {
        const billing = readSystemAiBilling(new Headers({ "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "points-free-text" }));

        expect(billing).toEqual({ pointsCost: 0, pointsRecordId: "points-free-text" });
        expect(hasSystemAiCharge(billing)).toBe(true);
    });

    it("creates stable scoped idempotency headers without exposing source identifiers", () => {
        const first = systemAiIdempotencyKey("workbench-plan", "user-one", "request-one", "image", "channel-one");
        const second = systemAiIdempotencyKey("workbench-plan", "user-one", "request-one", "image", "channel-one");
        const headers = new Headers(systemAiBillingHeaders("planner", first, "vendor-text"));

        expect(first).toBe(second);
        expect(first).toMatch(/^workbench-plan:[a-f0-9]{32}$/);
        expect(headers.get("x-vozeb-pro-logical-model")).toBe("planner");
        expect(headers.get("x-vozeb-pro-points-idempotency-key")).toBe(first);
        expect(headers.get("x-vozeb-pro-points-signature")).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(readVerifiedSystemAiBusinessRequestId(headers, "planner", "vendor-text")).toBe(first);

        headers.set("x-vozeb-pro-points-idempotency-key", `${first}:forged`);
        expect(readVerifiedSystemAiBusinessRequestId(headers, "planner", "vendor-text")).toBeUndefined();
    });

    it("binds the local billing key and request fingerprint to separate identities", () => {
        const identity = { userId: "user-one", businessRequestId: "task-one", logicalModel: "writer", channelId: "channel-one", upstreamModel: "vendor-text", callType: "text:create:/chat/completions" };
        const firstKey = systemAiPointsIdempotencyKey(identity);
        const secondKey = systemAiPointsIdempotencyKey(identity);
        const firstFingerprint = systemAiRequestFingerprint({
            method: "POST",
            callType: identity.callType,
            logicalModel: identity.logicalModel,
            channelId: identity.channelId,
            upstreamModel: identity.upstreamModel,
            usageKind: "text",
            amount: 1,
            bodyDigest: "a".repeat(64),
        });
        const secondFingerprint = systemAiRequestFingerprint({
            method: "POST",
            callType: identity.callType,
            logicalModel: identity.logicalModel,
            channelId: identity.channelId,
            upstreamModel: identity.upstreamModel,
            usageKind: "text",
            amount: 1,
            bodyDigest: "b".repeat(64),
        });

        expect(firstKey).toBe(secondKey);
        expect(firstKey).toMatch(/^system-ai:[a-f0-9]{64}$/);
        expect(firstFingerprint).not.toBe(secondFingerprint);
    });

    it("signs stable usage and provider-attempt identities as one internal contract", () => {
        const headers = new Headers(
            systemAiBillingHeaders(
                "writer",
                {
                    businessRequestId: "text-task:one",
                    requestFingerprint: "a".repeat(64),
                    attemptNumber: 2,
                    bindingId: "writer-backup",
                    providerIdempotencySupported: true,
                    providerIdempotencyKey: "text-task:one:attempt:2",
                },
                "vendor-text",
            ),
        );

        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text")).toEqual({
            businessRequestId: "text-task:one",
            requestFingerprint: "a".repeat(64),
            attemptNumber: 2,
            bindingId: "writer-backup",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "text-task:one:attempt:2",
        });

        headers.set("x-vozeb-pro-billing-attempt-number", "3");
        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text")).toBeUndefined();
    });

    it("round-trips the server-owned hold and attempt response identity", () => {
        const fingerprint = systemAiUsageRequestFingerprint({ userId: "user", businessRequestId: "task", logicalModel: "writer", capability: "text", payload: { prompt: "hello", maxTokens: 10 } });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: "hold-one", attemptNumber: 2, requestFingerprint: fingerprint }));

        expect(readSystemAiUsageBilling(headers)).toEqual({ holdId: "hold-one", attemptNumber: 2, requestFingerprint: fingerprint });
    });
});
