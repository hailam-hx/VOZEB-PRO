import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getAuthSettings: vi.fn(),
    normalizeDramaContentAnalysis: vi.fn(),
    requestStructuredText: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings, isAuthInputError: vi.fn(() => false) }));
vi.mock("@/lib/server/drama-analysis", () => ({
    describeDramaAnalysisCandidate: vi.fn(() => ({})),
    dramaContentTool: { name: "analyze_drama_content", description: "content", parameters: {} },
    dramaVisualTool: { name: "design_drama_visuals", description: "visual", parameters: {} },
    hasUsableDramaToolArguments: vi.fn(() => true),
    normalizeDramaContentAnalysis: mocks.normalizeDramaContentAnalysis,
    normalizeDramaVisualAnalysis: vi.fn(),
}));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/server/text-planning-runtime", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/text-planning-runtime")>()), requestStructuredText: mocks.requestStructuredText }));

import { emptyDb } from "@/lib/auth/store-normalizers";
import { readAuthDb, writeAuthDb } from "@/lib/auth/store-repository";
import { normalizeBillableUsage } from "@/lib/billing/pricing";
import { getWalletSnapshot } from "@/lib/server/points-wallet-service";
import { finalizeSystemAiUsageRequestHeaders, readVerifiedSystemAiUsageContext, systemAiUsageResponseHeaders, type SystemAiUsageContext } from "@/lib/server/system-ai-billing";
import { TextPlanningRequestError } from "@/lib/server/text-planning-runtime";
import { recordUsageProviderAttempt, reserveOrReuseUsageBilling } from "@/lib/server/usage-billing-runtime";
import { POST } from "./route";

const previousProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const previousDataDir = process.env.VOZEB_PRO_DATA_DIR;
const requestUsage = normalizeBillableUsage({ capability: "text", source: "request", inputTokens: 10, maxOutputTokens: 2 });
const actualUsage = normalizeBillableUsage({ capability: "text", source: "actual", inputTokens: 10, outputTokens: 2 });
let dataDir = "";

beforeAll(() => {
    process.env.VOZEB_PRO_DATABASE_PROVIDER = "file";
});

beforeEach(async () => {
    vi.clearAllMocks();
    dataDir = await mkdtemp(join(tmpdir(), "vozeb-drama-usage-"));
    process.env.VOZEB_PRO_DATA_DIR = dataDir;
    const db = emptyDb();
    db.users.push({
        id: "user-one",
        accountId: "0001",
        username: "drama-user",
        displayName: "短剧用户",
        bio: "",
        role: "user",
        adminPermissions: [],
        status: "active",
        settledBalance: "10",
        passwordHash: "test",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
    });
    db.pointRecords.push({ id: "opening-credit", userId: "user-one", type: "credit", amount: "10", balanceAfter: "10", description: "测试充值", idempotencyKey: "opening-credit", createdAt: "2026-08-24T00:00:00.000Z" });
    await writeAuthDb(db);
    mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
    mocks.getAuthSettings.mockResolvedValue(settingsFixture());
    mocks.normalizeDramaContentAnalysis.mockReturnValue({ characters: [], scenes: [], shots: [{ id: "shot-one" }] });
});

afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
});

