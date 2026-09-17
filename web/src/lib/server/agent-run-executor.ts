import { getAuthSettings } from "@/lib/auth/store";
import { nanoid } from "nanoid";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { readSystemAiUsageBilling, systemAiIdempotencyKey, systemAiUsageRequestFingerprint, systemAiUsageResponseHeaders } from "@/lib/server/system-ai-billing";
import { systemAiTextUsageContext } from "@/lib/server/generation-usage-context";
import { getAgentRun, updateAgentRunById, updateAgentRunConversationContent, type AgentRun, type AgentRunPlannerAttempt, type AgentRunPlanningFinalization } from "@/lib/server/agent-run-store";
import {
    agentPlannerSystemPrompt,
    agentPlanReply,
    buildAgentPlannerInput,
    conversationFallbackReply,
    isDirectAgentIdentityQuestion,
    plannerAgentSkills,
    prioritizeAgentPlannerModels,
    selectAgentSkills,
    taskPlanSummary,
} from "@/lib/server/agent-run-surface-policy";
import { getCreativeAssetsByIds, getCreativeConversationContext, listRecentCreativeMediaAssets } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { parseAgentPlanCall, type AgentFunctionCallResult } from "./agent-function-call";
import {
    agentGenerationRequest,
    agentModelOptions,
    agentTaskGenerationRequest,
    agentPlanFallbackExample,
    agentPlanTool,
    agentTextPlanFallbackExample,
    agentTextPlanTool,
    canContinue,
    directAgentPlan,
    executeTasks,
    filterAgentGenerationModels,
    normalizeTasks,
    planToOps,
    releaseFunctionCall,
    requestFunctionCall,
    requestRoutedFunctionCall,
    resolveAgentTaskBinding,
    resolveAgentTaskWithFallback,
    validateManualAgentModels,
    voidFunctionCall,
} from "./agent-run-execution";
import { isExplicitProjectHandoffRequest, normalizeAgentProjectHandoff } from "./agent-run-project-handoff";
import { normalizeCanvasPlanForSelection } from "./agent-run-task-input";
import { preferredTextPlanningProtocol, TextPlanningRequestError } from "@/lib/server/text-planning-runtime";
import { acquirePlannerProviderRoute, rankPlannerProviderCandidates, releasePlannerProviderRoute, reportPlannerProviderFailure, reportPlannerProviderSuccess } from "@/lib/server/provider-health-runtime";
import { classifyProviderHealthFailure } from "@/lib/server/provider-health";
import { finishSystemAiTextAttempt, resolveSystemAiTextFailure } from "@/lib/server/usage-billing-runtime";
import { filterAgentPlannerModels, resolveAgentPlanningProfile } from "@/lib/server/agent-run-planning-profile";
import { buildAgentRunPlannerAudit } from "@/lib/server/agent-run-audit";
import { orderCreativeAssetsByIds } from "@/lib/creative-asset-references";
import { generationTaskNextPollAt, scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";

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
    let acceptedPlanPersisted = false;
    const releaseAcceptedPlan = async () => {
        if (!acceptedPlan || acceptedPlanPersisted) return;
        await releaseFunctionCall(acceptedPlan.userId, acceptedPlan.call, "Agent 规划结果未持久化");
        acceptedPlan = undefined;
    };
    const acceptedPlanFinalization = () => plannerFinalization(acceptedPlan?.call.usageHeaders, normalizedPlanningCycle(run.planningCycle));
    controllers.set(run.id, controller);
    try {
        const executionStartedAt = Date.now();
        const claimed = await updateAgentRunById(
            run.id,
            { status: "running", executionId, timings: { ...(run.timings || { requestAcceptedAt: run.createdAt }), executionStartedAt, ...(run.tasks.length ? {} : { planningStartedAt: executionStartedAt }) } },
            { type: run.tasks.length ? "run.resumed" : "run.planning" },
            ["planning", "running"],
        );
        if (!claimed) return;
        if (claimed.planningFinalization && claimed.responseKind === "conversation" && claimed.conversationReply?.trim()) {
            await scheduleConversationFinalization(run.id, claimed.planningFinalization);
            await completePersistedConversation(run.id, claimed, executionId, executionStartedAt);
            await reconcileAgentPlannerFinalization(run.id);
            return;
        }
        if (claimed.tasks.length) {
            const settings = await getAuthSettings();
            if (claimed.planningFinalization && !(await settlePlannerFinalization(run.id, claimed.planningFinalization, executionId))) return;
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
            const plannedAt = Date.now();
            const reply = agentPlanReply(plan, tasks, claimed.surface, claimed.responseLocale);
            const event = claimed.surface === "canvas" ? { type: "canvas.ops", data: { ops: planToOps(plan, tasks, run.id, claimed.snapshot), reply } } : { type: "run.planned", data: { reply, tasks: tasks.map(taskPlanSummary) } };
            await updateAgentRunById(
                run.id,
                {
                    tasks,
                    responseKind: "generation",
                    foundation: plan.foundation,
                    reviewed: false,
                    plannerAudit: buildAgentRunPlannerAudit({ mode: "direct", skills }),
                    timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), firstPublicReplyAt: claimed.timings?.firstPublicReplyAt || plannedAt, planningCompletedAt: plannedAt },
                },
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
        const planningProfile = resolveAgentPlanningProfile(claimed);
        const compactTextPlanner = planningProfile.complexity === "ordinary" && planningProfile.capabilities.size === 1 && planningProfile.capabilities.has("text");
        const planTool = compactTextPlanner ? agentTextPlanTool : agentPlanTool;
        const fallbackExample = compactTextPlanner ? agentTextPlanFallbackExample(availableModels) : agentPlanFallbackExample(availableModels);
        const plannerContext = buildAgentPlannerInput(claimed, conversationContext!, referencedAssets, referenceSource, skillOptions, availableModels, settings);
        if (!(await updateAgentRunById(run.id, { plannerContext: plannerContext.summary }, { type: "skills.selected", data: { skills: skills.map((skill) => ({ id: skill.id, name: skill.name })) } }, ["running"], executionId))) return;
        const identitySiteTitle = isDirectAgentIdentityQuestion(claimed.prompt) ? settings.site?.title?.trim() || "HOTX AI" : undefined;
        const planningInput = [
            {
                role: "system",
                content: agentPlannerSystemPrompt(claimed.surface, fallbackExample, { siteTitle: identitySiteTitle, responseLocale: claimed.responseLocale, compactText: compactTextPlanner }),
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
        const requestFingerprint = systemAiUsageRequestFingerprint({ userId: run.userId, businessRequestId, logicalModel: model, capability: "text", payload: { input: planningInput, tool: planTool.name } });
        const routedChat = claimed.surface === "chat" && !claimed.generationPreferences?.mode && !claimed.selectedSkillIds?.length;
        let plan: Awaited<ReturnType<typeof parseAgentPlanCall>> | undefined;
        let conversationReply: string | undefined;
        let acceptedRequestStartedAt: number | undefined;
        let acceptedFirstByteMs: number | undefined;
        let acceptedFirstContentMs: number | undefined;
        let latestPlanningError: unknown;
        const rankedCandidates = await rankPlannerProviderCandidates(candidates.map((candidate) => ({ ...candidate, channelId: candidate.channel.id })));
        for (const candidate of rankedCandidates) {
            const previousAttempt = plannerAttempts.find((attempt) => attempt.planningCycle === planningCycle && samePlannerRoute(attempt, candidate));
            if (previousAttempt?.status === "failed" && previousAttempt.requestAcceptance === "response") {
                latestPlanningError = new Error(previousAttempt.error || "Agent 规划失败");
                continue;
            }
            const routeDecision = await acquirePlannerProviderRoute(candidate);
            if (!routeDecision.eligible) continue;
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
            if (!(await updateAgentRunById(run.id, { plannerAttempts, timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), executionStartedAt, upstreamRequestStartedAt: startedAt } }, undefined, ["running"], executionId))) {
                await releasePlannerProviderRoute(candidate);
                return;
            }
            let receivedResponse = false;
            let streamedConversationContent = "";
            let routedResponseHeaders: Headers | undefined;
            let observedFirstByteMs: number | undefined;
            let observedFirstContentMs: number | undefined;
            let providerOutcomeObserved = false;
            let plannerValidationInProgress = false;
            try {
                const planCall = routedChat
                    ? await requestRoutedFunctionCall(
                          origin,
                          cookie,
                          candidate,
                          planningInput,
                          planTool,
                          controller.signal,
                          model,
                          usageContext,
                          async (content, firstContentMs) => {
                              streamedConversationContent = content;
                              observedFirstContentMs ??= firstContentMs ?? Date.now() - startedAt;
                              if (!(await updateAgentRunConversationContent(run.id, content, executionId))) throw new Error("Agent 对话流已停止");
                          },
                          (headers) => {
                              routedResponseHeaders = headers;
                          },
                          async (firstByteMs) => {
                              observedFirstByteMs ??= firstByteMs;
                              if (
                                  !(await updateAgentRunById(
                                      run.id,
                                      {
                                          timings: {
                                              ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }),
                                              executionStartedAt,
                                              upstreamRequestStartedAt: startedAt,
                                              upstreamFirstByteAt: startedAt + firstByteMs,
                                          },
                                      },
                                      undefined,
                                      ["running"],
                                      executionId,
                                  ))
                              )
                                  throw new Error("Agent 对话流已停止");
                          },
                      )
                    : await requestFunctionCall(origin, cookie, candidate, planningInput, planTool, "create_agent_plan", controller.signal, run.userId, model, false, usageContext);
                receivedResponse = true;
                await reportPlannerProviderSuccess(candidate);
                providerOutcomeObserved = true;
                if ("kind" in planCall && planCall.kind === "conversation") {
                    conversationReply = planCall.content.trim();
                    acceptedPlan = { userId: claimed.userId, model, channelId: candidate.channel.id, upstreamModel: candidate.upstreamModel, call: planCall };
                    acceptedRequestStartedAt = startedAt;
                    acceptedFirstByteMs = planCall.firstByteMs;
                    acceptedFirstContentMs = planCall.firstContentMs;
                    plannerAttempts = finishPlannerAttempt(plannerAttempts, auditAttemptNo, {
                        status: "succeeded",
                        requestAcceptance: "response",
                        protocol: planCall.protocol,
                        elapsedMs: planCall.elapsedMs,
                        firstByteMs: planCall.firstByteMs,
                        firstContentMs: planCall.firstContentMs,
                        resultKind: "conversation",
                    });
                } else {
                    plannerValidationInProgress = true;
                    plan = await parseAgentPlanCall(planCall, () => voidFunctionCall(planCall), undefined, {
                        allowProjectHandoff: claimed.surface === "chat" && isExplicitProjectHandoffRequest(claimed.prompt),
                        requiredGenerationMode: claimed.generationPreferences?.mode,
                        allowedDeliverableTypes: planningProfile.requiredDeliverableType ? [planningProfile.requiredDeliverableType] : undefined,
                    });
                    plannerValidationInProgress = false;
                    if (plan) {
                        const firstContentMs = "firstContentMs" in planCall ? planCall.firstContentMs : undefined;
                        acceptedPlan = { userId: claimed.userId, model, channelId: candidate.channel.id, upstreamModel: candidate.upstreamModel, call: planCall };
                        acceptedRequestStartedAt = startedAt;
                        acceptedFirstByteMs = planCall.firstByteMs;
                        acceptedFirstContentMs = firstContentMs;
                        plannerAttempts = finishPlannerAttempt(plannerAttempts, auditAttemptNo, {
                            status: "succeeded",
                            requestAcceptance: "response",
                            protocol: planCall.protocol,
                            elapsedMs: planCall.elapsedMs,
                            firstByteMs: planCall.firstByteMs,
                            firstContentMs,
                            resultKind: plan.intent,
                        });
                    }
                }
                if (conversationReply || plan) {
                    if (!(await updateAgentRunById(run.id, { plannerAttempts }, undefined, ["running"], executionId))) {
                        await releaseAcceptedPlan();
                        return;
                    }
                }
                break;
            } catch (error) {
                if (!providerOutcomeObserved && error instanceof TextPlanningRequestError && error.protocolCompleted) {
                    await reportPlannerProviderSuccess(candidate);
                    providerOutcomeObserved = true;
                    console.info("planner_invalid_plan", { workloadScope: "planner", channelId: candidate.channel.id, model: candidate.upstreamModel, error: safePlannerError(error) });
                } else if (providerOutcomeObserved && plannerValidationInProgress) {
                    console.info("planner_invalid_plan", { workloadScope: "planner", channelId: candidate.channel.id, model: candidate.upstreamModel, error: safePlannerError(error) });
                } else {
                    const healthFailure = {
                        error,
                        status: error instanceof TextPlanningRequestError ? error.status : undefined,
                        providerError: error instanceof TextPlanningRequestError ? error.providerError : undefined,
                        cancelled: controller.signal.aborted,
                    };
                    if (classifyProviderHealthFailure(healthFailure).countsTowardCircuit) await reportPlannerProviderFailure(candidate, healthFailure);
                    else await releasePlannerProviderRoute(candidate);
                    providerOutcomeObserved = true;
                }
                const routedResponseIsSse = routedResponseHeaders?.get("content-type")?.toLowerCase().includes("text/event-stream");
                if (routedResponseHeaders && (!routedResponseIsSse || error instanceof TextPlanningRequestError)) {
                    await finishSystemAiTextAttempt(routedResponseHeaders, { status: controller.signal.aborted ? "canceled" : "failed" });
                }
                if (controller.signal.aborted) {
                    await resolveSystemAiTextFailure({
                        userId: run.userId,
                        businessId: businessRequestId,
                        reason: "Agent 对话已取消",
                        final: true,
                        currentAttempt: { attemptNumber, acceptance: routedResponseHeaders ? "response" : "unknown" },
                    });
                    throw error;
                }
                latestPlanningError = error;
                const acceptance = receivedResponse || routedResponseHeaders || streamedConversationContent ? "response" : error instanceof TextPlanningRequestError ? error.requestAcceptance : "unknown";
                const resolution = await resolveSystemAiTextFailure({
                    userId: run.userId,
                    businessId: businessRequestId,
                    reason: error instanceof Error ? error.message : "Agent 规划请求状态未知",
                    final: Boolean(streamedConversationContent),
                    currentAttempt: { attemptNumber, acceptance },
                });
                plannerAttempts = finishPlannerAttempt(plannerAttempts, auditAttemptNo, {
                    status: "failed",
                    requestAcceptance: acceptance,
                    error: safePlannerError(error),
                    ...(observedFirstByteMs !== undefined ? { firstByteMs: observedFirstByteMs } : {}),
                    ...(observedFirstContentMs !== undefined ? { firstContentMs: observedFirstContentMs } : {}),
                    ...(streamedConversationContent ? { resultKind: "conversation" as const } : {}),
                });
                if (!(await updateAgentRunById(run.id, { plannerAttempts }, undefined, ["running"], executionId))) return;
                if (streamedConversationContent) throw error;
                if (resolution.state !== "safe_to_failover") throw error;
            }
        }
        if (!plan && !conversationReply) {
            await resolveSystemAiTextFailure({ userId: run.userId, businessId: businessRequestId, reason: latestPlanningError instanceof Error ? latestPlanningError.message : "没有可用的文本模型渠道", final: true });
            throw latestPlanningError instanceof Error ? latestPlanningError : new Error("没有可用的文本模型渠道");
        }
        if (claimed.surface === "canvas" && plan) plan = normalizeCanvasPlanForSelection(plan, claimed.snapshot, claimed.prompt);
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
        if (conversationReply) {
            const completedAt = Date.now();
            const finalization = acceptedPlanFinalization();
            const persisted = await updateAgentRunById(
                run.id,
                {
                    responseKind: "conversation",
                    conversationReply,
                    tasks: [],
                    reviewed: true,
                    plannerAudit,
                    plannerAttempts,
                    plannerFailure: undefined,
                    planningFinalization: finalization,
                    failureStage: undefined,
                    timings: {
                        ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }),
                        executionStartedAt,
                        ...(acceptedRequestStartedAt ? { upstreamRequestStartedAt: acceptedRequestStartedAt } : {}),
                        ...(acceptedRequestStartedAt !== undefined && acceptedFirstByteMs !== undefined ? { upstreamFirstByteAt: acceptedRequestStartedAt + acceptedFirstByteMs } : {}),
                        firstPublicReplyAt: claimed.timings?.firstPublicReplyAt || (acceptedRequestStartedAt !== undefined && acceptedFirstContentMs !== undefined ? acceptedRequestStartedAt + acceptedFirstContentMs : completedAt),
                        planningCompletedAt: completedAt,
                        ...(finalization ? { plannerSettlementStartedAt: completedAt } : {}),
                    },
                },
                undefined,
                ["running"],
                executionId,
            );
            if (!persisted) {
                await releaseAcceptedPlan();
                return;
            }
            acceptedPlanPersisted = true;
            await scheduleConversationFinalization(run.id, finalization);
            await completePersistedConversation(run.id, persisted, executionId, executionStartedAt);
            if (finalization) await reconcileAgentPlannerFinalization(run.id);
            return;
        }
        if (!plan) throw new Error("没有可用的文本模型渠道");
        if (plan.intent === "conversation") {
            const completedAt = Date.now();
            const finalization = acceptedPlanFinalization();
            const persisted = await updateAgentRunById(
                run.id,
                {
                    responseKind: "conversation",
                    conversationReply: plan.reply?.trim() || conversationFallbackReply(claimed.surface, claimed.responseLocale),
                    tasks: [],
                    reviewed: true,
                    plannerAudit,
                    plannerAttempts,
                    plannerFailure: undefined,
                    planningFinalization: finalization,
                    failureStage: undefined,
                    timings: {
                        ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }),
                        executionStartedAt,
                        ...(acceptedRequestStartedAt ? { upstreamRequestStartedAt: acceptedRequestStartedAt } : {}),
                        ...(acceptedRequestStartedAt !== undefined && acceptedFirstByteMs !== undefined ? { upstreamFirstByteAt: acceptedRequestStartedAt + acceptedFirstByteMs } : {}),
                        firstPublicReplyAt: claimed.timings?.firstPublicReplyAt || completedAt,
                        planningCompletedAt: completedAt,
                        ...(finalization ? { plannerSettlementStartedAt: completedAt } : {}),
                    },
                },
                undefined,
                ["running"],
                executionId,
            );
            if (!persisted) {
                await releaseAcceptedPlan();
                return;
            }
            acceptedPlanPersisted = true;
            await scheduleConversationFinalization(run.id, finalization);
            await completePersistedConversation(run.id, persisted, executionId, executionStartedAt);
            if (finalization) await reconcileAgentPlannerFinalization(run.id);
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
        const reply = agentPlanReply({ ...plan, projectHandoff }, tasks, claimed.surface, claimed.responseLocale);
        const event = claimed.surface === "canvas" ? { type: "canvas.ops", data: { ops: planToOps(plan, tasks, run.id, claimed.snapshot), reply } } : { type: "run.planned", data: { reply, tasks: tasks.map(taskPlanSummary), projectHandoff } };
        const planningCompletedAt = Date.now();
        const finalization = acceptedPlanFinalization();
        const planned = await updateAgentRunById(
            run.id,
            {
                tasks,
                responseKind: "generation",
                conversationReply: undefined,
                foundation: plan.foundation,
                projectHandoff,
                reviewed: tasks.length ? claimed.reviewed : true,
                plannerAudit,
                plannerAttempts,
                plannerFailure: undefined,
                planningFinalization: finalization,
                failureStage: undefined,
                timings: {
                    ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }),
                    executionStartedAt,
                    ...(acceptedRequestStartedAt ? { upstreamRequestStartedAt: acceptedRequestStartedAt } : {}),
                    ...(acceptedRequestStartedAt !== undefined && acceptedFirstByteMs !== undefined ? { upstreamFirstByteAt: acceptedRequestStartedAt + acceptedFirstByteMs } : {}),
                    firstPublicReplyAt: claimed.timings?.firstPublicReplyAt || planningCompletedAt,
                    planningCompletedAt,
                    ...(finalization ? { plannerSettlementStartedAt: planningCompletedAt } : {}),
                },
            },
            event,
            ["running"],
            executionId,
        );
        if (!planned) {
            await releaseAcceptedPlan();
            return;
        }
        acceptedPlanPersisted = true;
        if (finalization && !(await settlePlannerFinalization(run.id, finalization, executionId))) return;
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
            const partialConversation = latest.responseKind === "conversation" && Boolean(latest.conversationReply?.trim());
            const plannerFailure = !latest.tasks.length && !latest.plannerAudit ? { message, failedAt: Date.now() } : latest.plannerFailure;
            const failureStage = latest.failureStage || (!latest.tasks.length ? "planning" : latest.tasks.every((task) => task.status === "ready" && !task.taskId && !task.taskIds?.length) ? "task_dispatch" : "task_execution");
            await updateAgentRunById(
                run.id,
                { status: "failed", executionId: undefined, failureStage, ...(plannerFailure ? { plannerFailure } : {}), timings: { ...(latest.timings || { requestAcceptedAt: latest.createdAt }), runCompletedAt: Date.now() } },
                { type: "run.failed", data: { message: partialConversation ? latest.conversationReply!.trim() : message, responseLocale: latest.responseLocale, ...(partialConversation ? { partialConversation: true } : {}) } },
                ["planning", "running"],
                executionId,
            );
        }
    } finally {
        if (controllers.get(run.id) === controller) controllers.delete(run.id);
    }
}

