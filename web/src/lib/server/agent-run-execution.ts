import { getAuthSettings, type LogicalModelCapability, type LogicalModelGenerationParameters } from "@/lib/auth/store";
import { withCreativeFoundation, type CreativeReview } from "@/lib/creative-agent-contract";
import type { CreativeAsset, CreativeGenerationPreferences, CreativeSurface } from "@/lib/creative-runtime-contract";
import { unionGenerationParameters, type NormalizedGenerationRequest } from "@/lib/generation-parameters";
import { creativeAssetReferenceAliases } from "@/lib/creative-asset-references";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { resolveLogicalModel, resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { audioGenerationRequest, filterGenerationCandidates, imageGenerationRequest, resolveAudioGenerationCandidates, resolveImageGenerationCandidates, resolveVideoGenerationCandidates, videoGenerationRequest } from "@/lib/server/capability-constraints";
import { reviewCreativeOutputs } from "@/lib/server/creative-review-service";
import { requestStructuredText, type TextPlanningCandidate } from "@/lib/server/text-planning-runtime";
import { registerAgentTaskAssets } from "@/lib/server/agent-run-assets";
import { buildAgentProjectHandoff } from "@/lib/server/agent-run-project-handoff";
import { getAgentRun, updateAgentRunById, updateAgentRunTaskById, type AgentRun, type AgentRunChildSlot, type AgentRunChildTask, type AgentRunGenerationSelection, type AgentRunReference, type AgentRunTask } from "@/lib/server/agent-run-store";
import { assetAccessUrl, creativeAssetContext, resolveTaskReferences } from "@/lib/server/agent-run-surface-policy";
import { selectedCanvasNodeIds } from "@/lib/server/agent-run-canvas-snapshot";
import { agentChildTaskTerminal, agentTaskCopies, validateAgentTaskResult, type AgentPlan } from "@/lib/server/agent-run-validation";
import { agentRunCompletionReply, agentRunFailureMessage, resultSummary } from "@/lib/server/agent-run-messages";
import { getCreativeAssetsByIds } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { linkStoredGenerationTask } from "@/lib/server/generation-task-store";
import { maintenanceWorkerContextHeaders } from "@/lib/server/maintenance-auth";
import { videoFrameAssetIds, type VideoReferenceRole } from "@/lib/video-reference-contract";
import type { AgentFunctionCallResult } from "./agent-function-call";
import { agentSurfaceImageSize, canvasReferenceContext, canvasReferenceSupportsTask, canvasSnapshotNodes, isMediaReferenceType, resolveAgentTaskRatio, resolveCanvasTaskTargetNodeId, selectedCanvasReferenceNodes } from "./agent-run-task-input";
import { readSystemAiBilling, systemAiBillingHeaders, type SystemAiUsageContextDraft } from "./system-ai-billing";
import { finishSystemAiTextAttempt, resolveSystemAiTextFailure } from "./usage-billing-runtime";
import { acceptsMediaReference, mergeTaskReferences, taskImageUrls, taskReferences, textConstraintInstruction } from "./agent-run-execution-helpers";

export { planToOps, taskResultOps } from "./agent-run-canvas-ops";
export { acceptsMediaReference, mergeTaskReferences, requestedTextLimit, reviewCorrection, taskImageUrls, taskReferences, taskResultItems, textConstraintInstruction } from "./agent-run-execution-helpers";

class AgentChildTaskTerminalError extends Error {}
class AgentChildTaskDeferredError extends Error {}

export async function canContinue(id: string, executionId: string) {
    const run = await getAgentRun(id);
    return Boolean(run && run.executionId === executionId && !["paused", "cancelled", "completed"].includes(run.status));
}

export const agentPlanTool = {
    type: "function",
    name: "create_agent_plan",
    description: "创建创作计划",
    parameters: {
        type: "object",
        properties: {
            intent: { type: "string", enum: ["conversation", "generation"] },
            objective: { type: "string" },
            audience: { type: "string" },
            reply: { type: "string" },
            skillIds: { type: "array", items: { type: "string" } },
            decisions: {
                type: "array",
                items: {
                    type: "object",
                    properties: { label: { type: "string" }, value: { type: "string" }, reason: { type: "string" } },
                    required: ["label", "value", "reason"],
                    additionalProperties: false,
                },
            },
            foundation: {
                type: "object",
                properties: {
                    complexity: { type: "string", enum: ["simple", "complex"] },
                    brief: {
                        type: "object",
                        properties: {
                            objective: { type: "string" },
                            audience: { type: "string" },
                            usage: { type: "string" },
                            coreMessage: { type: "string" },
                            constraints: { type: "array", items: { type: "string" } },
                            referenceStrategy: { type: "string" },
                        },
                        required: ["objective"],
                        additionalProperties: false,
                    },
                    direction: {
                        type: "object",
                        properties: {
                            summary: { type: "string" },
                            style: { type: "string" },
                            composition: { type: "string" },
                            colors: { type: "array", items: { type: "string" } },
                            lighting: { type: "string" },
                            keywords: { type: "array", items: { type: "string" } },
                            avoid: { type: "array", items: { type: "string" } },
                        },
                        required: ["summary"],
                        additionalProperties: false,
                    },
                },
                required: ["complexity", "brief", "direction"],
                additionalProperties: false,
            },
            brand: {
                type: "object",
                properties: { summary: { type: "string" }, colors: { type: "array", items: { type: "string" } }, visualKeywords: { type: "array", items: { type: "string" } } },
                additionalProperties: false,
            },
            projectHandoff: {
                type: "object",
                properties: {
                    surface: { type: "string", enum: ["canvas", "drama"] },
                    title: { type: "string" },
                    summary: { type: "string" },
                    style: { type: "string" },
                    ratio: { type: "string", enum: ["9:16", "16:9"] },
                    assetIds: { type: "array", items: { type: "string" } },
                },
                required: ["surface", "title"],
                additionalProperties: false,
            },
            deliverables: {
                type: "array",
                minItems: 0,
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string" },
                        id: { type: "string" },
                        targetNodeId: { type: "string" },
                        type: { type: "string", enum: ["text", "image", "video", "audio"] },
                        model: { type: "string" },
                        prompt: { type: "string" },
                        count: { type: "integer", minimum: 1 },
                        ratio: { type: "string" },
                        quality: { type: "string" },
                        seconds: { type: "number", minimum: 1 },
                        voice: { type: "string" },
                        format: { type: "string" },
                        generateAudio: { type: "boolean" },
                        watermark: { type: "boolean" },
                        speed: { type: "number", exclusiveMinimum: 0 },
                        dependencies: { type: "array", items: { type: "string" } },
                        assetIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["title", "type", "model", "prompt"],
                    additionalProperties: false,
                },
            },
        },
        required: ["intent", "objective", "reply", "decisions", "foundation", "deliverables"],
        additionalProperties: false,
    },
};

