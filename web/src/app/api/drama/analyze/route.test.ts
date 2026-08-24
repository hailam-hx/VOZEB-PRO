import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    getWalletSnapshot: vi.fn(),
    normalizeDramaContentAnalysis: vi.fn(),
    requestStructuredText: vi.fn(),
    finishSystemAiTextAttempt: vi.fn(),
    resolveSystemAiTextFailure: vi.fn(),
    verifiedContexts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings, isAuthInputError: vi.fn(() => false) }));
vi.mock("@/lib/server/points-wallet-service", () => ({ getWalletSnapshot: mocks.getWalletSnapshot }));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ finishSystemAiTextAttempt: mocks.finishSystemAiTextAttempt, resolveSystemAiTextFailure: mocks.resolveSystemAiTextFailure }));
vi.mock("@/lib/server/drama-analysis", () => ({
    describeDramaAnalysisCandidate: vi.fn(() => ({})),
    describeDramaModelOutput: vi.fn(() => ({})),
    dramaContentTool: { name: "analyze_drama_content", description: "content", parameters: {} },
    dramaVisualTool: { name: "design_drama_visuals", description: "visual", parameters: {} },
    hasUsableDramaToolArguments: vi.fn((value: string) => value !== "invalid"),
    normalizeDramaContentAnalysis: mocks.normalizeDramaContentAnalysis,
    normalizeDramaVisualAnalysis: vi.fn(),
}));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/server/text-planning-runtime", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/text-planning-runtime")>()), requestStructuredText: mocks.requestStructuredText }));

import { finalizeSystemAiUsageRequestHeaders, readVerifiedSystemAiUsageContext, systemAiUsageResponseHeaders } from "@/lib/server/system-ai-billing";
import { POST } from "./route";

describe("drama analysis PAYG contract", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifiedContexts.length = 0;
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.getAuthSettings.mockResolvedValue(settingsFixture());
        mocks.getWalletSnapshot.mockResolvedValue({ settledBalance: "12345678901234567890.12345678", heldBalance: "0.00000001", availableBalance: "12345678901234567890.12345677" });
        mocks.normalizeDramaContentAnalysis.mockReturnValue({ characters: [], scenes: [], shots: [{ id: "shot-one" }] });
        mocks.finishSystemAiTextAttempt.mockResolvedValue(undefined);
        mocks.resolveSystemAiTextFailure.mockImplementation(async (input) => ({ state: input.final ? "released" : "safe_to_failover" }));
        mocks.requestStructuredText.mockImplementation(async (input) => signedProxyResponse(input));
    });

    it("finalizes a verified context for every failover attempt and refreshes exact balances after settlement", async () => {
        mocks.requestStructuredText.mockImplementationOnce(async (input) => {
            signedProxyResponse(input);
            throw new Error("primary unavailable");
        });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.verifiedContexts).toMatchObject([
            { userId: "user-one", channelId: "primary", capability: "text", businessRequestId: expect.any(String), attemptNumber: 1, bindingId: "binding-primary", providerIdempotencySupported: true, providerIdempotencyKey: expect.any(String) },
            { userId: "user-one", channelId: "backup", capability: "text", businessRequestId: expect.any(String), attemptNumber: 2, bindingId: "binding-backup", providerIdempotencySupported: false },
        ]);
        expect(mocks.verifiedContexts[0].businessRequestId).toBe(mocks.verifiedContexts[1].businessRequestId);
        expect(mocks.verifiedContexts[0].requestFingerprint).toBe(mocks.verifiedContexts[1].requestFingerprint);
        expect(mocks.verifiedContexts[0].providerIdempotencyKey).toBe(`${mocks.verifiedContexts[0].businessRequestId}:attempt:1`);
        expect(mocks.verifiedContexts[1].providerIdempotencyKey).toBeUndefined();
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenCalledOnce();
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "succeeded" });
        expect(mocks.resolveSystemAiTextFailure).toHaveBeenCalledOnce();
        expect(mocks.getWalletSnapshot).toHaveBeenCalledWith("user-one");
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("12345678901234567890.12345678");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("0.00000001");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("12345678901234567890.12345677");
    });

    it("finishes failed attempts, releases the shared usage hold once, and refreshes exact balances after platform failure", async () => {
        mocks.normalizeDramaContentAnalysis.mockImplementation(() => {
            throw new Error("invalid drama output");
        });
        mocks.getWalletSnapshot.mockResolvedValueOnce({ settledBalance: "99999999999999999999.00000001", heldBalance: "12.00000000", availableBalance: "99999999999999999987.00000001" });

        const response = await POST(request());

        expect(response.status).toBe(502);
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenCalledTimes(2);
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenNthCalledWith(1, expect.any(Headers), { status: "failed" });
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenNthCalledWith(2, expect.any(Headers), { status: "failed" });
        expect(mocks.resolveSystemAiTextFailure).toHaveBeenCalledTimes(3);
        expect(mocks.resolveSystemAiTextFailure).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "user-one", businessId: mocks.verifiedContexts[0].businessRequestId, reason: "invalid drama output", final: true }));
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("99999999999999999999.00000001");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("12.00000000");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("99999999999999999987.00000001");
    });
});