function plannerFinalization(headers: Headers | undefined, planningCycle: number): AgentRunPlanningFinalization | undefined {
    if (!headers) return undefined;
    const identity = readSystemAiUsageBilling(headers);
    return identity ? { planningCycle, status: "pending", ...identity, updatedAt: Date.now() } : undefined;
}

async function settlePlannerFinalization(runId: string, finalization: AgentRunPlanningFinalization, executionId?: string, allowedStatuses: AgentRun["status"][] = ["running"]) {
    if (finalization.status === "settled") return true;
    try {
        if (!finalization.requestFingerprint) throw Object.assign(new Error("Agent 规划用量结算标识不完整"), { code: "billing_identity_missing" });
        const headers = new Headers(
            systemAiUsageResponseHeaders({
                holdId: finalization.holdId,
                attemptNumber: finalization.attemptNumber,
                requestFingerprint: finalization.requestFingerprint,
            }),
        );
        await finishSystemAiTextAttempt(headers, { status: "succeeded" });
        const completedAt = Date.now();
        return Boolean(
            await updateAgentRunById(
                runId,
                {
                    planningFinalization: { ...finalization, status: "settled", errorCode: undefined, error: undefined, retryable: undefined, updatedAt: completedAt },
                    failureStage: undefined,
                    timings: { ...((await getAgentRun(runId))?.timings || { requestAcceptedAt: completedAt }), plannerSettlementCompletedAt: completedAt },
                },
                undefined,
                allowedStatuses,
                executionId,
            ),
        );
    } catch (error) {
        const failure = plannerFinalizationFailure(error);
        await updateAgentRunById(runId, { planningFinalization: { ...finalization, status: "failed", ...failure, updatedAt: Date.now() }, failureStage: "planner_settlement" }, undefined, allowedStatuses, executionId);
        if (failure.retryable) return false;
        throw error;
    }
}