export function normalizeTasks(
    plan: AgentPlan,
    skills: Awaited<ReturnType<typeof getAuthSettings>>["agentSkills"],
    settings: Awaited<ReturnType<typeof getAuthSettings>>,
    snapshot: unknown,
    requestPrompt: string,
    surface: CreativeSurface,
    referencedAssets: CreativeAsset[],
    requestedImageSize?: string,
    generationPreferences?: CreativeGenerationPreferences,
): AgentRunTask[] {
    const defaults = Object.assign({}, ...skills.map((skill) => skill.defaultConfig || {})) as Record<string, unknown>;
    const skillInstructions = skills
        .map((skill) => skill.instructions.trim())
        .filter(Boolean)
        .join("\n\n");
    const nodes = canvasSnapshotNodes(snapshot);
    const selectedNodeIds = new Set(selectedCanvasNodeIds(snapshot).filter((id) => nodes.has(id)));
    const selectedCanvasReferences = surface === "canvas" ? selectedCanvasReferenceNodes(snapshot) : [];
    const assets = new Map(referencedAssets.map((asset) => [asset.id, asset]));
    const referenceAliases = creativeAssetReferenceAliases(
        referencedAssets,
        referencedAssets.map((asset) => asset.id),
    );
    const configuredImageSize = agentSurfaceImageSize(surface, snapshot);
    return plan.deliverables.map((item, index) => {
        const optimizedPrompt = item.prompt.trim();
        const preferredSize = item.type === "image" ? generationPreferences?.image?.size : item.type === "video" ? generationPreferences?.video?.size : undefined;
        const preferredQuality = item.type === "image" ? generationPreferences?.image?.quality : item.type === "video" ? generationPreferences?.video?.quality : undefined;
        const targetNodeId = surface === "canvas" ? resolveCanvasTaskTargetNodeId(item.targetNodeId, item.type, selectedNodeIds, nodes) : undefined;
        const target = targetNodeId ? nodes.get(targetNodeId) : undefined;
        const canvasReferences = selectedCanvasReferences.filter((reference) => canvasReferenceSupportsTask(reference.type, item.type));
        const frameIds = item.type === "video" ? videoFrameAssetIds(generationPreferences?.video) : [];
        const frameIdSet = new Set(frameIds);
        const explicitFrameAssets = resolveTaskReferences(frameIds, assets, item.type);
        const plannedAssets = target ? [] : resolveTaskReferences(item.assetIds, assets, item.type).filter((asset) => !frameIdSet.has(asset.id));
        const selectedAssets = [...explicitFrameAssets, ...plannedAssets];
        const frameRoles = new Map<string, VideoReferenceRole>([
            ...(generationPreferences?.video?.firstFrameAssetId ? ([[generationPreferences.video.firstFrameAssetId, "first_frame"]] as const) : []),
            ...(generationPreferences?.video?.lastFrameAssetId ? ([[generationPreferences.video.lastFrameAssetId, "last_frame"]] as const) : []),
        ]);
        const references = [
            ...(canvasReferences.length
                ? canvasReferences.map((reference) => ({ nodeId: reference.nodeId, url: reference.url, type: reference.type }))
                : target?.url && isMediaReferenceType(target.type)
                  ? [{ nodeId: targetNodeId, url: target.url, type: target.type }]
                  : []),
            ...selectedAssets.flatMap((asset) => {
                const url = assetAccessUrl(asset);
                const role = frameRoles.get(asset.id);
                return url && asset.type !== "text" ? [{ assetId: asset.id, url, type: asset.type, ...(role ? { role } : {}) }] : [];
            }),
        ] satisfies AgentRunReference[];
        const primaryReference = references[0];
        const referenceContext = selectedAssets.map((asset) => creativeAssetContext(asset, referenceAliases.get(asset.id))).join("\n");
        const selectedCanvasContext = canvasReferenceContext(canvasReferences);
        return {
            id: item.id?.trim() || `task-${index}`,
            targetNodeId: target ? targetNodeId : undefined,
            referenceAssetId: selectedAssets[0]?.id,
            referenceUrl: primaryReference?.url,
            referenceType: primaryReference?.type,
            references,
            title: item.title.trim(),
            type: item.type,
            model: resolvePlannedModel(settings, item.type, item.model),
            optimizedPrompt,
            prompt: `${withCreativeFoundation(optimizedPrompt, plan.foundation)}${skillInstructions ? `\n\n执行以下已选 Skill 约束：\n${skillInstructions}` : ""}${textConstraintInstruction(requestPrompt, item.type)}${target ? `\n\n基于画布已有节点进行局部修改：${target.summary}` : ""}${selectedCanvasContext ? `\n\n使用本轮画布引用：\n${selectedCanvasContext}` : ""}${referenceContext ? `\n\n使用已引用创作资产：${referenceContext}` : ""}`,
            count:
                item.type === "image" || item.type === "video"
                    ? positiveTaskInteger(item.type === "image" ? generationPreferences?.image?.count || item.count : generationPreferences?.video?.count || item.count) ||
                      positiveTaskInteger(item.type === "video" ? defaults.videoCount || defaults.count : defaults.count) ||
                      0
                    : 1,
            ratio: resolveAgentTaskRatio({
                type: item.type,
                requestedImageSize,
                configuredImageSize: preferredSize || configuredImageSize,
                plannedRatio: item.ratio,
                defaultSize: textDefault(defaults.size),
                reference: target || canvasReferences.find((reference) => reference.type === "image") || (selectedAssets[0]?.type === "image" ? selectedAssets[0] : undefined),
            }),
            quality: preferredQuality || item.quality?.trim() || textDefault(item.type === "video" ? defaults.vquality : defaults.quality),
            seconds: item.type === "video" ? positiveTaskNumber(generationPreferences?.video?.seconds) || positiveTaskNumber(item.seconds) || positiveTaskNumber(defaults.videoSeconds) : undefined,
            voice: item.type === "audio" ? generationPreferences?.audio?.voice || item.voice?.trim() || textDefault(defaults.voice) : item.voice?.trim() || textDefault(defaults.voice),
            format: item.type === "audio" ? generationPreferences?.audio?.format || item.format?.trim() || textDefault(defaults.format) : item.format?.trim() || textDefault(defaults.format),
            generateAudio: item.type === "video" ? (generationPreferences?.video?.generateAudio ?? item.generateAudio) : undefined,
            watermark: item.type === "video" ? (generationPreferences?.video?.watermark ?? item.watermark) : undefined,
            speed: item.type === "audio" ? (generationPreferences?.audio?.speed ?? item.speed) : undefined,
            dependencies: (item.dependencies || []).map((dependency) => dependency.trim()),
            status: "ready",
            attempts: 0,
        };
    });
}

export type AgentModelOption = {
    id: string;
    name: string;
    capability: LogicalModelCapability;
    capabilityProfile?: NonNullable<ReturnType<typeof resolveLogicalModel>>["capabilityProfile"];
    generationParameters?: LogicalModelGenerationParameters;
    generationParameterCandidates?: Array<LogicalModelGenerationParameters | undefined>;
};

export function agentModelOptions(settings: Awaited<ReturnType<typeof getAuthSettings>>): AgentModelOption[] {
    return settings.logicalModels
        .filter((model) => model.enabled && resolveLogicalModel(settings, model.capability, model.id))
        .map((model) => {
            const resolved = resolveLogicalModel(settings, model.capability, model.id);
            const candidates = resolveLogicalModelCandidates(settings, model.capability, model.id);
            const generationParameters = unionGenerationParameters({
                enabled: true,
                bindings: candidates.map((candidate) => ({ enabled: true, generationParameters: candidate.generationParameters })),
            });
            return {
                id: model.id,
                name: model.name,
                capability: model.capability,
                capabilityProfile: resolved?.capabilityProfile,
                ...(generationParameters ? { generationParameters } : {}),
                generationParameterCandidates: candidates.map((candidate) => candidate.generationParameters),
            };
        });
}

