import { getAuthSettings } from "@/lib/auth/store";
import { nanoid } from "nanoid";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { systemAiIdempotencyKey, systemAiUsageRequestFingerprint } from "@/lib/server/system-ai-billing";
import { systemAiTextUsageContext } from "@/lib/server/generation-usage-context";
import { getAgentRun, updateAgentRunById, type AgentRun, type AgentRunPlannerAttempt } from "@/lib/server/agent-run-store";
import { agentPlannerSystemPrompt, agentPlanReply, buildAgentPlannerInput, conversationFallbackReply, plannerAgentSkills, prioritizeAgentPlannerModels, selectAgentSkills, taskPlanSummary } from "@/lib/server/agent-run-surface-policy";
import { getCreativeAssetsByIds, getCreativeConversationContext, listRecentCreativeMediaAssets } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { parseAgentPlanCall, type AgentFunctionCallResult } from "./agent-function-call";
import {
    agentGenerationRequest,
    agentModelOptions,
    agentTaskGenerationRequest,
    agentPlanFallbackExample,
    agentPlanTool,
    canContinue,
    directAgentPlan,
    executeTasks,
    filterAgentGenerationModels,
    normalizeTasks,
    planToOps,
    releaseFunctionCall,
    requestFunctionCall,
    resolveAgentTaskBinding,
    resolveAgentTaskWithFallback,
    validateManualAgentModels,
    voidFunctionCall,
} from "./agent-run-execution";
import { isExplicitProjectHandoffRequest, normalizeAgentProjectHandoff } from "./agent-run-project-handoff";
import { normalizeCanvasPlanForSelection } from "./agent-run-task-input";
import { preferredTextPlanningProtocol, rankTextPlanningCandidates, TextPlanningRequestError } from "@/lib/server/text-planning-runtime";
import { finishSystemAiTextAttempt, resolveSystemAiTextFailure } from "@/lib/server/usage-billing-runtime";
import { filterAgentPlannerModels } from "@/lib/server/agent-run-planning-profile";
import { buildAgentRunPlannerAudit } from "@/lib/server/agent-run-audit";
import { orderCreativeAssetsByIds } from "@/lib/creative-asset-references";

const globalAgentExecutors = globalThis as typeof globalThis & { __vozebProAgentRunControllers?: Map<string, AbortController> };
const controllers = (globalAgentExecutors.__vozebProAgentRunControllers ??= new Map<string, AbortController>());

export function abortAgentRun(id: string) {
    controllers.get(id)?.abort();
}

