import { getAuthSettings } from "@/lib/auth/store";
import { nanoid } from "nanoid";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { systemAiIdempotencyKey, systemAiUsageRequestFingerprint } from "@/lib/server/system-ai-billing";
import { systemAiTextUsageContext } from "@/lib/server/generation-usage-context";
import { getAgentRun, updateAgentRunById, type AgentRun } from "@/lib/server/agent-run-store";
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
import { GenerationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { rankTextPlanningCandidates, TextPlanningRequestError } from "@/lib/server/text-planning-runtime";
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
        const businessRequestId = systemAiIdempotencyKey("agent-plan", run.userId, run.id);
        const requestFingerprint = systemAiUsageRequestFingerprint({ userId: run.userId, businessRequestId, logicalModel: model, capability: "text", payload: { input: planningInput, tool: agentPlanTool.name } });
        let plan: Awaited<ReturnType<typeof parseAgentPlanCall>> | undefined;
        let latestPlanningError: unknown;
        const rankedCandidates = rankTextPlanningCandidates(candidates.map((candidate) => ({ ...candidate, channelId: candidate.channel.id })));
        for (const [index, candidate] of rankedCandidates.entries()) {
            const attemptNumber = index + 1;
            const usageContext = systemAiTextUsageContext({ candidate, userId: run.userId, logicalModelId: model, businessRequestId, requestFingerprint, attemptNumber });
            try {
                const planCall = await requestFunctionCall(origin, cookie, candidate, planningInput, agentPlanTool, "create_agent_plan", controller.signal, run.userId, model, false, usageContext);
                plan = await parseAgentPlanCall(planCall, () => voidFunctionCall(planCall), undefined, {
                    allowProjectHandoff: claimed.surface === "chat" && isExplicitProjectHandoffRequest(claimed.prompt),
                    requiredGenerationMode: claimed.generationPreferences?.mode,
                });
                if (plan) acceptedPlan = { userId: claimed.userId, model, channelId: candidate.channel.id, upstreamModel: candidate.upstreamModel, call: planCall };
                break;
            } catch (error) {
                if (controller.signal.aborted) throw error;
                if (error instanceof GenerationSubmissionUncertainError) throw error;
                latestPlanningError = error;
                const resolution = await resolveSystemAiTextFailure({
                    userId: run.userId,
                    businessId: businessRequestId,
                    reason: error instanceof Error ? error.message : "Agent 规划请求状态未知",
                    final: false,
                    currentAttempt: { attemptNumber, acceptance: error instanceof TextPlanningRequestError ? error.requestAcceptance : "response" },
                });
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
            { tasks, foundation: plan.foundation, projectHandoff, reviewed: tasks.length ? claimed.reviewed : true, plannerAudit, timings: { ...(claimed.timings || { requestAcceptedAt: claimed.createdAt }), planningCompletedAt: Date.now() } },
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
        if (latest && !["paused", "cancelled"].includes(latest.status))
            await updateAgentRunById(
                run.id,
                { status: "failed", executionId: undefined, timings: { ...(latest.timings || { requestAcceptedAt: latest.createdAt }), runCompletedAt: Date.now() } },
                { type: "run.failed", data: { message: toSafeGenerationErrorMessage(failure, "Agent 执行失败") } },
                ["planning", "running"],
                executionId,
            );
    } finally {
        if (controllers.get(run.id) === controller) controllers.delete(run.id);
    }
}