afterAll(() => {
    if (previousProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
    else process.env.VOZEB_PRO_DATABASE_PROVIDER = previousProvider;
    if (previousDataDir === undefined) delete process.env.VOZEB_PRO_DATA_DIR;
    else process.env.VOZEB_PRO_DATA_DIR = previousDataDir;
});

describe("drama analysis persisted usage attempt state", () => {
    it("finishes a terminal-invalid primary attempt before backup success and settles both provider costs", async () => {
        mocks.requestStructuredText.mockImplementation(async (input: StructuredRequest) => {
            const attempt = await persistProxyAttempt(input);
            if (input.candidate.channelId === "primary") {
                await input.onInvalidResponse?.(attempt.headers);
                throw new TextPlanningRequestError("模型没有返回所需的结构化结果", 502, false, "response");
            }
            return { arguments: "{}", protocol: "chat" as const, elapsedMs: 1, headers: attempt.headers };
        });

        const response = await POST(request());
        const db = await readAuthDb();

        expect(response.status, await response.clone().text()).toBe(200);
        expect(mocks.requestStructuredText).toHaveBeenCalledTimes(2);
        expect(db.providerUsageAttempts.map((attempt) => ({ attemptNumber: attempt.attemptNumber, status: attempt.status, costUsd: attempt.costUsd }))).toEqual([
            { attemptNumber: 1, status: "failed", costUsd: "0.1" },
            { attemptNumber: 2, status: "succeeded", costUsd: "0.1" },
        ]);
        expect(db.walletHolds).toEqual([expect.objectContaining({ status: "settled" })]);
        expect(db.usageCharges).toEqual([expect.objectContaining({ settledCredits: "1", totalProviderCostUsd: "0.2" })]);
        expect(await getWalletSnapshot("user-one")).toEqual({ settledBalance: "9", heldBalance: "0", availableBalance: "9" });
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("9");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("0");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("9");
    });

    it("retains an ambiguous pending primary attempt for review and does not call a backup", async () => {
        mocks.requestStructuredText.mockImplementation(async (input: StructuredRequest) => {
            await persistProxyAttempt(input);
            throw new TextPlanningRequestError("transport acceptance unknown", 504, true, "unknown");
        });

        const response = await POST(request());
        const db = await readAuthDb();

        expect(response.status).toBe(502);
        expect(mocks.requestStructuredText).toHaveBeenCalledOnce();
        expect(db.providerUsageAttempts).toEqual([expect.objectContaining({ attemptNumber: 1, status: "pending" })]);
        expect(db.walletHolds).toEqual([expect.objectContaining({ status: "active", reviewReason: "transport acceptance unknown" })]);
        expect(db.usageCharges).toEqual([]);
        expect(await getWalletSnapshot("user-one")).toEqual({ settledBalance: "10", heldBalance: "1", availableBalance: "9" });
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("10");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("1");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("9");
    });

    it("does not treat a proxy error response without persisted evidence as proven provider non-receipt", async () => {
        mocks.requestStructuredText.mockRejectedValue(new TextPlanningRequestError("proxy rejected request", 400, false, "response"));

        const response = await POST(request());
        const db = await readAuthDb();

        expect(response.status).toBe(502);
        expect(mocks.requestStructuredText).toHaveBeenCalledOnce();
        expect(db.providerUsageAttempts).toEqual([]);
        expect(db.walletHolds).toEqual([]);
        expect(db.usageCharges).toEqual([]);
        expect(response.headers.get("x-vozeb-pro-balance-settled")).toBe("10");
        expect(response.headers.get("x-vozeb-pro-balance-held")).toBe("0");
        expect(response.headers.get("x-vozeb-pro-balance-available")).toBe("10");
    });
});

type StructuredRequest = {
    candidate: { channelId: string; upstreamModel: string };
    headers?: HeadersInit;
    onInvalidResponse?: (headers: Headers) => Promise<unknown>;
};

async function persistProxyAttempt(input: StructuredRequest) {
    const context = verifiedContext(input);
    const settings = settingsFixture();
    const model = settings.logicalModels[0];
    const binding = model.bindings.find((item) => item.id === context.bindingId)!;
    const billing = await reserveOrReuseUsageBilling({
        userId: context.userId,
        businessId: context.businessRequestId,
        requestFingerprint: context.requestFingerprint,
        logicalModelId: model.id,
        saleRateSnapshot: model.saleRateCard,
        requestUsage,
        description: "短剧分析用量预留",
        inputLimits: { maxInputTokens: "10000", maxOutputTokens: "2000" },
        providerIdempotency: { supported: context.providerIdempotencySupported, key: context.providerIdempotencyKey },
    });
    await recordUsageProviderAttempt({
        billing,
        attemptNumber: context.attemptNumber,
        status: "pending",
        provider: input.candidate.channelId,
        bindingId: context.bindingId,
        providerIdempotencySupported: context.providerIdempotencySupported,
        providerIdempotencyKey: context.providerIdempotencyKey,
        nativeCostAmount: "0",
        nativeCostUnit: binding.providerCostUnit,
        costRateSnapshot: binding.costRateCard,
        normalizedUsage: requestUsage,
        observedUsage: actualUsage,
    });
    return { context, headers: new Headers(systemAiUsageResponseHeaders({ holdId: billing.holdId, attemptNumber: context.attemptNumber, requestFingerprint: context.requestFingerprint })) };
}

function verifiedContext(input: StructuredRequest): SystemAiUsageContext {
    const headers = new Headers(input.headers);
    const canonicalPath = `/api/ai/system/${input.candidate.channelId}/chat/completions`;
    const bodyDigest = createHash("sha256").update(`drama:${input.candidate.channelId}`).digest("hex");
    finalizeSystemAiUsageRequestHeaders(headers, { method: "POST", canonicalPath, canonicalQuery: "", bodyDigest });
    const context = readVerifiedSystemAiUsageContext(headers, "logical-text", input.candidate.upstreamModel, { userId: "user-one", channelId: input.candidate.channelId, capability: "text", method: "POST", canonicalPath, canonicalQuery: "", bodyDigest });
    if (!context) throw new Error("drama request did not produce a verified usage context");
    return context;
}

function settingsFixture() {
    const channel = (id: string, model: string) => ({ id, name: id, baseUrl: `https://${id}.example.com`, apiKey: "secret", apiFormat: "openai" as const, models: [model], enabled: true });
    const costRateCard = { version: 1 as const, components: [{ id: "input", dimension: "inputTokens" as const, unitPrice: "0.01", per: "1" }] };
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
                saleRateCard: { version: 1 as const, components: [{ id: "input", dimension: "inputTokens" as const, unitPrice: "0.1", per: "1" }] },
                bindings: [
                    {
                        id: "binding-primary",
                        channelId: "primary",
                        upstreamModel: "text-primary",
                        enabled: true,
                        priority: 1,
                        capabilityProfile: { supportsIdempotency: true, maxInputTokens: 10000, maxOutputTokens: 2000 },
                        costRateCard,
                        providerCostUnit: { kind: "fiat" as const, currency: "USD" as const },
                    },
                    {
                        id: "binding-backup",
                        channelId: "backup",
                        upstreamModel: "text-backup",
                        enabled: true,
                        priority: 2,
                        capabilityProfile: { supportsIdempotency: false, maxInputTokens: 10000, maxOutputTokens: 2000 },
                        costRateCard,
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