export async function executeAgentRun(run: AgentRun, origin: string, cookie: string) {
    abortAgentRun(run.id);
    const controller = new AbortController();
    const executionId = nanoid();
    let acceptedPlan: { userId: string; model: string; channelId: string; upstreamModel: string; call: AgentFunctionCallResult } | undefined;
    let planningPersisted = false;
    const releaseAcceptedPlan = async () => {
        if (!acceptedPlan || planningPersisted) return;
        await releaseFunctionCall(acceptedPlan.userId, acceptedPlan.call, "Agent 规划结果未持久化");
        acceptedPlan = undefined;
    };
    const settleAcceptedPlan = async () => {
        if (!acceptedPlan || planningPersisted) return;
        planningPersisted = true;
        if (acceptedPlan.call.usageHeaders) await finishSystemAiTextAttempt(acceptedPlan.call.usageHeaders, { status: "succeeded" });
    };
    controllers.set(run.id, controller);
    try {
        const claimed = await updateAgentRunById(
            run.id,
            { status: "running", executionId, timings: { ...(run.timings || { requestAcceptedAt: run.createdAt }), ...(run.tasks.length ? {} : { planningStartedAt: Date.now() }) } },
            { type: run.tasks.length ? "run.resumed" : "run.planning" },
            ["planning", "running"],
        );
        if (!claimed) return;
        if (claimed.tasks.length) {
            const settings = await getAuthSettings();
            await executeTasks(run.id, origin, cookie, executionId, settings);
            return;
        }
        const directModelSelection = Boolean(claimed.requestedModelIds?.length);
        const usesMemoryCandidates = !directModelSelection && claimed.surface === "chat" && claimed.referencedAssetIds.length === 0;
        const [settings, loadedExplicitAssets, conversationContext, memoryAssets] = await Promise.all([
            getAuthSettings(),
            getCreativeAssetsByIds(claimed.referencedAssetIds, claimed.userId),
            directModelSelection ? Promise.resolve(undefined) : getCreativeConversationContext(claimed.conversationId, claimed.userId, claimed.id),
            usesMemoryCandidates ? listRecentCreativeMediaAssets(claimed.conversationId, claimed.userId, 6) : Promise.resolve([]),
        ]);
        const explicitAssets = orderCreativeAssetsByIds(loadedExplicitAssets, claimed.referencedAssetIds);
        const referencedAssets = usesMemoryCandidates ? memoryAssets : explicitAssets;
        const generationRequest = agentGenerationRequest(
            claimed.generationPreferences,
            referencedAssets.map((asset) => asset.type),
        );
        const allModels = agentModelOptions(settings);
        const compatibleModels = filterAgentGenerationModels(allModels, generationRequest);
        const availableModels = prioritizeAgentPlannerModels(filterAgentPlannerModels(compatibleModels, claimed), claimed, settings);
        const skillOptions = plannerAgentSkills(settings, claimed);
        const skills = selectAgentSkills(settings, claimed.surface, claimed.selectedSkillIds);
        if (!(await canContinue(run.id, executionId))) return;
        if (claimed.requestedModelIds?.length) {
            const selectedModels = validateManualAgentModels(allModels, claimed.requestedModelIds, generationRequest);
            const plan = directAgentPlan(selectedModels, claimed.prompt, claimed.referencedAssetIds);
            const tasks = normalizeTasks(plan, skills, settings, claimed.snapshot, claimed.prompt, claimed.surface, explicitAssets, claimed.requestedImageSize, claimed.generationPreferences).map((task) => {
                if (task.type === "text" || !task.model) return task;
                const resolved = resolveAgentTaskBinding(allModels, task, task.model, settings.generationDefaults);
                if (resolved) return resolved;
                validateManualAgentModels(allModels, [task.model], agentTaskGenerationRequest(task));
                throw new Error("所选模型不支持当前生成参数");
            });
            await updateAgentRunById(run.id, {}, { type: "skills.selected", data: { skills: skills.map((skill) => ({ id: skill.id, name: skill.name })) } }, ["running"], executionId);
            const event = claimed.surface === "canvas" ? { type: "canvas.ops", data: { ops: planToOps(plan, tasks, run.id, claimed.snapshot), reply: plan.reply } } : { type: "run.planned", data: { reply: plan.reply, tasks: tasks.map(taskPlanSummary) } };
            await updateAgentRunById(
                run.id,
                { tasks, foundation: plan.foundation, reviewed: false, plannerAudit: buildAgentRunPlannerAudit({ mode: "direct", skills }), timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now() } },
                event,
                ["running"],
                executionId,
            );
            await executeTasks(run.id, origin, cookie, executionId, settings);
            return;
        }
        const referenceSource = claimed.referencedAssetIds.length ? "current-turn-explicit" : usesMemoryCandidates && referencedAssets.length ? "conversation-memory-candidates" : "none";
        const model = settings.defaultModels.textModel;
        const candidates = resolveLogicalModelCandidates(settings, "text", model);
        if (!model || !candidates.length) throw new Error("后台尚未配置可用的默认文本模型");
        const fallbackExample = agentPlanFallbackExample(availableModels);
        const plannerContext = buildAgentPlannerInput(claimed, conversationContext!, referencedAssets, referenceSource, skillOptions, availableModels, settings);
        if (!(await updateAgentRunById(run.id, { plannerContext: plannerContext.summary }, { type: "skills.selected", data: { skills: skills.map((skill) => ({ id: skill.id, name: skill.name })) } }, ["running"], executionId))) return;
        const planningInput = [
            {
                role: "system",
                content: agentPlannerSystemPrompt(claimed.surface, fallbackExample),
            },
            {
                role: "user",
                content: JSON.stringify(plannerContext.input),
            },
        ];
        const planningCycle = normalizedPlanningCycle(claimed.planningCycle);
        let plannerAttempts = claimed.plannerAttempts || [];
        const businessRequestId = systemAiIdempotencyKey("agent-plan", run.userId, run.id, String(planningCycle));
        const interruptedAttempt = plannerAttempts.find((attempt) => attempt.planningCycle === planningCycle && (attempt.status === "running" || attempt.status === "succeeded" || attempt.requestAcceptance === "unknown"));
        if (interruptedAttempt) {
            const succeededWithoutPlan = interruptedAttempt.status === "succeeded";
            if (interruptedAttempt.status === "running") {
                plannerAttempts = finishPlannerAttempt(plannerAttempts, interruptedAttempt.attemptNo, {
                    status: "failed",
                    requestAcceptance: "unknown",
                    error: "Agent 规划请求接收状态未知",
                });
                if (!(await updateAgentRunById(run.id, { plannerAttempts }, undefined, ["running"], executionId))) return;
            }
            await resolveSystemAiTextFailure({
                userId: run.userId,
                businessId: businessRequestId,
                reason: succeededWithoutPlan ? "Agent 规划结果未完整持久化" : interruptedAttempt.error || "Agent 规划请求接收状态未知",
                final: true,
                currentAttempt: { attemptNumber: planningCycleAttemptNumber(plannerAttempts, interruptedAttempt.attemptNo), acceptance: succeededWithoutPlan ? "response" : "unknown" },
            });
            throw new TextPlanningRequestError(succeededWithoutPlan ? "Agent 规划结果未完整持久化" : interruptedAttempt.error || "Agent 规划请求接收状态未知", 502, false, succeededWithoutPlan ? "response" : "unknown");
        }
        const requestFingerprint = systemAiUsageRequestFingerprint({ userId: run.userId, businessRequestId, logicalModel: model, capability: "text", payload: { input: planningInput, tool: agentPlanTool.name } });
        let plan: Awaited<ReturnType<typeof parseAgentPlanCall>> | undefined;
        let latestPlanningError: unknown;
        const rankedCandidates = rankTextPlanningCandidates(candidates.map((candidate) => ({ ...candidate, channelId: candidate.channel.id })));
        for (const candidate of rankedCandidates) {
            const previousAttempt = plannerAttempts.find((attempt) => attempt.planningCycle === planningCycle && samePlannerRoute(attempt, candidate));
            if (previousAttempt?.status === "failed" && previousAttempt.requestAcceptance === "response") {
                latestPlanningError = new Error(previousAttempt.error || "Agent 规划失败");
                continue;
            }
            const attemptNumber = plannerAttempts.filter((attempt) => attempt.planningCycle === planningCycle).length + 1;
            const usageContext = systemAiTextUsageContext({ candidate, userId: run.userId, logicalModelId: model, businessRequestId, requestFingerprint, attemptNumber });
            const auditAttemptNo = nextPlannerAttemptNo(plannerAttempts);
            const startedAt = Date.now();
            plannerAttempts = [
                ...plannerAttempts,
                {
                    attemptNo: auditAttemptNo,
                    planningCycle,
                    logicalModelId: model,
                    channelId: candidate.channel.id,
                    upstreamModel: candidate.upstreamModel,
                    protocol: preferredTextPlanningProtocol(candidate),
                    status: "running",
                    startedAt,
                },
            ];
            if (!(await updateAgentRunById(run.id, { plannerAttempts }, undefined, ["running"], executionId))) return;
            let receivedResponse = false;
            try {
                const planCall = await requestFunctionCall(origin, cookie, candidate, planningInput, agentPlanTool, "create_agent_plan", controller.signal, run.userId, model, false, usageContext);
                receivedResponse = true;
                plan = await parseAgentPlanCall(planCall, () => voidFunctionCall(planCall), undefined, {
                    allowProjectHandoff: claimed.surface === "chat" && isExplicitProjectHandoffRequest(claimed.prompt),
                    requiredGenerationMode: claimed.generationPreferences?.mode,
                });
                if (plan) {
                    acceptedPlan = { userId: claimed.userId, model, channelId: candidate.channel.id, upstreamModel: candidate.upstreamModel, call: planCall };
                    plannerAttempts = finishPlannerAttempt(plannerAttempts, auditAttemptNo, {
                        status: "succeeded",
                        requestAcceptance: "response",
                        protocol: planCall.protocol,
                        elapsedMs: planCall.elapsedMs,
                    });
                    if (!(await updateAgentRunById(run.id, { plannerAttempts }, undefined, ["running"], executionId))) {
                        await releaseAcceptedPlan();
                        return;
                    }
                }
                break;
            } catch (error) {
                if (controller.signal.aborted) throw error;
                latestPlanningError = error;
                const acceptance = receivedResponse ? "response" : error instanceof TextPlanningRequestError ? error.requestAcceptance : "unknown";
                const resolution = await resolveSystemAiTextFailure({
                    userId: run.userId,
                    businessId: businessRequestId,
                    reason: error instanceof Error ? error.message : "Agent 规划请求状态未知",
                    final: false,
                    currentAttempt: { attemptNumber, acceptance },
                });
                plannerAttempts = finishPlannerAttempt(plannerAttempts, auditAttemptNo, {
                    status: "failed",
                    requestAcceptance: acceptance,
                    error: safePlannerError(error),
                });
                if (!(await updateAgentRunById(run.id, { plannerAttempts }, undefined, ["running"], executionId))) return;
                if (resolution.state !== "safe_to_failover") throw error;
            }
        }
        if (!plan) {
            await resolveSystemAiTextFailure({ userId: run.userId, businessId: businessRequestId, reason: latestPlanningError instanceof Error ? latestPlanningError.message : "没有可用的文本模型渠道", final: true });
            throw latestPlanningError instanceof Error ? latestPlanningError : new Error("没有可用的文本模型渠道");
        }
        if (claimed.surface === "canvas") plan = normalizeCanvasPlanForSelection(plan, claimed.snapshot, claimed.prompt);
        const plannerAudit = buildAgentRunPlannerAudit({
            mode: "model",
            logicalModelId: model,
            channelId: acceptedPlan?.channelId,
            upstreamModel: acceptedPlan?.upstreamModel,
            protocol: acceptedPlan?.call.protocol,
            elapsedMs: acceptedPlan?.call.elapsedMs,
            pointsCost: acceptedPlan?.call.pointsCost,
            pointsRecordId: acceptedPlan?.call.pointsRecordId,
            skills,
        });
        if (!(await canContinue(run.id, executionId))) {
            await releaseAcceptedPlan();
            return;
        }
        if (plan.intent === "conversation") {
            const completed = await updateAgentRunById(
                run.id,
                {
                    status: "completed",
                    tasks: [],
                    reviewed: true,
                    plannerAudit,
                    plannerAttempts,
                    plannerFailure: undefined,
                    executionId: undefined,
                    timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now(), allResultsReadyAt: Date.now(), runCompletedAt: Date.now() },
                },
                { type: "run.completed", data: { completed: 0, reply: plan.reply?.trim() || conversationFallbackReply(claimed.surface) } },
                ["running"],
                executionId,
            );
            if (!completed) {
                await releaseAcceptedPlan();
                return;
            }
            await settleAcceptedPlan();
            return;
        }
        let tasks = normalizeTasks(plan, skills, settings, claimed.snapshot, claimed.prompt, claimed.surface, referencedAssets, claimed.requestedImageSize, claimed.generationPreferences);
        tasks = tasks.map((task) => {
            if (task.type === "text") return task;
            const fallback = task.type === "image" ? settings.defaultModels.imageModel : task.type === "video" ? settings.defaultModels.videoModel : settings.defaultModels.audioModel;
            const resolved = resolveAgentTaskWithFallback(allModels, task, fallback, settings.generationDefaults);
            if (!resolved) throw new Error(`没有兼容当前生成参数的${task.type === "image" ? "图片" : task.type === "video" ? "视频" : "音频"}模型`);
            return resolved;
        });
        plan = { ...plan, deliverables: plan.deliverables.map((deliverable, index) => ({ ...deliverable, ...(tasks[index]?.model ? { model: tasks[index].model } : {}) })) };
        const projectHandoff = normalizeAgentProjectHandoff(plan, claimed.surface, referencedAssets, claimed.prompt);
        const reply = agentPlanReply({ ...plan, projectHandoff }, tasks, claimed.surface);
        const event = claimed.surface === "canvas" ? { type: "canvas.ops", data: { ops: planToOps(plan, tasks, run.id, claimed.snapshot), reply } } : { type: "run.planned", data: { reply, tasks: tasks.map(taskPlanSummary), projectHandoff } };
        const planned = await updateAgentRunById(
            run.id,
            {
                tasks,
                foundation: plan.foundation,
                projectHandoff,
                reviewed: tasks.length ? claimed.reviewed : true,
                plannerAudit,
                plannerAttempts,
                plannerFailure: undefined,
                timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now() },
            },
            event,
            ["running"],
            executionId,
        );
        if (!planned) {
            await releaseAcceptedPlan();
            return;
        }
        await settleAcceptedPlan();
        await executeTasks(run.id, origin, cookie, executionId, settings);
    } catch (error) {
        let failure = error;
        try {
            await releaseAcceptedPlan();
        } catch (refundError) {
            console.error("Agent planning refund failed", refundError instanceof Error ? refundError.message : refundError);
            failure = refundError;
        }
        const latest = await getAgentRun(run.id);
        if (latest && !["paused", "cancelled"].includes(latest.status)) {
            const message = toSafeGenerationErrorMessage(failure, "Agent 执行失败");
            const plannerFailure = !latest.tasks.length && !latest.plannerAudit ? { message, failedAt: Date.now() } : latest.plannerFailure;
            await updateAgentRunById(
                run.id,
                { status: "failed", executionId: undefined, ...(plannerFailure ? { plannerFailure } : {}), timings: { ...(latest.timings || { requestAcceptedAt: latest.createdAt }), runCompletedAt: Date.now() } },
                { type: "run.failed", data: { message } },
                ["planning", "running"],
                executionId,
            );
        }
    } finally {
        if (controllers.get(run.id) === controller) controllers.delete(run.id);
    }
}