export function agentGenerationRequest(preferences: CreativeGenerationPreferences | undefined, referencedAssetTypes: readonly CreativeAsset["type"][]): NormalizedGenerationRequest {
    const mode = preferences?.mode || (preferences?.image ? "image" : preferences?.video ? "video" : preferences?.audio ? "audio" : undefined);
    const references = referenceGenerationRequest(referencedAssetTypes);
    if (mode === "image") return { ...imageGenerationRequest((preferences?.image || {}) as Record<string, unknown>, referencedAssetTypes.filter((type) => type === "image").length, false), ...references };
    if (mode === "video") {
        const video = preferences?.video;
        const request = videoGenerationRequest(
            {
                size: video?.size,
                vquality: video?.quality,
                videoSeconds: video?.seconds,
                count: video?.count,
                videoGenerateAudio: video?.generateAudio,
                videoWatermark: video?.watermark,
            },
            referencedAssetTypes.filter((type): type is "image" | "video" | "audio" => type === "image" || type === "video" || type === "audio").map((type) => ({ type })),
        );
        return video?.referenceMode ? { ...request, ...references, videoReferenceMode: video.referenceMode } : { ...request, ...references };
    }
    if (mode === "audio") return { ...audioGenerationRequest((preferences?.audio || {}) as Record<string, unknown>), ...references };
    return references;
}

export function agentTaskGenerationRequest(task: AgentRunTask): NormalizedGenerationRequest {
    if (task.type === "text") return {};
    const references = (task.references || []).map((reference) => ({ type: reference.type, role: reference.role }));
    const referenceRequest = referenceGenerationRequest(references.map((reference) => reference.type));
    if (task.type === "image") return { ...imageGenerationRequest({ size: task.ratio, quality: task.quality, count: task.count }, references.filter((reference) => reference.type === "image").length, false), ...referenceRequest };
    if (task.type === "video") {
        return {
            ...videoGenerationRequest(
                {
                    size: task.ratio,
                    vquality: task.quality,
                    videoSeconds: task.seconds,
                    count: task.count,
                    videoGenerateAudio: task.generateAudio,
                    videoWatermark: task.watermark,
                },
                references,
            ),
            ...referenceRequest,
        };
    }
    return { ...audioGenerationRequest({ voice: task.voice, format: task.format, speed: task.speed }), ...referenceRequest };
}

function referenceGenerationRequest(types: readonly CreativeAsset["type"][]): NormalizedGenerationRequest {
    const referenceInputs = Array.from(new Set(types.filter((type): type is "image" | "video" | "audio" => type === "image" || type === "video" || type === "audio")));
    const referenceCount = types.filter((type) => type === "image").length;
    return { ...(referenceInputs.length ? { referenceInputs } : {}), ...(referenceCount ? { referenceCount } : {}) };
}

type AgentGenerationModel = AgentModelOption;

type AgentGenerationCandidateModel = {
    id: string;
    capability: string;
    generationParameters?: AgentGenerationModel["generationParameters"];
    generationParameterCandidates?: AgentGenerationModel["generationParameterCandidates"];
};

function modelGenerationProfiles(model: Omit<AgentGenerationCandidateModel, "id" | "capability">) {
    return model.generationParameterCandidates?.length ? model.generationParameterCandidates : [model.generationParameters];
}

function modelGenerationCompatibility(model: Omit<AgentGenerationCandidateModel, "id" | "capability">, request: NormalizedGenerationRequest) {
    return filterGenerationCandidates(
        modelGenerationProfiles(model).map((generationParameters, index) => ({ index, generationParameters })),
        request,
    );
}

export function filterAgentGenerationModels<T extends Omit<AgentGenerationCandidateModel, "id">>(models: readonly T[], request: NormalizedGenerationRequest) {
    return models.filter((model) => model.capability === "text" || modelGenerationCompatibility(model, request).candidates.length > 0);
}

export function validateManualAgentModels<T extends AgentGenerationCandidateModel>(models: readonly T[], requestedIds: readonly string[], request: NormalizedGenerationRequest) {
    const selected = requestedIds.map((id) => models.find((model) => model.id === id && model.capability !== "text")).filter((model): model is T => Boolean(model));
    if (selected.length !== requestedIds.length) throw new Error("部分所选模型当前不可用，请重新选择");
    for (const model of selected) {
        const compatibility = modelGenerationCompatibility(model, request);
        if (!compatibility.candidates.length) throw compatibility.error || new Error("所选模型不支持当前生成参数");
    }
    return selected;
}

export function resolveCompatiblePlannedModel<T extends AgentGenerationCandidateModel>(models: readonly T[], capability: LogicalModelCapability, planned: unknown, defaultModelId: string, request: NormalizedGenerationRequest) {
    const compatible = models.filter((model) => model.capability === capability && modelGenerationCompatibility(model, request).candidates.length > 0);
    const plannedId = typeof planned === "string" ? planned.trim() : "";
    return compatible.find((model) => model.id === plannedId)?.id || compatible.find((model) => model.id === defaultModelId)?.id || compatible[0]?.id;
}

export function resolveAgentTaskBinding<T extends AgentGenerationCandidateModel>(models: readonly T[], task: AgentRunTask, modelId: string, defaults: Awaited<ReturnType<typeof getAuthSettings>>["generationDefaults"]) {
    if (task.type === "text") return { ...task, model: modelId };
    const model = models.find((item) => item.id === modelId && item.capability === task.type);
    if (!model) return undefined;
    const candidates = modelGenerationProfiles(model).map((generationParameters, index) => ({ index, generationParameters }));
    const references = (task.references || []).map((reference) => ({ type: reference.type, role: reference.role }));
    if (task.type === "image") {
        const selected = resolveImageGenerationCandidates(candidates, { size: task.ratio, quality: task.quality, count: task.count }, defaults, references.filter((reference) => reference.type === "image").length, false).candidates[0];
        return selected ? { ...task, model: modelId, ratio: selected.size, quality: selected.quality, count: selected.count || 1 } : undefined;
    }
    if (task.type === "video") {
        const selected = resolveVideoGenerationCandidates(
            candidates,
            { size: task.ratio, vquality: task.quality, videoSeconds: task.seconds, count: task.count, videoGenerateAudio: task.generateAudio, videoWatermark: task.watermark },
            defaults,
            references,
        ).candidates[0];
        return selected
            ? { ...task, model: modelId, ratio: selected.size, quality: selected.vquality, seconds: selected.videoSeconds, count: selected.count || 1, generateAudio: selected.videoGenerateAudio, watermark: selected.videoWatermark }
            : undefined;
    }
    const selected = resolveAudioGenerationCandidates(candidates, { voice: task.voice, format: task.format, speed: task.speed }, defaults).candidates[0];
    return selected ? { ...task, model: modelId, voice: selected.voice, format: selected.format, speed: selected.speed ? Number(selected.speed) : undefined } : undefined;
}

export function resolveAgentTaskWithFallback<T extends AgentGenerationCandidateModel>(models: readonly T[], task: AgentRunTask, defaultModelId: string, defaults: Awaited<ReturnType<typeof getAuthSettings>>["generationDefaults"]) {
    const orderedIds = Array.from(new Set([task.model, defaultModelId, ...models.filter((model) => model.capability === task.type).map((model) => model.id)].filter((id): id is string => Boolean(id))));
    for (const modelId of orderedIds) {
        const resolved = resolveAgentTaskBinding(models, task, modelId, defaults);
        if (resolved) return resolved;
    }
    return undefined;
}

