"use client";

import { Button, Tag } from "antd";

import type { VideoValidationItem, VideoValidationRun } from "@/lib/video-validation";

export function VideoValidationRunDetails({ detail, cancelling, onCancel }: { detail: { run: VideoValidationRun; items: VideoValidationItem[] }; cancelling?: boolean; onCancel?: () => void }) {
    const active = detail.run.status === "pending" || detail.run.status === "running";
    const submissionAttempts = detail.items.filter((item) => Boolean(item.submissionStartedAt)).length;
    const liveSubmissions = detail.items.filter((item) => Boolean(item.submittedAt || item.providerTaskId)).length;
    const skippedCases = detail.items.filter((item) => item.status === "skipped").length;
    return (
        <section className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-mono text-xs">{detail.run.id}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                        预计预留 {detail.run.estimatedCostHotxCredits} · 已结算 {detail.run.totalSettledCredits ?? detail.run.actualCostHotxCredits} HOTX 积分 · 当前预留 {detail.run.activeReservedCredits ?? "0"}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Tag>{detail.run.status}</Tag>
                    {detail.run.costBoundViolated ? <Tag color="red">COST_BOUND_VIOLATION{detail.run.budgetViolationAt ? ` · ${detail.run.budgetViolationAt}` : ""}</Tag> : null}
                    {active && onCancel ? (
                        <Button danger size="small" loading={cancelling} onClick={onCancel}>
                            取消验收
                        </Button>
                    ) : null}
                </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>模型 {new Set(detail.items.map((item) => item.logicalModelId)).size}</span>
                <span>验收用例 {detail.items.length}</span>
                <span>免费检查 {detail.items.filter((item) => Boolean(item.probeStatus)).length}</span>
                <span>实际 Live Canary {detail.run.mode === "family_sample" ? liveSubmissions : 0}</span>
                <span>实际 Live Submit {liveSubmissions}</span>
                <span>提交尝试 {submissionAttempts}</span>
                <span>跳过用例 {skippedCases}</span>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto [scrollbar-width:none]">
                {detail.items.map((item) => (
                    <article key={item.id} className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
                        <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">
                                {item.logicalModelId} · {item.caseId}
                            </span>
                            <Tag>{item.status}</Tag>
                        </div>
                        <div className="mt-1 text-zinc-500">
                            预算上界 {item.estimatedCredits ?? item.estimatedCostHotxCredits} HOTX 积分 · 已预留 {item.reservedCredits ?? "0"} · 已结算 {item.settledCredits ?? "0"}
                            {item.actualCredits ? ` · 实际 ${item.actualCredits} HOTX 积分` : item.creditSettlementSource === "ESTIMATED_FALLBACK" ? " · 按预留额保守结算" : ""}
                        </div>
                        {item.actualProviderCost ? (
                            <div className="mt-1 text-zinc-500">
                                上游成本 {item.actualProviderCost.amount} {item.actualProviderCost.currency}/{item.actualProviderCost.unit}
                            </div>
                        ) : null}
                        {item.actualCostCapability === "UNAVAILABLE" ? <div className="mt-1 text-zinc-500">上游未提供可核实的终态实际费用；提交后按预算保守结算</div> : null}
                        {item.creditSettlementSource ? <div className="mt-1 text-zinc-500">结算依据：{item.creditSettlementSource}</div> : null}
                        {item.errorMessage ? <p className="mt-2 text-red-600 dark:text-red-400">{item.errorMessage}</p> : item.reasonCode ? <p className="mt-2 text-zinc-500">{item.reasonCode}</p> : null}
                    </article>
                ))}
            </div>
        </section>
    );
}
