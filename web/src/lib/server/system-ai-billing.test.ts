import { describe, expect, it } from "vitest";

import {
    hasSystemAiCharge,
    readSystemAiBilling,
    readSystemAiUsageBilling,
    readVerifiedSystemAiBusinessRequestId,
    readVerifiedSystemAiUsageContext,
    finalizeSystemAiUsageRequestHeaders,
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
        const requestBinding = { userId: "user-one", channelId: "channel-one", capability: "text" as const, method: "POST", canonicalPath: "/api/ai/system/channel-one/chat/completions", canonicalQuery: "region=us&mode=fast", bodyDigest: "b".repeat(64) };
        const expiresAtMs = Date.now() + 60_000;
        const headers = new Headers(
            systemAiBillingHeaders(
                "writer",
                {
                    ...requestBinding,
                    expiresAtMs,
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

        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", requestBinding)).toEqual({
            ...requestBinding,
            expiresAtMs,
            businessRequestId: "text-task:one",
            requestFingerprint: "a".repeat(64),
            attemptNumber: 2,
            bindingId: "writer-backup",
            providerIdempotencySupported: true,
            providerIdempotencyKey: "text-task:one:attempt:2",
        });

        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", { ...requestBinding, userId: "user-two" })).toBeUndefined();
        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", { ...requestBinding, canonicalPath: "/api/ai/system/channel-one/responses" })).toBeUndefined();
        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", { ...requestBinding, canonicalQuery: "region=eu&mode=fast" })).toBeUndefined();
        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", { ...requestBinding, bodyDigest: "c".repeat(64) })).toBeUndefined();

        headers.set("x-vozeb-pro-billing-attempt-number", "3");
        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", requestBinding)).toBeUndefined();
    });

    it("signs and round-trips trusted reference-video billing metadata", () => {
        const requestBinding = { userId: "user-one", channelId: "channel-one", capability: "video" as const, method: "POST", canonicalPath: "/api/ai/system/channel-one/videos/generations", canonicalQuery: "", bodyDigest: "b".repeat(64) };
        const videoBillingContext = { hasReferenceVideo: true, verifiedInputVideoDurationSeconds: "12.345", referenceVideoDurationSource: "server-probed" as const };
        const headers = new Headers(
            systemAiBillingHeaders(
                "seedance",
                {
                    ...requestBinding,
                    expiresAtMs: Date.now() + 60_000,
                    businessRequestId: "video-task:one",
                    requestFingerprint: "a".repeat(64),
                    attemptNumber: 1,
                    bindingId: "binding-one",
                    providerIdempotencySupported: false,
                    videoBillingContext,
                },
                "doubao-seedance-2.0-pro",
            ),
        );

        expect(readVerifiedSystemAiUsageContext(headers, "seedance", "doubao-seedance-2.0-pro", requestBinding)?.videoBillingContext).toEqual(videoBillingContext);
        headers.set("x-vozeb-pro-video-billing-context", JSON.stringify({ ...videoBillingContext, verifiedInputVideoDurationSeconds: "1" }));
        expect(readVerifiedSystemAiUsageContext(headers, "seedance", "doubao-seedance-2.0-pro", requestBinding)).toBeUndefined();
    });

    it("signs image quality billing metadata and rejects any tier or size mutation", () => {
        const requestBinding = { userId: "user-one", channelId: "channel-one", capability: "image" as const, method: "POST", canonicalPath: "/api/ai/system/channel-one/images/generations", canonicalQuery: "", bodyDigest: "b".repeat(64) };
        const imageQualityContext = {
            bindingId: "binding-one",
            qualityProfileRevision: "profile-v1",
            optionRevision: "option-v1",
            saleRateCardRevision: "sale-v1",
            selectedQualityValue: "2k",
            resolvedSize: "2048x2048",
            resolvedResolutionTier: "2k",
            billableOutputCount: 1,
        };
        const headers = new Headers(
            systemAiBillingHeaders(
                "qwen-image",
                {
                    ...requestBinding,
                    expiresAtMs: Date.now() + 60_000,
                    businessRequestId: "image-task:one",
                    requestFingerprint: "a".repeat(64),
                    attemptNumber: 1,
                    bindingId: "binding-one",
                    providerIdempotencySupported: false,
                    imageQualityContext,
                },
                "qwen-image-3.0-pro",
            ),
        );

        expect(readVerifiedSystemAiUsageContext(headers, "qwen-image", "qwen-image-3.0-pro", requestBinding)?.imageQualityContext).toEqual(imageQualityContext);
        headers.set("x-vozeb-pro-image-quality-context", JSON.stringify({ ...imageQualityContext, resolvedSize: "1024x1024" }));
        expect(readVerifiedSystemAiUsageContext(headers, "qwen-image", "qwen-image-3.0-pro", requestBinding)).toBeUndefined();
    });

    it("preserves a long canonical sale rate revision in the signed image quality context", () => {
        const requestBinding = { userId: "user-one", channelId: "channel-one", capability: "image" as const, method: "POST", canonicalPath: "/api/ai/system/channel-one/images/generations", canonicalQuery: "", bodyDigest: "b".repeat(64) };
        const imageQualityContext = {
            bindingId: "binding-one",
            qualityProfileRevision: "profile-v1",
            saleRateCardRevision: `rate-card-v1:${"dimension".repeat(180)}`,
            resolvedSize: "1024x1024",
            resolvedResolutionTier: "1k",
            billableOutputCount: 1,
        };
        const headers = new Headers(
            systemAiBillingHeaders(
                "qwen-image",
                {
                    ...requestBinding,
                    expiresAtMs: Date.now() + 60_000,
                    businessRequestId: "image-task:long-rate-card",
                    requestFingerprint: "a".repeat(64),
                    attemptNumber: 1,
                    bindingId: "binding-one",
                    providerIdempotencySupported: false,
                    imageQualityContext,
                },
                "qwen-image-3.0-pro",
            ),
        );

        expect(readVerifiedSystemAiUsageContext(headers, "qwen-image", "qwen-image-3.0-pro", requestBinding)?.imageQualityContext?.saleRateCardRevision).toBe(imageQualityContext.saleRateCardRevision);
    });

    it("rejects an otherwise valid create context after its configured request window", () => {
        const binding = { userId: "user-one", channelId: "channel-one", capability: "text" as const, method: "POST", canonicalPath: "/api/ai/system/channel-one/chat/completions", canonicalQuery: "", bodyDigest: "b".repeat(64) };
        const headers = new Headers(
            systemAiBillingHeaders(
                "writer",
                { ...binding, expiresAtMs: Date.now() - 1, businessRequestId: "text-task:expired", requestFingerprint: "a".repeat(64), attemptNumber: 1, bindingId: "binding", providerIdempotencySupported: false },
                "vendor-text",
            ),
        );

        expect(readVerifiedSystemAiUsageContext(headers, "writer", "vendor-text", binding)).toBeUndefined();
    });

    it("signs a runtime draft only after exact request bytes and route are known", () => {
        const draft = {
            userId: "user-one",
            channelId: "channel-one",
            capability: "image" as const,
            expiresAtMs: Date.now() + 60_000,
            businessRequestId: "image-task:one",
            requestFingerprint: "a".repeat(64),
            attemptNumber: 1,
            bindingId: "binding-one",
            providerIdempotencySupported: false,
        };
        const headers = new Headers(systemAiBillingHeaders("image-one", draft, "vendor-image"));
        expect(headers.get("x-vozeb-pro-points-signature")).toBeNull();

        finalizeSystemAiUsageRequestHeaders(headers, { method: "POST", canonicalPath: "/api/ai/system/channel-one/images/generations", canonicalQuery: "", bodyDigest: "b".repeat(64) });

        expect(
            readVerifiedSystemAiUsageContext(headers, "image-one", "vendor-image", {
                userId: "user-one",
                channelId: "channel-one",
                capability: "image",
                method: "POST",
                canonicalPath: "/api/ai/system/channel-one/images/generations",
                canonicalQuery: "",
                bodyDigest: "b".repeat(64),
            }),
        ).toMatchObject(draft);
    });

    it("round-trips the server-owned hold and attempt response identity", () => {
        const fingerprint = systemAiUsageRequestFingerprint({ userId: "user", businessRequestId: "task", logicalModel: "writer", capability: "text", payload: { prompt: "hello", maxTokens: 10 } });
        const headers = new Headers(systemAiUsageResponseHeaders({ holdId: "hold-one", attemptNumber: 2, requestFingerprint: fingerprint }));

        expect(readSystemAiUsageBilling(headers)).toEqual({ holdId: "hold-one", attemptNumber: 2, requestFingerprint: fingerprint });
    });
});
