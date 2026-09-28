// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("antd", () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />, Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

import { VideoValidationRunDetails } from "./video-validation-run-details";

describe("VideoValidationRunDetails", () => {
    it("shows safe item state, expected and actual costs and friendly errors", () => {
        render(
            <VideoValidationRunDetails
                detail={{
                    run: {
                        id: "run",
                        mode: "family_sample",
                        status: "failed",
                        previewRevision: "p",
                        registryRevision: "r",
                        pricingPolicyVersion: "v",
                        maxBudgetHotxCredits: "1",
                        estimatedCostHotxCredits: "0.2",
                        actualCostHotxCredits: "0.19",
                        concurrency: 1,
                        selectedCount: 1,
                        runnableCount: 1,
                        skippedCount: 0,
                        createdBy: "admin",
                        createdAt: "2026-09-26T00:00:00.000Z",
                    },
                    items: [
                        {
                            id: "item",
                            runId: "run",
                            logicalModelId: "seedance",
                            bindingId: "binding",
                            channelId: "dflop",
                            upstreamModelId: "seedance",
                            contractFamily: "family",
                            caseId: "text-to-video",
                            testLevel: "FAMILY_CANARY",
                            status: "failed",
                            capabilityRevision: "c",
                            pricingRevision: "p",
                            estimatedCostHotxCredits: "0.2",
                            actualCostHotxCredits: "0.19",
                            actualCredits: "0.19",
                            reservedCredits: "0.2",
                            settledCredits: "0.19",
                            creditSettlementSource: "PROVIDER_REPORTED_CREDITS",
                            idempotencyKey: "secret-idempotency",
                            errorCode: "UPSTREAM_REJECTED",
                            errorMessage: "参数不受支持",
                            createdAt: "2026-09-26T00:00:00.000Z",
                            updatedAt: "2026-09-26T00:00:00.000Z",
                        },
                    ],
                }}
            />,
        );
        expect(screen.getByText(/预算上界 0.2 HOTX 积分 · 已预留 0.2 · 已结算 0.19/)).toBeTruthy();
        expect(screen.getByText(/实际 0.19 HOTX 积分/)).toBeTruthy();
        expect(screen.getByText("参数不受支持")).toBeTruthy();
        expect(screen.queryByText("secret-idempotency")).toBeNull();
    });
});
