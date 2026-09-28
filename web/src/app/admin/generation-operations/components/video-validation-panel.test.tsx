// @vitest-environment jsdom
import { App } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/admin-video-validation", () => ({ previewAdminVideoValidation: vi.fn(), startAdminVideoValidation: vi.fn(), listAdminVideoValidationRuns: vi.fn(async () => ({ items: [], total: 0 })) }));
import { listAdminVideoValidationRuns, previewAdminVideoValidation } from "@/services/api/admin-video-validation";
import { VideoValidationPanel } from "./video-validation-panel";

describe("VideoValidationPanel", () => {
    afterEach(cleanup);
    it("defaults to fingerprint sampling and exposes changed-model mode", () => {
        render(
            <App>
                <VideoValidationPanel />
            </App>,
        );
        expect(screen.getByText("低成本视频验收")).toBeTruthy();
        expect(screen.getByText("仅合同检查")).toBeTruthy();
        expect(screen.getByText("按合同指纹抽样")).toBeTruthy();
        expect(screen.getByText("变更模型验证")).toBeTruthy();
        expect(screen.getByText("全部模型最小参数")).toBeTruthy();
        expect((screen.getByRole("radio", { name: "按合同指纹抽样" }) as HTMLInputElement).checked).toBe(true);
    });

    it("labels skipped cases in Chinese and blocks a preview that exceeds the hard budget", async () => {
        vi.mocked(previewAdminVideoValidation).mockResolvedValueOnce({
            revision: "revision",
            selectedModels: 1,
            bindings: 1,
            validationCases: 1,
            fingerprintCount: 1,
            plannedFreeChecks: 1,
            plannedLiveCanaries: 1,
            runnableModels: 1,
            skippedModels: 0,
            skippedCases: 0,
            estimatedCredits: "2",
            estimatedProviderCostHotxCredits: "2",
            estimatedProviderCosts: [],
            maxBudgetHotxCredits: "1",
            items: [
                {
                    logicalModelId: "model",
                    bindingId: "binding",
                    channelId: "channel",
                    upstreamModelId: "model",
                    contractFamily: "family",
                    caseId: "text-to-video",
                    probe: { status: "CONTRACT_READY", reasonCode: "READY", message: "可用" },
                    capabilityRevision: "cap",
                    pricingRevision: "price",
                    estimatedCostHotxCredits: "2",
                    estimatedCredits: "2",
                    liveSelected: true,
                },
            ],
        } as never);
        render(
            <App>
                <VideoValidationPanel />
            </App>,
        );
        fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
        await waitFor(() => expect(screen.getByText("预计费用超过硬预算，请提高预算或缩小验收范围。")).toBeTruthy());
        expect(screen.getByRole("button", { name: "开始验收" }).hasAttribute("disabled")).toBe(true);
    });

    it("shows the database requirement without offering an unusable preview", async () => {
        vi.mocked(listAdminVideoValidationRuns).mockResolvedValueOnce({ items: [], total: 0, unavailableReason: "POSTGRES_REQUIRED" } as never);
        render(
            <App>
                <VideoValidationPanel />
            </App>,
        );
        await waitFor(() => expect(screen.getByText("低成本视频验收需要 PostgreSQL 持久化。请先配置数据库。")).toBeTruthy());
        expect(screen.getByRole("button", { name: "生成预览" }).hasAttribute("disabled")).toBe(true);
    });

    it("shows a fingerprint dry-run with model readiness, cost units and blocking reason", async () => {
        vi.mocked(previewAdminVideoValidation).mockResolvedValueOnce({
            revision: "revision",
            selectedModels: 2,
            totalModels: 2,
            contractReadyModels: 1,
            partialModels: 0,
            blockedModels: 1,
            fingerprintCount: 2,
            skippedFingerprints: 1,
            validationCases: 2,
            plannedFreeChecks: 2,
            plannedLiveCanaries: 1,
            runnableModels: 1,
            skippedCases: 1,
            estimatedCredits: "0.5",
            estimatedProviderCosts: [{ amount: "200", currency: "DFLOP_CREDIT", unit: "task" }],
            maxBudgetHotxCredits: "1",
            items: [],
            canaryGroups: [
                {
                    contractFingerprint: { version: 1, hash: "abc", caseId: "text-to-video" },
                    modelsInGroup: ["seedance-a"],
                    selectedCanaryModel: "seedance-a",
                    selectionReason: "LOWEST_ESTIMATED_CREDITS",
                    normalizedContext: { count: "1", durationSeconds: "5", resolution: "720p", aspectRatio: "16:9", generateAudio: false, watermark: false, references: [] },
                    minimumDuration: "5",
                    minimumResolution: "720p",
                    audioEnabled: false,
                    estimatedProviderCost: { amount: "200", currency: "DFLOP_CREDIT", unit: "task" },
                    estimatedCredits: "0.5",
                    pricingSnapshot: { rateCardRevision: "r1", pricingPolicyVersion: "p1", providerPricingStatus: "READY" },
                    bindingId: "binding-1",
                    providerId: "dflop",
                    liveSubmitEligible: true,
                    blockedReason: null,
                },
                {
                    contractFingerprint: { version: 1, hash: "def", caseId: "image-to-video" },
                    modelsInGroup: ["unpriced"],
                    selectedCanaryModel: null,
                    selectionReason: "NO_ELIGIBLE_BINDING",
                    normalizedContext: null,
                    minimumDuration: null,
                    minimumResolution: null,
                    audioEnabled: null,
                    estimatedProviderCost: null,
                    estimatedCredits: null,
                    pricingSnapshot: null,
                    bindingId: null,
                    providerId: null,
                    liveSubmitEligible: false,
                    blockedReason: "COST_NOT_ESTIMATABLE",
                },
            ],
        } as never);
        render(
            <App>
                <VideoValidationPanel />
            </App>,
        );
        fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
        await waitFor(() => expect(screen.getByText("可完成合同检查模型")).toBeTruthy());
        expect(screen.getByText(/abc · text-to-video/)).toBeTruthy();
        fireEvent.click(screen.getByText(/abc · text-to-video/));
        expect(screen.getByText("模型：seedance-a")).toBeTruthy();
        expect(screen.getByText("选择原因：同指纹最低预计成本")).toBeTruthy();
        expect(screen.getByText("上游成本：200 DFLOP_CREDIT/task")).toBeTruthy();
        expect(screen.getByText("内部成本：0.5 HOTX credits")).toBeTruthy();
        fireEvent.click(screen.getByText(/def · image-to-video/));
        expect(screen.getByText("阻塞原因：缺少可执行的成本维度")).toBeTruthy();
    });
});