export function directAgentPlan(models: AgentModelOption[], prompt: string, assetIds: string[]): AgentPlan {
    if (!models.length || models.some((model) => model.capability === "text")) throw new Error("当前模型不支持直接生成媒体");
    return {
        intent: "generation",
        objective: prompt,
        reply: `已按你的选择使用 ${models.map((model) => `「${model.name}」`).join("、")} 分别执行生成。`,
        decisions: [{ label: "模型", value: models.map((model) => model.name).join("、"), reason: "使用你在模型面板中明确选择的模型，不再由智能规划改选" }],
        foundation: {
            complexity: "simple",
            brief: { objective: prompt, ...(assetIds.length ? { referenceStrategy: "使用已引用素材作为生成参考" } : {}) },
            direction: { summary: "严格执行用户当前描述和所选 Skill 约束" },
        },
        deliverables: models.map((model, index) => ({
            id: `direct-model-task-${index + 1}`,
            title: `${model.name} 生成`,
            type: model.capability as "image" | "video" | "audio",
            model: model.id,
            prompt,
            dependencies: [],
            assetIds,
        })),
    };
}

function defaultModel(settings: Awaited<ReturnType<typeof getAuthSettings>>, capability: LogicalModelCapability) {
    const model = capability === "image" ? settings.defaultModels.imageModel : capability === "video" ? settings.defaultModels.videoModel : capability === "audio" ? settings.defaultModels.audioModel : settings.defaultModels.textModel;
    return model && resolveLogicalModel(settings, capability, model) ? model : "";
}

function resolvePlannedModel(settings: Awaited<ReturnType<typeof getAuthSettings>>, capability: LogicalModelCapability, planned: unknown) {
    const model = typeof planned === "string" ? planned.trim() : "";
    if (model && resolveLogicalModel(settings, capability, model)) return model;
    return defaultModel(settings, capability) || undefined;
}

export function agentPlanFallbackExample(models: ReturnType<typeof agentModelOptions>) {
    const sample = models.find((model) => model.capability === "image") || models[0];
    return JSON.stringify({
        intent: "generation",
        objective: "为新品发布制作一套统一视觉",
        audience: "关注产品设计与科技体验的用户",
        reply: "我建议先建立横版主视觉，再基于同一风格生成配套文案，保证主体和传播语一致。",
        decisions: [
            { label: "模型", value: sample?.name || sample?.id || "可用逻辑模型", reason: "匹配当前产物类型和画面表现需求" },
            { label: "画幅", value: "16:9", reason: "适合发布会舞台、网页头图和横屏展示" },
        ],
        foundation: {
            complexity: "complex",
            brief: {
                objective: "为新品发布制作一套统一视觉",
                audience: "关注产品设计与科技体验的用户",
                usage: "发布会、官网与社交传播",
                coreMessage: "突出产品设计和可靠体验",
                constraints: ["不夸大功能"],
                referenceStrategy: "优先保持已有产品素材的外观与颜色",
            },
            direction: {
                summary: "克制、现代、可信",
                style: "纪实科技商业视觉",
                composition: "以产品为中心，保留文案和延展空间",
                colors: ["深灰", "暖白"],
                lighting: "柔和轮廓光与清晰材质光",
                keywords: ["纪实", "高级", "清晰层次"],
                avoid: ["过度赛博", "无关装饰"],
            },
        },
        brand: { summary: "克制、现代、可信", colors: ["深灰", "暖白"], visualKeywords: ["纪实", "高级", "清晰层次"] },
        deliverables: [
            {
                id: "main-visual",
                title: "发布会主视觉",
                type: sample?.capability || "image",
                model: sample?.id || "",
                prompt: "生成完整可执行的主视觉提示词",
                count: 1,
                ratio: "16:9",
                quality: "high",
                seconds: 5,
                voice: "alloy",
                format: "mp3",
                dependencies: [],
                assetIds: [],
            },
        ],
    });
}

