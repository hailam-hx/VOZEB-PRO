"use client";

import { Alert, App, Button, Input, InputNumber, Radio, Tag } from "antd";
import { FlaskConical, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Panel, PanelHeader } from "@/components/admin/admin-panel";
import { decimal } from "@/lib/billing/decimal";
import type { VideoValidationItem, VideoValidationMode, VideoValidationPreview, VideoValidationRun } from "@/lib/video-validation";
import { cancelAdminVideoValidationRun, getAdminVideoValidationRun, listAdminVideoValidationRuns, previewAdminVideoValidation, startAdminVideoValidation } from "@/services/api/admin-video-validation";
import { VideoValidationRunDetails } from "./video-validation-run-details";

const modes: Array<{ value: VideoValidationMode; label: string }> = [
    { value: "contract_only", label: "仅合同检查" },
    { value: "family_sample", label: "按合同指纹抽样" },
    { value: "changed_models", label: "变更模型验证" },
    { value: "all_models_minimum", label: "全部模型最小参数" },
];

const skipMessages: Record<string, string> = {
    BUDGET_BOUND_UNAVAILABLE: "无法证明提交前最大计费额",
    COST_NOT_ESTIMATABLE: "缺少可执行的成本维度",
    PRICING_NOT_READY: "成本计价尚未就绪",
    PRICING_NEEDS_REVIEW: "上游计价需要复核",
    REFERENCE_FIXTURE_UNAVAILABLE: "缺少公开 HTTPS 参考素材",
    FIXTURE_URL_UNSAFE: "验收素材尚未配置公开 HTTPS 地址或地址不安全",
    FIXTURE_URL_EPHEMERAL: "验收素材使用会过期的签名地址",
    FIXTURE_METADATA_INCOMPLETE: "验收素材缺少 MIME、SHA-256 或媒体元数据",
    FIXTURE_ANNOTATION_UNVERIFIED: "验收素材的人声或人脸标注缺少复核证据",
    FIXTURE_EXTERNAL_REACHABILITY_UNVERIFIED: "验收素材缺少外部网络可访问性验证记录",
    FIXTURE_FACE_UNVERIFIED: "验收素材的人脸数量未核实",
    FIXTURE_AUDIO_UNVERIFIED: "验收驱动音频未核实音轨",
    FIXTURE_SPEECH_UNVERIFIED: "剪辑源视频尚未核实清晰人声",
    CLIP_TEMPLATE_UNVERIFIED: "剪辑模板未在当前渠道的官方模板列表核实",
    AVATAR_ASSET_NOT_READY: "预置数字人形象尚未处于 ready 状态",
    FIXTURE_MIME_MISMATCH: "验收素材的实际 MIME 与档案不一致",
    FIXTURE_HASH_MISMATCH: "验收素材的 SHA-256 与档案不一致",
    FIXTURE_DURATION_MISMATCH: "验收素材的实际时长与档案不一致",
    FIXTURE_MEDIA_METADATA_MISMATCH: "验收素材的尺寸或音轨与档案不一致",
    FIXTURE_UNREACHABLE: "验收素材无法访问或无法解析媒体元数据",
    REQUEST_DESCRIPTOR_UNAVAILABLE: "请求合同尚无法验证",
    SKIPPED_UNCHANGED: "合同指纹未变，已通过验证",
    SKIPPED_CANARY_NOT_SELECTED: "同指纹已有更低成本代表",
    NEEDS_RECONCILIATION: "上次提交结果不明，待对账",
    NEEDS_REVIEW_CREDENTIAL_REVISION: "渠道密钥版本无法核实",
    BUDGET_EXCEEDED: "预计费用超过硬预算",
    CONTRACT_ONLY_NO_LIVE: "仅运行免费检查",
    NO_ELIGIBLE_BINDING: "没有符合条件的绑定",
    GROK_PRICING_SOURCE_CONFLICT: "Grok 公开目录与官方文档价格冲突，无法证明预算上限",
    AVATAR_ASSET_REQUIRED: "需就绪数字人形象及音频或文字驱动合同",
    AVATAR_PRICING_SOURCE_CONFLICT: "数字人出片价格在公开目录与官方 API 文档中不一致；仍需就绪形象和音频素材",
    PUBLIC_VIDEO_AND_AUDIO_REQUIRED: "需公网视频、音频素材及专用对口型请求合同",
    PUBLIC_VIDEO_AND_PORTRAIT_REQUIRED: "需公网动作视频、人物图片及人数参数",
    SUBTITLE_SOURCE_VIDEO_REQUIRED: "字幕处理需公网源视频、语种参数及源视频时长，不能按文生视频验收",
    SUBTITLE_RESULT_SCHEMA_UNVERIFIED: "上游尚未公开 VTT 结果字段；仍需公网源视频、语种和真实时长",
    ASR_WORKFLOW_REQUIRED: "需先解析字幕取得 asr_id，再提交剪辑任务",
    ASR_PRICE_BOUND_UNVERIFIED: "剪辑前置 ASR 当前标称免费，但缺少可审计的费用上限；仍需公网口播视频和有效模板",
};

