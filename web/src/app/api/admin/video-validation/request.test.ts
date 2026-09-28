import { describe, expect, it } from "vitest";

import { parsePreviewRequest, parseStartRequest } from "./request";

const base = { mode: "changed_models", maxBudgetHotxCredits: "0.7", concurrency: 2, readyPricingOnly: true };

describe("video validation V2 request contract", () => {
    it("accepts changed-model verification using only administrator choices", () => {
        expect(parsePreviewRequest(base)).toEqual(base);
        expect(parseStartRequest({ ...base, previewRevision: "revision" })).toEqual({ ...base, previewRevision: "revision" });
    });

    it("rejects client supplied cost, fingerprint and payload identity", () => {
        for (const field of ["estimatedCredits", "fingerprintHash", "requestPayloadDigest", "rateCard", "normalizedContext", "idempotencyKey"]) expect(() => parsePreviewRequest({ ...base, [field]: "forged" })).toThrow(/不允许提交/);
    });
});