function textDefault(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveTaskInteger(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function positiveTaskNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}
export async function executeTasks(runId: string, origin: string, cookie: string, executionId: string, executionSettings?: Awaited<ReturnType<typeof getAuthSettings>>) {
    const settings = executionSettings || (await getAuthSettings());
    while (await canContinue(runId, executionId)) {
        const run = await getAgentRun(runId);
        if (!run) return;
        const completed = new Set(run.tasks.filter((task) => task.status === "completed").map((task) => task.id));
        const ready = run.tasks.filter((task) => (task.status === "ready" || task.status === "running") && task.dependencies.every((id) => completed.has(id))).slice(0, settings.generationConcurrency.agent);
        if (!ready.length) {
            if (run.tasks.every((task) => task.status === "completed")) {
                if (!run.reviewed && shouldBlockOnReview(run)) {
                    const review = await reviewCompletedTasks(run, origin, cookie);
                    await updateAgentRunById(
                        runId,
                        { reviewed: true, review, reviewStatus: review.status === "unavailable" ? "review_unavailable" : "review_completed", timings: { ...(run.timings || { requestAcceptedAt: run.createdAt }), reviewCompletedAt: Date.now() } },
                        { type: review.status === "unavailable" ? "run.review.unavailable" : review.status === "needs_revision" ? "run.review.needs_revision" : "run.review.passed", data: { review } },
                        ["running"],
                        executionId,
                    );
                }
                let completedRun = (await getAgentRun(runId)) || run;
                const projectHandoff = await buildAgentProjectHandoff(completedRun);
                if (projectHandoff && !completedRun.projectHandoffEmitted) {
                    const emitted = await updateAgentRunById(runId, { projectHandoffEmitted: true }, { type: "project.handoff", data: projectHandoff }, ["running"], executionId);
                    if (!emitted) return;
                    completedRun = emitted;
                }
                const reply = `${agentRunCompletionReply(completedRun)}${projectHandoff ? `\n\n已创建${projectHandoff.surface === "canvas" ? "画布" : "短剧"}项目「${projectHandoff.title}」，可以从当前对话直接打开。` : ""}`;
                const backgroundReview = !shouldBlockOnReview(completedRun) && !completedRun.reviewed;
                const finished = await updateAgentRunById(
                    runId,
                    {
                        status: "completed",
                        executionId: undefined,
                        ...(backgroundReview ? { reviewStatus: "review_pending" as const, reviewAttempts: completedRun.reviewAttempts || 0 } : {}),
                        timings: { ...(completedRun.timings || { requestAcceptedAt: completedRun.createdAt }), allResultsReadyAt: completedRun.timings?.allResultsReadyAt || Date.now(), runCompletedAt: Date.now() },
                    },
                    { type: "run.completed", data: { completed: completedRun.tasks.length, assetIds: completedRun.assetIds, projectHandoff, reply } },
                    ["running"],
                    executionId,
                );
                if (finished && backgroundReview) await scheduleGenerationTask("agent", runId, { executionPhase: "review_pending", nextPollAt: Date.now(), lastUpstreamStatus: "review_pending" });
                return;
            }
            const blocked = run.tasks.filter((task) => task.status === "ready");
            const terminalTasks = blocked.length ? run.tasks.map((task) => (task.status === "ready" ? { ...task, status: "failed" as const, error: "前置任务未完成" } : task)) : run.tasks;
            const partialSuccess = Boolean(run.assetIds.length) && terminalTasks.some((task) => task.status === "failed") && terminalTasks.every((task) => task.status === "completed" || task.status === "failed");
            if (partialSuccess) {
                await updateAgentRunById(
                    runId,
                    {
                        status: "completed",
                        executionId: undefined,
                        tasks: terminalTasks,
                        timings: { ...(run.timings || { requestAcceptedAt: run.createdAt }), allResultsReadyAt: run.timings?.allResultsReadyAt || Date.now(), runCompletedAt: Date.now() },
                    },
                    { type: "run.completed", data: { completed: terminalTasks.filter((task) => task.status === "completed").length, partial: true, assetIds: run.assetIds, reply: agentRunFailureMessage(terminalTasks) } },
                    ["running"],
                    executionId,
                );
                return;
            }
            await updateAgentRunById(runId, { status: "failed", executionId: undefined, tasks: terminalTasks }, { type: "run.failed", data: { message: agentRunFailureMessage(terminalTasks) } }, ["running"], executionId);
            return;
        }
        const results = await Promise.all(ready.map((task) => runTaskWithRetry(runId, task, origin, cookie, executionId, settings)));
        if (results.some((result) => result === "deferred")) return;
    }
}

function shouldBlockOnReview(run: AgentRun) {
    return run.tasks.length > 1 || run.surface === "drama" || /严格检查|高质量模式|完整复盘/u.test(run.prompt);
}

export async function processAgentRunReview(run: AgentRun, origin: string, cookie: string) {
    if (run.status !== "completed" || run.reviewed) return { status: "completed" as const, attempts: run.reviewAttempts || 0 };
    const attempts = (run.reviewAttempts || 0) + 1;
    const started = await updateAgentRunById(run.id, { reviewStatus: "reviewing", reviewAttempts: attempts }, { type: "run.review.started", data: { attempt: attempts } }, ["completed"]);
    if (!started || started.reviewed) return { status: "completed" as const, attempts };
    try {
        const review = await reviewCompletedTasks(started, origin, cookie);
        await updateAgentRunById(
            started.id,
            { reviewed: true, review, reviewStatus: review.status === "unavailable" ? "review_unavailable" : "review_completed", timings: { ...(started.timings || { requestAcceptedAt: started.createdAt }), reviewCompletedAt: Date.now() } },
            { type: "run.review.background", data: { status: review.status, issueCount: review.issues.length } },
            ["completed"],
        );
        return { status: review.status === "unavailable" ? ("unavailable" as const) : ("completed" as const), attempts };
    } catch (error) {
        const message = toSafeGenerationErrorMessage(error, "复盘服务暂时不可用");
        const review: CreativeReview = { mode: "unavailable", status: "unavailable", summary: message, issues: [], retryTaskIds: [] };
        await updateAgentRunById(
            started.id,
            { reviewed: true, review, reviewStatus: "review_unavailable", timings: { ...(started.timings || { requestAcceptedAt: started.createdAt }), reviewCompletedAt: Date.now() } },
            { type: "run.review.background", data: { status: "unavailable", issueCount: 0 } },
            ["completed"],
        );
        return { status: "unavailable" as const, attempts };
    }
}

async function reviewCompletedTasks(run: AgentRun, origin: string, cookie: string) {
    const foundation = run.foundation || {
        complexity: "complex" as const,
        brief: { objective: run.prompt },
        direction: { summary: "保持所有产物的主体、信息和视觉语言一致" },
    };
    return reviewCreativeOutputs({
        origin,
        cookie,
        userId: run.userId,
        billingId: run.id,
        foundation,
        tasks: run.tasks.map((task) => ({ id: task.id, title: task.title, type: task.type, prompt: task.prompt, resultSummary: resultSummary(task.result), imageUrls: task.type === "image" ? taskImageUrls(task.result) : [] })),
    });
}

export async function requestFunctionCall(
    origin: string,
    cookie: string,
    candidate: TextPlanningCandidate,
    input: Array<{ role: string; content: string }>,
    tool: typeof agentPlanTool,
    name: string,
    signal: AbortSignal,
    _userId: string,
    billingModel: string,
    allowNaturalLanguage = false,
    usageContext?: SystemAiUsageContextDraft,
) {
    const requestHeaders = runtimeRequestHeaders(cookie, {
        "Content-Type": "application/json",
        ...systemAiBillingHeaders(billingModel, usageContext, candidate.upstreamModel),
    });
    const call = await requestStructuredText({
        origin,
        cookie,
        candidate,
        messages: input,
        tool: { name: tool.name, description: tool.description, parameters: tool.parameters },
        headers: requestHeaders,
        signal,
        allowNaturalLanguage,
        onInvalidResponse: (headers) => finishSystemAiTextAttempt(headers, { status: "failed" }),
    });
    return {
        ...readFunctionCallResult(call.arguments, call.headers, call.protocol, call.elapsedMs),
        usageHeaders: call.headers,
        usageBusinessId: usageContext?.businessRequestId,
        usageAttemptNumber: usageContext?.attemptNumber,
    };
}

export function responseOutputText(payload: { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }) {
    const direct = payload.output_text?.trim();
    if (direct) return direct;
    return (
        payload.output
            ?.flatMap((item) => item.content || [])
            .find((item) => item.type === "output_text" && item.text?.trim())
            ?.text?.trim() || ""
    );
}

export function readFunctionCallResult(argumentsText: string, headers: Headers, protocol?: AgentFunctionCallResult["protocol"], elapsedMs?: number): AgentFunctionCallResult {
    const pointsRemaining = Number(headers.get("x-vozeb-pro-points-remaining"));
    return {
        arguments: argumentsText,
        protocol,
        elapsedMs,
        pointsRemaining: Number.isFinite(pointsRemaining) ? pointsRemaining : undefined,
        ...readSystemAiBilling(headers),
    };
}

export async function voidFunctionCall(call: AgentFunctionCallResult) {
    if (call.usageHeaders) await finishSystemAiTextAttempt(call.usageHeaders, { status: "failed" });
}

export async function releaseFunctionCall(userId: string, call: AgentFunctionCallResult, reason: string) {
    await voidFunctionCall(call);
    if (call.usageBusinessId)
        await resolveSystemAiTextFailure({
            userId,
            businessId: call.usageBusinessId,
            reason,
            final: true,
            ...(call.usageAttemptNumber ? { currentAttempt: { attemptNumber: call.usageAttemptNumber, acceptance: "response" as const } } : {}),
        });
}

export async function runTaskWithRetry(runId: string, task: AgentRunTask, origin: string, cookie: string, executionId: string, settings?: Awaited<ReturnType<typeof getAuthSettings>>) {
    const resumeExisting = normalizeChildTasks(task).some((child) => child.status === "pending");
    const attempt = resumeExisting ? Math.max(1, task.attempts) : task.attempts + 1;
    if (!(await canContinue(runId, executionId))) return;
    if (!resumeExisting && !(await patchTask(runId, task.id, { status: "running", attempts: attempt, error: undefined }, "task.running", executionId))) return;
    try {
        const activeRun = await getAgentRun(runId);
        if (!activeRun || activeRun.executionId !== executionId) return;
        const currentTask = activeRun.tasks.find((item) => item.id === task.id) || task;
        let executableTask = await withDependencyContext(runId, currentTask);
        const activeSettings = settings || (await getAuthSettings());
        let resolvedForSubmission = false;
        if (agentTaskNeedsSubmission(executableTask) && !agentTaskHasSubmittedChild(executableTask)) {
            const resolvedTask = resolvePersistedAgentTask(activeRun, executableTask, activeSettings);
            const resolvedPatch = {
                model: resolvedTask.model,
                count: resolvedTask.count,
                ratio: resolvedTask.ratio,
                quality: resolvedTask.quality,
                seconds: resolvedTask.seconds,
                voice: resolvedTask.voice,
                format: resolvedTask.format,
                generateAudio: resolvedTask.generateAudio,
                watermark: resolvedTask.watermark,
                speed: resolvedTask.speed,
            };
            if (!(await patchTask(runId, task.id, resolvedPatch, "task.resolved", executionId))) return;
            executableTask = resolvedTask;
            resolvedForSubmission = true;
        }
        const dispatched = await dispatchTask(executableTask, origin, cookie, activeSettings, activeRun, executionId, attempt, resolvedForSubmission);
        const result = dispatched.result;
        validateAgentTaskResult(task.type, result);
        await patchTask(runId, task.id, {}, "task.validated", executionId);
        const registeredAssetIds = dispatched.assetIds ?? (await registerAgentTaskAssets(activeRun, { ...executableTask, attempts: attempt, result }, result, dispatched.sourceTaskIds)).map((asset) => asset.id);
        await patchTask(
            runId,
            task.id,
            {
                status: "completed",
                result,
                error: undefined,
                taskId: dispatched.sourceTaskIds.at(-1),
                taskIds: dispatched.sourceTaskIds,
                assetIds: registeredAssetIds,
                referenceAssetId: executableTask.referenceAssetId,
                referenceUrl: executableTask.referenceUrl,
                referenceType: executableTask.referenceType,
                references: executableTask.references,
            },
            "task.completed",
            executionId,
        );
        return "completed" as const;
    } catch (error) {
        if (error instanceof AgentChildTaskDeferredError) {
            const latest = await getAgentRun(runId);
            const latestTask = latest?.tasks.find((item) => item.id === task.id);
            const waitingMessage = latestTask?.childSlots?.find((slot) => slot.status === "failed")?.error || error.message;
            if (latestTask && latestTask.error !== waitingMessage && (await canContinue(runId, executionId))) {
                await patchTask(runId, task.id, { error: waitingMessage }, "task.waiting", executionId);
            }
            return "deferred" as const;
        }
        const message = toSafeGenerationErrorMessage(error, "生成任务失败");
        if (await canContinue(runId, executionId)) {
            await patchTask(runId, task.id, { status: "failed", error: message }, "task.failed", executionId);
        }
        return "failed" as const;
    }
}

function resolvePersistedAgentTask(run: AgentRun, task: AgentRunTask, settings: Awaited<ReturnType<typeof getAuthSettings>>) {
    if (task.type === "text") return task;
    const models = agentModelOptions(settings);
    const manual = Boolean(run.requestedModelIds?.length || run.plannerAudit?.mode === "direct");
    if (manual) {
        const modelId = task.model?.trim() || "";
        if (!modelId || (run.requestedModelIds?.length && !run.requestedModelIds.includes(modelId))) throw new Error("已持久化的手动模型身份无效");
        const resolved = resolveAgentTaskBinding(models, task, modelId, settings.generationDefaults);
        if (!resolved) throw new Error(`手动选择的模型「${modelId}」当前不可用或不支持已保存的生成参数`);
        return resolved;
    }
    const fallback = task.type === "image" ? settings.defaultModels.imageModel : task.type === "video" ? settings.defaultModels.videoModel : settings.defaultModels.audioModel;
    const resolved = resolveAgentTaskWithFallback(models, task, fallback, settings.generationDefaults);
    if (!resolved) throw new Error(`没有兼容已保存生成参数的${task.type === "image" ? "图片" : task.type === "video" ? "视频" : "音频"}模型`);
    return resolved;
}

function agentTaskNeedsSubmission(task: AgentRunTask) {
    const children = normalizeChildTasks(task);
    return Array.from({ length: agentTaskCopies(task.type, task.count) }).some(
        (_, index) =>
            !agentChildAtSlot(
                children,
                task.childSlots?.find((slot) => slot.index === index),
                index,
            )?.id,
    );
}

function agentTaskHasSubmittedChild(task: AgentRunTask) {
    return normalizeChildTasks(task).some((child) => Boolean(child.id));
}

export async function resumeDispatchedTask(run: AgentRun, task: AgentRunTask, taskId: string, attempt: number, origin: string, cookie: string, executionId: string) {
    await linkAgentChildTask(run, task, taskId, attempt);
    return { result: await pollTask(origin, taskPath(task.type), taskId, cookie, run.id, task.type, executionId), sourceTaskIds: [taskId] };
}

export async function withDependencyContext(runId: string, task: AgentRunTask): Promise<AgentRunTask> {
    const run = await getAgentRun(runId);
    if (!run || !task.dependencies.length) return task;
    const dependencies = run?.tasks.filter((item) => task.dependencies.includes(item.id) && item.status === "completed") || [];
    const dependencyAssets = await getCreativeAssetsByIds(Array.from(new Set(dependencies.flatMap((item) => item.assetIds || []))), run?.userId);
    const dependencyReferences = dependencyAssets.flatMap((asset) => {
        const url = assetAccessUrl(asset);
        if (!url || !acceptsMediaReference(task.type, asset.type)) return [];
        return [{ assetId: asset.id, sourceTaskId: asset.sourceTaskId, url, type: asset.type }] satisfies AgentRunReference[];
    });
    const references = mergeTaskReferences(taskReferences(task), dependencyReferences);
    const taskContext = dependencies
        .map((item) => `【${item.title}】${resultSummary(item.result)}`)
        .filter((item) => item.length > 4)
        .join("\n");
    const assetContext = dependencyAssets.map((asset) => creativeAssetContext(asset)).join("\n");
    const context = [taskContext, assetContext].filter(Boolean).join("\n");
    const primaryReference = references[0];
    return {
        ...task,
        referenceAssetId: primaryReference?.assetId || task.referenceAssetId,
        referenceUrl: primaryReference?.url || task.referenceUrl,
        referenceType: primaryReference?.type || task.referenceType,
        references,
        prompt: context ? `${task.prompt}\n\n请保持与以下已完成产物一致，并将依赖媒体作为真实生成参考：\n${context}` : task.prompt,
    };
}

export function taskPath(type: AgentRunTask["type"]) {
    return type === "image" ? "/api/image-tasks" : type === "video" ? "/api/video-tasks" : type === "audio" ? "/api/audio-tasks" : "/api/text-tasks";
}

export async function dispatchTask(task: AgentRunTask, origin: string, cookie: string, settings: Awaited<ReturnType<typeof getAuthSettings>>, run: AgentRun, executionId: string, attempt: number, resolvedForSubmission = false) {
    const directTextContent = run.surface === "canvas" ? directCanvasTextContent(task) : null;
    if (directTextContent) return { result: { content: directTextContent }, sourceTaskIds: [`direct-${run.id}-${task.id}`] };
    const path = task.type === "image" ? "/api/image-tasks" : task.type === "video" ? "/api/video-generation-tasks" : task.type === "audio" ? "/api/audio-tasks" : "/api/text-tasks";
    const context = { conversationId: run.conversationId, runId: run.id, surface: run.surface, projectId: run.projectId, parentTaskId: task.id, attemptNo: attempt, clientRequestId: `${run.clientRequestId}:${task.id}:${attempt}` };
    const copies = agentTaskCopies(task.type, task.count);
    const initialChildren = normalizeChildTasks(task);
    const childSlots = new Map((task.childSlots || []).map((slot) => [slot.index, slot]));
    const outcomes = await mapWithConcurrency(copies, settings.generationConcurrency[task.type === "image" ? "image" : task.type === "video" ? "video" : task.type === "audio" ? "audio" : "text"], async (index) => {
        if (!(await canContinue(run.id, executionId))) throw new Error("Agent Run 已暂停、取消或已由新执行器接管");
        let slot = childSlots.get(index);
        let child = agentChildAtSlot(initialChildren, slot, index);
        let taskId = child?.id;
        let childTask = slot?.status === "resolved" ? agentTaskWithChildSlot(task, slot) : task;
        if (!taskId) {
            if (slot?.status === "failed") throw new AgentChildTaskTerminalError(slot.error || "生成任务缺少可提交的模型配置");
            if (!slot && !resolvedForSubmission) {
                try {
                    childTask = resolvePersistedAgentTask(run, task, settings);
                } catch (error) {
                    const message = toSafeGenerationErrorMessage(error, "生成任务缺少可提交的模型配置");
                    slot = agentChildSlot(index, task, "failed", message);
                    childSlots.set(index, slot);
                    await patchTask(run.id, task.id, { childSlots: [slot], error: message }, "task.child.failed", executionId);
                    throw new AgentChildTaskTerminalError(message);
                }
            }
            if (!slot) {
                slot = agentChildSlot(index, childTask, "resolved");
                childSlots.set(index, slot);
                if (!(await patchTask(run.id, task.id, { childSlots: [slot] }, "task.child.resolved", executionId))) throw new Error("Agent Run 已由新执行器接管");
            }
            const body = agentTaskSubmissionBody(childTask, settings, run, context);
            const bodyForCopy = {
                ...body,
                context: { ...context, clientRequestId: `${run.clientRequestId}:${task.id}:${attempt}:${index + 1}` },
            };
            const response = await fetchInternalApi(`${origin}${path}`, { method: "POST", headers: runtimeRequestHeaders(cookie, { "Content-Type": "application/json" }), body: JSON.stringify(bodyForCopy), cache: "no-store" });
            if (!response.ok) throw new Error((await response.text()) || "生成任务创建失败");
            const payload = (await response.json()) as { task?: { id?: string } };
            const createdTaskId = payload.task?.id;
            if (!createdTaskId) throw new Error("生成任务未返回任务 ID");
            taskId = createdTaskId;
            await linkAgentChildTask(run, task, taskId, attempt);
            child = { ...agentGenerationSelection(childTask), id: taskId, status: "pending", attempt };
            slot = { ...slot, taskId };
            childSlots.set(index, slot);
            if (!(await patchTask(run.id, task.id, { taskId, taskIds: [taskId], childTasks: [child], childSlots: [slot] }, "task.created", executionId))) throw new Error("Agent Run 已由新执行器接管");
        }
        const persistedChild = { ...agentGenerationSelection(childTask), ...child };
        try {
            if (child?.status === "completed") {
                const registered = await registerAgentTaskAssets(run, { ...childTask, title: copies > 1 ? `${task.title} ${index + 1}` : task.title, count: 1, attempts: attempt, result: child.result }, child.result, [taskId]);
                const assetIds = registered.map((asset) => asset.id);
                await patchTask(run.id, task.id, { assetIds }, "task.child.restored", executionId);
                return { index, result: child.result, taskId, assetIds };
            }
            const result = await pollTask(origin, task.type === "video" ? "/api/video-tasks" : path, taskId, cookie, run.id, task.type, executionId);
            const registered = await registerAgentTaskAssets(run, { ...childTask, title: copies > 1 ? `${task.title} ${index + 1}` : task.title, count: 1, attempts: attempt, result }, result, [taskId]);
            const assetIds = registered.map((asset) => asset.id);
            const completedChild = { ...persistedChild, id: taskId, status: "completed" as const, attempt: child?.attempt || attempt, result };
            if (!(await patchTask(run.id, task.id, { taskId, taskIds: [taskId], childTasks: [completedChild], assetIds }, "task.child.completed", executionId))) throw new Error("Agent Run 已由新执行器接管");
            return { index, result, taskId, assetIds };
        } catch (error) {
            if (error instanceof AgentChildTaskDeferredError) throw error;
            const message = toSafeGenerationErrorMessage(error, "生成任务失败");
            if (taskId) await patchTask(run.id, task.id, { taskIds: [taskId], childTasks: [{ ...persistedChild, id: taskId, status: "failed", attempt: child?.attempt || attempt, error: message }] }, "task.child.failed", executionId);
            throw error;
        }
    });
    const failed = outcomes.find((outcome) => outcome.status === "rejected" && outcome.reason instanceof AgentChildTaskDeferredError) || outcomes.find((outcome) => outcome.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const completed = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : [])).sort((left, right) => left.index - right.index);
    const results = completed.map((outcome) => outcome.result);
    return {
        result: results.length === 1 ? results[0] : { results },
        sourceTaskIds: Array.from(new Set([...(task.taskIds || []), ...completed.map((outcome) => outcome.taskId)])),
        assetIds: Array.from(new Set([...(task.assetIds || []), ...completed.flatMap((outcome) => outcome.assetIds)])),
    };
}

