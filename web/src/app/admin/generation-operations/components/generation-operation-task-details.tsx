import { Tag, Tooltip } from "antd";

import type { AdminGenerationTask } from "@/lib/admin-generation-operations";
import { generationOperationThemeClasses } from "./generation-operations-theme";

export function AgentPlannerAuditSummary({ task }: { task: AdminGenerationTask }) {
    const audit = task.plannerAudit;
    if (!audit) return null;
    return (
        <div className="mt-1.5 space-y-1 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
            <div className="truncate">
                计划 Schema v{audit.schemaVersion} · {audit.mode === "direct" ? "用户直选模型" : planningProtocolLabel(audit.protocol)}
            </div>
            {audit.channelId || audit.upstreamModel ? (
                <Tooltip title={[audit.channelId, audit.upstreamModel].filter(Boolean).join(" → ")}>
                    <div className="truncate">{[audit.channelId, audit.upstreamModel].filter(Boolean).join(" → ")}</div>
                </Tooltip>
            ) : null}
            {audit.skills.length ? (
                <div className="flex min-w-0 flex-wrap gap-1">
                    {audit.skills.map((skill) => (
                        <Tooltip key={skill.id} title={skillSourceLabel(skill)}>
                            <Tag className={generationOperationThemeClasses.neutralTag}>{skill.name}</Tag>
                        </Tooltip>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function GenerationTaskRuntimeSummary({ task, compact = false }: { task: AdminGenerationTask; compact?: boolean }) {
    return (
        <div className={compact ? "mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900" : "space-y-1 text-xs text-zinc-500 dark:text-zinc-400"}>
            <div className="flex flex-wrap items-center gap-1.5">
                <Tag className={generationOperationThemeClasses.neutralTag}>{executionPhaseLabel(task.executionPhase)}</Tag>
                {task.leaseExpired ? <Tag className={generationOperationThemeClasses.reviewTag}>Worker 租约已过期</Tag> : null}
            </div>
            <div className={compact ? "mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs" : "mt-1 space-y-1"}>
                <RuntimeFact label="Worker" value={task.workerId || "未认领"} />
                <RuntimeFact label="心跳" value={operationTimeLabel(task.lastHeartbeatAt)} />
                <RuntimeFact label="租约" value={operationTimeLabel(task.leaseUntil)} />
                <RuntimeFact label="下次查询" value={operationTimeLabel(task.nextPollAt)} />
                {task.provider ? <RuntimeFact label="Provider" value={task.provider} /> : null}
                {task.queryPath ? <RuntimeFact label="查询路径" value={task.queryPath} /> : null}
            </div>
            <AgentPlannerAttemptTimeline task={task} />
        </div>
    );
}

export function GenerationRequestSummary({ task }: { task: AdminGenerationTask }) {
    return (
        <div className="space-y-2">
            <div>
                <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">请求摘要</div>
                <p className="mt-1 line-clamp-3 text-sm leading-5 text-zinc-700 dark:text-zinc-300">{task.prompt || "无请求摘要"}</p>
            </div>
            {task.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 dark:border-red-500/40 dark:bg-red-500/10">
                    <div className="text-[11px] font-medium text-red-600 dark:text-red-300">失败原因</div>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-red-700 dark:text-red-200">{task.error}</p>
                </div>
            ) : null}
        </div>
    );
}

function AgentPlannerAttemptTimeline({ task }: { task: AdminGenerationTask }) {
    if (!task.plannerAttempts?.length) return null;
    const firstAttemptByCycle = new Map<number, number>();
    task.plannerAttempts.forEach((attempt) => {
        if (!firstAttemptByCycle.has(attempt.planningCycle)) firstAttemptByCycle.set(attempt.planningCycle, attempt.attemptNo);
    });
    return (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">规划尝试</div>
            <div className="mt-2 space-y-2">
                {task.plannerAttempts.map((attempt) => (
                    <div key={`${attempt.planningCycle}:${attempt.attemptNo}`} className="rounded-md border border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Tag className={generationOperationThemeClasses.neutralTag}>
                                第 {attempt.planningCycle} 轮 · 尝试 {attempt.attemptNo} · {firstAttemptByCycle.get(attempt.planningCycle) === attempt.attemptNo ? "主路由" : "备用"}
                            </Tag>
                            <Tag className={attempt.status === "failed" ? "m-0 !border-red-200 !bg-red-50 !text-red-700 dark:!border-red-500/40 dark:!bg-red-500/10 dark:!text-red-200" : generationOperationThemeClasses.neutralTag}>
                                {attempt.status === "succeeded" ? "成功" : attempt.status === "failed" ? "失败" : "请求中"}
                            </Tag>
                        </div>
                        <Tooltip title={`${attempt.logicalModelId} · ${attempt.channelId} → ${attempt.upstreamModel}`}>
                            <div className="mt-1.5 truncate text-xs text-zinc-700 dark:text-zinc-300">
                                {attempt.logicalModelId} · {attempt.channelId} → {attempt.upstreamModel}
                            </div>
                        </Tooltip>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {planningProtocolLabel(attempt.protocol)} · {plannerElapsedLabel(attempt.elapsedMs)} · {attempt.requestAcceptance === "response" ? "已收到响应" : attempt.requestAcceptance === "unknown" ? "接收状态未知" : "等待响应"}
                        </div>
                        {attempt.error ? <div className="mt-1 text-[11px] leading-4 text-red-600 dark:text-red-300">{attempt.error}</div> : null}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function generationTaskPointsLabel(task: AdminGenerationTask) {
    const breakdown = task.pointsBreakdown;
    return breakdown ? `规划 ${breakdown.planner} · 子任务 ${breakdown.childTasks} · 合计 ${breakdown.total} 积分` : `${task.pointsCost} 积分`;
}

export function planningProtocolLabel(protocol?: "responses" | "chat" | "gemini" | "custom") {
    if (protocol === "responses") return "Responses";
    if (protocol === "gemini") return "Gemini";
    if (protocol === "custom") return "自定义协议";
    if (protocol === "chat") return "Chat Completions";
    return "未记录协议";
}

export function executionPhaseLabel(value?: AdminGenerationTask["executionPhase"]) {
    return ({ created: "已创建", submitting: "提交中", submitted: "已提交", polling: "查询结果", result_ready: "结果待保存", persisting: "保存结果", completed: "已结束" } as Record<string, string>)[value || ""] || "未记录阶段";
}

function RuntimeFact({ label, value }: { label: string; value: string }) {
    return (
        <Tooltip title={value}>
            <div className="min-w-0 truncate">
                <span className="text-zinc-400 dark:text-zinc-500">{label}：</span>
                {value}
            </div>
        </Tooltip>
    );
}

function operationTimeLabel(value?: number) {
    if (!value || !Number.isFinite(value)) return "未记录";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function plannerElapsedLabel(value?: number) {
    if (value === undefined || !Number.isFinite(value)) return "耗时未记录";
    if (value < 1000) return `${Math.max(0, Math.round(value))} 毫秒`;
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
}

function skillSourceLabel(skill: NonNullable<AdminGenerationTask["plannerAudit"]>["skills"][number]) {
    const source = [skill.sourceVersion ? `版本 ${skill.sourceVersion}` : "", skill.sourceCommit ? `提交 ${skill.sourceCommit}` : "", skill.sourceContentHash ? `内容哈希 ${skill.sourceContentHash}` : ""].filter(Boolean);
    return source.length ? source.join(" · ") : `Skill ID：${skill.id}`;
}