async function scheduleConversationFinalization(runId: string, finalization?: AgentRunPlanningFinalization) {
    if (!finalization) return;
    const now = Date.now();
    await scheduleGenerationTask("agent", runId, { executionPhase: "persisting", nextPollAt: generationTaskNextPollAt({ consecutiveErrors: 0, now }), lastPollAt: now, lastUpstreamStatus: "planner_settlement_pending" });
}

export async function reconcileAgentPlannerFinalization(runId: string) {
    const run = await getAgentRun(runId);
    const finalization = run?.planningFinalization;
    if (!run || run.status !== "completed" || !finalization || finalization.status === "settled") return true;
    if (finalization.status === "failed" && finalization.retryable === false) return false;
    return settlePlannerFinalization(runId, finalization, undefined, ["completed"]);
}

async function completePersistedConversation(runId: string, run: AgentRun, executionId: string, executionStartedAt: number) {
    const completedAt = Date.now();
    const latest = (await getAgentRun(runId)) || run;
    const reply = latest.conversationReply?.trim() || conversationFallbackReply(latest.surface, latest.responseLocale);
    return updateAgentRunById(
        runId,
        {
            status: "completed",
            executionId: undefined,
            reviewed: true,
            failureStage: undefined,
            timings: {
                ...(latest.timings || { requestAcceptedAt: latest.createdAt }),
                executionStartedAt,
                allResultsReadyAt: completedAt,
                runCompletedAt: completedAt,
            },
        },
        { type: "run.completed", data: { completed: 0, reply } },
        ["running"],
        executionId,
    );
}

function plannerFinalizationFailure(error: unknown) {
    const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
    const message = toSafeGenerationErrorMessage(error, "Agent 规划用量结算失败");
    const errorCode = typeof record.code === "string" && record.code.trim() ? record.code.trim().slice(0, 120) : error instanceof Error && error.name ? error.name.slice(0, 120) : "planner_settlement_error";
    const status = Number(record.status);
    const retryable = record.name !== "UsageBillingIntegrityError" && errorCode !== "billing_identity_missing" && ![400, 401, 403, 409, 422].includes(status);
    return { errorCode, error: message, retryable };
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