function agentTaskSubmissionBody(task: AgentRunTask, settings: Awaited<ReturnType<typeof getAuthSettings>>, run: AgentRun, context: Record<string, unknown>) {
    const model = task.model?.trim() || "";
    const resolved = resolveLogicalModel(settings, task.type, model);
    const channel = resolved?.channel;
    if (!model || !channel || !resolved) throw new Error(`已保存的${task.type === "image" ? "图片" : task.type === "video" ? "视频" : task.type === "audio" ? "音频" : "文本"}模型当前不可用`);
    const config = {
        apiSource: "system",
        baseUrl: `/api/ai/system/${encodeURIComponent(channel.id)}`,
        apiKey: "",
        apiFormat: channel.apiFormat || "openai",
        model,
        ...(task.type === "image" ? { ...(task.quality ? { quality: task.quality } : {}), ...(task.ratio ? { size: task.ratio } : {}) } : {}),
        ...(task.type === "video"
            ? {
                  ...(task.ratio ? { size: task.ratio } : {}),
                  ...(task.seconds ? { videoSeconds: String(task.seconds) } : {}),
                  ...(task.quality ? { vquality: task.quality } : {}),
                  ...(task.generateAudio !== undefined ? { videoGenerateAudio: String(task.generateAudio) } : {}),
                  ...(task.watermark !== undefined ? { videoWatermark: String(task.watermark) } : {}),
              }
            : {}),
        ...(task.type === "audio" ? { ...(task.voice ? { voice: task.voice } : {}), ...(task.format ? { format: task.format } : {}), ...(task.speed ? { speed: String(task.speed) } : {}) } : {}),
    };
    const references = taskReferences(task);
    const source = run.surface === "canvas" ? "canvas" : run.surface === "drama" ? "drama" : "agent";
    return task.type === "image"
        ? {
              config,
              prompt: task.prompt,
              source,
              title: task.title,
              kind: references.length ? "edit" : "generation",
              references: references.filter((item) => item.type === "image").map((item) => ({ dataUrl: "", url: item.url })),
              context,
          }
        : task.type === "video"
          ? { config, prompt: task.prompt, references: references.map((item) => ({ type: item.type, url: item.url, ...(item.role ? { role: item.role } : {}) })), source, context }
          : task.type === "audio"
            ? { config, prompt: task.prompt, source, context }
            : { config, messages: [{ role: "user", content: task.prompt }] };
}