function signedProxyResponse(input: { headers?: HeadersInit; candidate: { channelId: string; upstreamModel: string } }) {
    const headers = new Headers(input.headers);
    const canonicalPath = `/api/ai/system/${input.candidate.channelId}/chat/completions`;
    const bodyDigest = createHash("sha256").update(`drama:${input.candidate.channelId}`).digest("hex");
    finalizeSystemAiUsageRequestHeaders(headers, { method: "POST", canonicalPath, canonicalQuery: "", bodyDigest });
    const context = readVerifiedSystemAiUsageContext(headers, "logical-text", input.candidate.upstreamModel, { userId: "user-one", channelId: input.candidate.channelId, capability: "text", method: "POST", canonicalPath, canonicalQuery: "", bodyDigest });
    if (!context) throw new Error("drama request did not produce a verified usage context");
    mocks.verifiedContexts.push(context);
    return {
        arguments: "{}",
        protocol: "chat" as const,
        elapsedMs: 1,
        headers: new Headers(systemAiUsageResponseHeaders({ holdId: "hold-drama", attemptNumber: context.attemptNumber, requestFingerprint: context.requestFingerprint })),
    };
}

function settingsFixture() {
    const channel = (id: string, model: string) => ({ id, name: id, baseUrl: `https://${id}.example.com`, apiKey: "secret", apiFormat: "openai" as const, models: [model], enabled: true });
    return {
        defaultModels: { textModel: "logical-text" },
        generationDefaults: { videoSeconds: 5 },
        systemChannels: [channel("primary", "text-primary"), channel("backup", "text-backup")],
        logicalModels: [
            {
                id: "logical-text",
                name: "Logical text",
                capability: "text" as const,
                enabled: true,
                saleRateCard: { version: 1 as const, components: [{ id: "input", dimension: "inputTokens" as const, unitPrice: "0.001", per: "1" }] },
                bindings: [
                    {
                        id: "binding-primary",
                        channelId: "primary",
                        upstreamModel: "text-primary",
                        enabled: true,
                        priority: 1,
                        capabilityProfile: { supportsIdempotency: true, maxInputTokens: 10000, maxOutputTokens: 2000 },
                        costRateCard: { version: 1 as const, components: [{ id: "input", dimension: "inputTokens" as const, unitPrice: "0.0001", per: "1" }] },
                        providerCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                    },
                    {
                        id: "binding-backup",
                        channelId: "backup",
                        upstreamModel: "text-backup",
                        enabled: true,
                        priority: 2,
                        capabilityProfile: { supportsIdempotency: false, maxInputTokens: 10000, maxOutputTokens: 2000 },
                        costRateCard: { version: 1 as const, components: [{ id: "input", dimension: "inputTokens" as const, unitPrice: "0.0001", per: "1" }] },
                        providerCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                    },
                ],
            },
        ],
    };
}

function request() {
    return new Request("http://localhost/api/drama/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "content", script: "第一场" }) });
}