const selectionMessages = {
    LOWEST_ESTIMATED_CREDITS: "同指纹最低预计成本",
    NO_ELIGIBLE_BINDING: "没有符合条件的绑定",
    CONTRACT_ONLY_NO_LIVE: "仅运行免费检查",
};

export function VideoValidationPanel() {
    const { message, modal } = App.useApp();
    const [mode, setMode] = useState<VideoValidationMode>("family_sample");
    const [budget, setBudget] = useState("1");
    const [concurrency, setConcurrency] = useState(1);
    const [preview, setPreview] = useState<VideoValidationPreview>();
    const [runs, setRuns] = useState<VideoValidationRun[]>([]);
    const [repositoryUnavailable, setRepositoryUnavailable] = useState(false);
    const [detail, setDetail] = useState<{ run: VideoValidationRun; items: VideoValidationItem[] }>();
    const [loading, setLoading] = useState(false);
    const overBudget = preview && mode !== "contract_only" && decimal(preview.estimatedCredits ?? "0").greaterThan(decimal(budget || "0"));

    const loadRuns = async () => {
        try {
            const result = await listAdminVideoValidationRuns();
            setRuns(result.items);
            setRepositoryUnavailable(result.unavailableReason === "POSTGRES_REQUIRED");
        } catch {
            setRuns([]);
        }
    };
    useEffect(() => {
        void loadRuns();
    }, []);

    const command = () => ({ mode, maxBudgetHotxCredits: budget, concurrency, readyPricingOnly: true as const });
    const createPreview = async () => {
        setLoading(true);
        try {
            setPreview(await previewAdminVideoValidation(command()));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "验收预览失败");
        } finally {
            setLoading(false);
        }
    };
    const start = () => {
        if (!preview) return;
        const execute = async () => {
            setLoading(true);
            try {
                await startAdminVideoValidation({ ...command(), previewRevision: preview.revision });
                message.success("视频验收任务已创建");
                setPreview(undefined);
                await loadRuns();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "创建验收任务失败");
            } finally {
                setLoading(false);
            }
        };
        if (mode === "contract_only") {
            void execute();
            return;
        }
        modal.confirm({
            title: "确认产生上游费用",
            content: `将提交 ${preview.plannedLiveCanaries ?? preview.runnableModels} 个视频任务，预计内部成本 ${preview.estimatedCredits ?? preview.estimatedProviderCostHotxCredits} HOTX 积分，硬预算 ${preview.maxBudgetHotxCredits} HOTX 积分。上游原币成本：${preview.estimatedProviderCosts?.length ? preview.estimatedProviderCosts.map((cost) => `${cost.amount} ${cost.currency}/${cost.unit}`).join(" · ") : "暂无可靠数据"}。`,
            okText: "确认开始",
            cancelText: "取消",
            onOk: execute,
        });
    };

    return (
        <Panel>
            <PanelHeader
                title="低成本视频验收"
                description="先执行免费合同与能力检查，再按运行合同指纹抽样或验证变更模型。"
                actions={
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadRuns()}>
                        刷新记录
                    </Button>
                }
            />
            <div className="space-y-4 p-3 sm:p-4">
                {repositoryUnavailable ? <Alert type="warning" showIcon message="低成本视频验收需要 PostgreSQL 持久化。请先配置数据库。" /> : null}
                <Radio.Group
                    className="w-full"
                    value={mode}
                    onChange={(event) => {
                        setMode(event.target.value);
                        setPreview(undefined);
                    }}
                >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {modes.map((item) => (
                            <Radio.Button key={item.value} value={item.value} className="w-full text-center">
                                {item.label}
                            </Radio.Button>
                        ))}
                    </div>
                </Radio.Group>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto]">
                    <label className="space-y-1 text-sm">
                        <span className="text-zinc-600 dark:text-zinc-300">最大预算（HOTX credits）</span>
                        <Input
                            value={budget}
                            inputMode="decimal"
                            onChange={(event) => {
                                setBudget(event.target.value);
                                setPreview(undefined);
                            }}
                        />
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="text-zinc-600 dark:text-zinc-300">并发数</span>
                        <InputNumber
                            className="w-full"
                            min={1}
                            precision={0}
                            value={concurrency}
                            onChange={(value) => {
                                setConcurrency(value || 1);
                                setPreview(undefined);
                            }}
                        />
                    </label>
                    <Button className="self-end" type="primary" icon={<FlaskConical className="size-4" />} loading={loading} disabled={repositoryUnavailable} onClick={() => void createPreview()}>
                        生成预览
                    </Button>
                </div>
                <p className="text-xs text-zinc-500">仅运行 pricing status=READY 且 normalized context 可执行、可计价的 binding。能力或价格变化后旧预览会失效。</p>
                {preview ? (
                    <section className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:p-4">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Metric label="已选模型" value={preview.selectedModels} />
                            <Metric label="可完成合同检查模型" value={preview.contractReadyModels ?? 0} />
                            <Metric label="部分通过模型" value={preview.partialModels ?? 0} />
                            <Metric label="受阻模型" value={preview.blockedModels ?? 0} />
                            <Metric label="绑定" value={preview.bindings ?? 0} />
                            <Metric label="验收用例" value={preview.validationCases ?? preview.items.length} />
                            <Metric label="合同指纹" value={preview.fingerprintCount ?? 0} />
                            <Metric label="免费检查" value={preview.plannedFreeChecks ?? preview.items.length} />
                            <Metric label="付费 Canary" value={preview.plannedLiveCanaries ?? preview.runnableModels} />
                            <Metric label="跳过用例" value={preview.skippedCases ?? preview.skippedModels} />
                            <Metric label="跳过指纹" value={preview.skippedFingerprints ?? 0} />
                            <Metric label="预计 HOTX 积分" value={preview.estimatedCredits ?? preview.estimatedProviderCostHotxCredits} />
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">
                            可核实上游原币成本（{preview.providerCostCoveredCases ?? 0}/{preview.plannedLiveCanaries ?? preview.runnableModels} 用例）：
                            {preview.estimatedProviderCosts?.length ? preview.estimatedProviderCosts.map((cost) => `${cost.amount} ${cost.currency}/${cost.unit}`).join(" · ") : "暂无可靠数据"}
                        </p>
                        {overBudget ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">预计费用超过硬预算，请提高预算或缩小验收范围。</p> : null}
                        {preview.canaryGroups?.length ? (
                            <div className="mt-4 space-y-2">
                                <h3 className="text-sm font-medium">Canary dry-run · 尚未提交上游任务</h3>
                                <div className="max-h-80 space-y-2 overflow-y-auto [scrollbar-width:none]">
                                    {preview.canaryGroups.map((group) => (
                                        <details key={`${group.contractFingerprint.hash}:${group.contractFingerprint.caseId}`} className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
                                            <summary className="cursor-pointer break-all font-medium">
                                                {group.contractFingerprint.hash} · {group.contractFingerprint.caseId} · {group.selectedCanaryModel || "未选 Canary"}
                                            </summary>
                                            <div className="mt-2 grid gap-1 break-all sm:grid-cols-2">
                                                <span>模型：{group.modelsInGroup.join("、")}</span>
                                                <span>共享合同依据：{group.sharedContractReason}</span>
                                                <span>选择原因：{selectionMessages[group.selectionReason]}</span>
                                                <span>抽样用例：{group.selectedTestCase ?? "—"}</span>
                                                <span>最短时长：{group.minimumDuration ?? "—"} 秒</span>
                                                <span>最低分辨率：{group.minimumResolution ?? "—"}</span>
                                                <span>音频：{group.audioEnabled === null ? "—" : group.audioEnabled ? "开启" : "关闭"}</span>
                                                <span>上游成本：{group.estimatedProviderCost ? `${group.estimatedProviderCost.amount} ${group.estimatedProviderCost.currency}/${group.estimatedProviderCost.unit}` : "不可估算"}</span>
                                                <span>内部成本：{group.estimatedCredits ? `${group.estimatedCredits} HOTX credits` : "不可估算"}</span>
                                                <span>Binding：{group.bindingId ?? "—"}</span>
                                                <span>Provider：{group.providerId ?? "—"}</span>
                                                <span>Live 提交资格：{group.liveSubmitEligible ? "具备" : "不具备"}</span>
                                                <span>阻塞原因：{group.blockedReason ? skipMessages[group.blockedReason] || group.blockedReason : "无"}</span>
                                                <span>定价快照：{group.pricingSnapshot ? `${group.pricingSnapshot.providerPricingStatus || "—"} · ${group.pricingSnapshot.rateCardRevision} · ${group.pricingSnapshot.pricingPolicyVersion}` : "—"}</span>
                                                <span className="sm:col-span-2">规范化参数：{group.normalizedContext ? JSON.stringify(group.normalizedContext) : "—"}</span>
                                            </div>
                                        </details>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto [scrollbar-width:none]">
                            {preview.items.map((item) => (
                                <div key={`${item.bindingId}:${item.caseId}`} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">
                                            {item.logicalModelId} · {item.caseId}
                                        </div>
                                        <div className="mt-1 truncate text-zinc-500">
                                            {item.normalizedContext
                                                ? `${item.normalizedContext.resolution} · ${item.normalizedContext.durationSeconds}s · ${item.normalizedContext.aspectRatio}`
                                                : item.skipReason
                                                  ? "未满足完整验收条件"
                                                  : item.probe.message}
                                        </div>
                                        {item.auditFlags?.length ? <div className="mt-1 text-amber-700 dark:text-amber-300">{item.auditFlags.join(" · ")}</div> : null}
                                    </div>
                                    <Tag color={item.liveSelected ? "green" : "default"} style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                                        {item.liveSelected ? `${item.estimatedCredits ?? item.estimatedCostHotxCredits} HOTX` : skipMessages[item.skipReason || ""] || item.skipReason || item.probe.message}
                                    </Tag>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button type="primary" icon={<Play className="size-4" />} disabled={Boolean(overBudget) || (!preview.runnableModels && mode !== "contract_only")} onClick={start}>
                                开始验收
                            </Button>
                        </div>
                    </section>
                ) : null}
                {runs.length ? (
                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">最近验收</h3>
                        {runs.map((run) => (
                            <button
                                type="button"
                                key={run.id}
                                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                                onClick={async () => {
                                    try {
                                        setDetail(await getAdminVideoValidationRun(run.id));
                                    } catch (error) {
                                        message.error(error instanceof Error ? error.message : "读取验收详情失败");
                                    }
                                }}
                            >
                                <span className="font-mono">{run.id}</span>
                                <span>
                                    {run.mode} · {run.status} · {run.estimatedCostHotxCredits}/{run.maxBudgetHotxCredits} HOTX
                                </span>
                            </button>
                        ))}
                    </section>
                ) : null}
                {detail ? (
                    <VideoValidationRunDetails
                        detail={detail}
                        cancelling={loading}
                        onCancel={async () => {
                            setLoading(true);
                            try {
                                setDetail(await cancelAdminVideoValidationRun(detail.run.id));
                                await loadRuns();
                                message.success("已请求取消视频验收");
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "取消验收失败");
                            } finally {
                                setLoading(false);
                            }
                        }}
                    />
                ) : null}
            </div>
        </Panel>
    );
}

function Metric({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="mt-1 font-semibold tabular-nums">{value}</div>
        </div>
    );
}