async function mapWithConcurrency<R>(count: number, concurrency: number, worker: (index: number) => Promise<R>): Promise<Array<PromiseSettledResult<R> & { index: number }>> {
    const results: Array<PromiseSettledResult<R> & { index: number }> = [];
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, count) }, async () => {
            while (cursor < count) {
                const index = cursor++;
                try {
                    results.push({ index, status: "fulfilled", value: await worker(index) });
                } catch (reason) {
                    results.push({ index, status: "rejected", reason });
                }
            }
        }),
    );
    return results;
}

function normalizeChildTasks(task: AgentRunTask): AgentRunChildTask[] {
    const children = task.childTasks || [];
    const ids = task.taskIds?.length ? task.taskIds : task.taskId ? [task.taskId] : [];
    if (!ids.length) return children;
    const byId = new Map(children.map((child) => [child.id, child]));
    const knownIds = new Set(ids);
    return [...ids.map((id) => byId.get(id) || { id, status: "pending" as const, attempt: Math.max(1, task.attempts) }), ...children.filter((child) => !knownIds.has(child.id))];
}

function agentGenerationSelection(value: AgentRunGenerationSelection): AgentRunGenerationSelection {
    return {
        ...(value.model ? { model: value.model } : {}),
        ...(value.ratio ? { ratio: value.ratio } : {}),
        ...(value.quality ? { quality: value.quality } : {}),
        ...(value.seconds !== undefined ? { seconds: value.seconds } : {}),
        ...(value.voice ? { voice: value.voice } : {}),
        ...(value.format ? { format: value.format } : {}),
        ...(value.generateAudio !== undefined ? { generateAudio: value.generateAudio } : {}),
        ...(value.watermark !== undefined ? { watermark: value.watermark } : {}),
        ...(value.speed !== undefined ? { speed: value.speed } : {}),
    };
}