function normalizedPlanningCycle(value: number | undefined) {
    return Number.isSafeInteger(value) && value! > 0 ? value! : 1;
}

function nextPlannerAttemptNo(attempts: AgentRunPlannerAttempt[]) {
    return attempts.reduce((highest, attempt) => Math.max(highest, attempt.attemptNo), 0) + 1;
}

function planningCycleAttemptNumber(attempts: AgentRunPlannerAttempt[], attemptNo: number) {
    const target = attempts.find((attempt) => attempt.attemptNo === attemptNo);
    if (!target) return 1;
    const index = attempts
        .filter((attempt) => attempt.planningCycle === target.planningCycle)
        .toSorted((left, right) => left.attemptNo - right.attemptNo)
        .findIndex((attempt) => attempt.attemptNo === attemptNo);
    return Math.max(1, index + 1);
}

function samePlannerRoute(attempt: AgentRunPlannerAttempt, candidate: { channelId: string; upstreamModel: string }) {
    return attempt.channelId === candidate.channelId && attempt.upstreamModel.trim().toLowerCase() === candidate.upstreamModel.trim().toLowerCase();
}

function finishPlannerAttempt(attempts: AgentRunPlannerAttempt[], attemptNo: number, patch: Partial<AgentRunPlannerAttempt> & Pick<AgentRunPlannerAttempt, "status">) {
    const completedAt = Date.now();
    return attempts.map((attempt) =>
        attempt.attemptNo === attemptNo
            ? {
                  ...attempt,
                  ...patch,
                  completedAt,
                  elapsedMs: patch.elapsedMs ?? Math.max(0, completedAt - attempt.startedAt),
              }
            : attempt,
    );
}

function safePlannerError(error: unknown) {
    return toSafeGenerationErrorMessage(error, "Agent 规划失败");
}