function agentChildSlot(index: number, selection: AgentRunGenerationSelection, status: AgentRunChildSlot["status"], error?: string): AgentRunChildSlot {
    return { index, status, ...agentGenerationSelection(selection), ...(error ? { error } : {}) };
}

function agentTaskWithChildSlot(task: AgentRunTask, slot: AgentRunChildSlot): AgentRunTask {
    return { ...task, ...agentGenerationSelection(slot) };
}

function agentChildAtSlot(children: AgentRunChildTask[], slot: AgentRunChildSlot | undefined, index: number) {
    return slot?.taskId ? children.find((child) => child.id === slot.taskId) : children[index];
}

export function linkAgentChildTask(run: AgentRun, task: AgentRunTask, taskId: string, attempt: number) {
    return linkStoredGenerationTask(task.type, taskId, {
        conversationId: run.conversationId,
        runId: run.id,
        surface: run.surface,
        projectId: run.projectId,
        parentTaskId: run.id,
        attemptNo: attempt,
    });
}

export function directCanvasTextContent(task: AgentRunTask) {
    if (task.type !== "text") return null;
    const prompt = task.prompt.split(/\n\n(?:严格输出要求|基于画布已有节点|请保持与以下已完成产物一致)：/u)[0]?.trim() || "";
    if (!/(?:文字|文本|内容|文案|标题).{0,16}(?:节点|卡片|便签)|(?:节点|卡片|便签).{0,16}(?:文字|文本|内容|文案|标题)|画布/u.test(prompt)) return null;
    const quoted = prompt.match(/(?:内容|文字|文本|文案|标题)[^“"「『'`]{0,18}(?:写(?:着|成)?|写为|为|是|设置为|设为|改为|改成|填(?:写)?为)[:：\s]*[“"「『'`]([^”"」』'`]{1,500})[”"」』'`]/u);
    if (quoted?.[1]?.trim()) return quoted[1].trim();
    const displayed = prompt.match(/(?:写着|写有|显示|展示)[:：\s]*[“"「『'`]([^”"」』'`]{1,500})[”"」』'`]/u);
    if (displayed?.[1]?.trim()) return displayed[1].trim();
    const plain = prompt.match(/(?:内容|文字|文本|文案|标题)[^，。；;\n]{0,18}(?:写(?:成)?|写为|为|是|设置为|设为|改为|改成|填(?:写)?为)[:：\s]*([^，。；;\n]{1,160})/u);
    return plain?.[1]?.trim() || null;
}

export async function pollTask(origin: string, path: string, taskId: string, cookie: string, runId: string, type: AgentRunTask["type"], executionId: string) {
    void type;
    if (!(await canContinue(runId, executionId))) throw new Error("Agent Run 已暂停、取消或已由新执行器接管");
    let response: Response;
    try {
        response = await fetchInternalApi(`${origin}${path}/${encodeURIComponent(taskId)}`, { headers: runtimeRequestHeaders(cookie), cache: "no-store" });
    } catch (error) {
        throw new AgentChildTaskDeferredError(error instanceof Error ? error.message : "生成任务查询暂时不可用");
    }
    if (!response.ok) {
        if ([408, 425, 429].includes(response.status) || response.status >= 500) throw new AgentChildTaskDeferredError("生成任务查询暂时不可用");
        throw new AgentChildTaskTerminalError((await response.text()) || "生成任务查询失败");
    }
    let payload: { task?: { status?: string; result?: unknown; error?: string; needsReview?: boolean } };
    try {
        payload = (await response.json()) as typeof payload;
    } catch {
        throw new AgentChildTaskDeferredError("生成任务状态暂时无法解析");
    }
    if (payload.task?.needsReview) throw new AgentChildTaskDeferredError("上游创建状态待人工确认");
    const terminal = agentChildTaskTerminal(payload.task?.status);
    if (terminal === "success") return payload.task?.result;
    if (terminal === "error") throw new AgentChildTaskTerminalError(payload.task?.error || "生成任务失败");
    if (terminal === "cancelled") throw new AgentChildTaskTerminalError(payload.task?.error || "生成任务已取消");
    throw new AgentChildTaskDeferredError("生成任务仍在处理中");
}

export async function patchTask(runId: string, taskId: string, patch: Partial<AgentRunTask>, eventType: string, executionId: string) {
    return updateAgentRunTaskById(runId, taskId, patch, eventType, executionId);
}

function runtimeRequestHeaders(cookie: string, initial?: HeadersInit) {
    const headers = new Headers(initial);
    const workerHeaders = maintenanceWorkerContextHeaders(cookie);
    if (workerHeaders) Object.entries(workerHeaders).forEach(([key, value]) => headers.set(key, value));
    else if (cookie) headers.set("cookie", cookie);
    return headers;
}
