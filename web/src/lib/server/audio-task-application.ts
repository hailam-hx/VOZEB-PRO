import { after, NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError } from "@/lib/auth/store";
import { mediaTaskSource } from "@/lib/media-management-contract";
import { createAudioTask, type AudioTask, type AudioTaskConfig } from "@/lib/server/audio-task-store";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { getStoredGenerationTaskByRequest, linkStoredGenerationTask, withGenerationConcurrencyLimit, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { resolveAudioGenerationCandidates } from "@/lib/server/capability-constraints";
import { retryAudioTaskAfterCapabilityChange } from "@/lib/server/audio-task-capability-retry";
import { publicAudioTaskError } from "@/lib/server/audio-task-public";
import { AudioVoiceError, resolveAudioVoiceCandidates } from "@/lib/server/audio-voice-service";
import { normalizeVoiceSelection, resolveAudioTaskSource, unicodeCodePointCount } from "@/lib/voice-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400;

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const rate = await checkGenerationRateLimit(user.id, request, "audio");
    if (!rate.allowed) return NextResponse.json({ error: "音频生成请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const settings = await getAuthSettings();
    const response = await withGenerationConcurrencyLimit(user.id, "audio", 10 * 60 * 1000, settings.generationConcurrency.audio, async () => {
        let body: { config?: AudioTaskConfig; prompt?: string; source?: string; context?: GenerationTaskContext };
        try {
            body = await readJsonBody(request);
        } catch (error) {
            if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
        const channels = resolveLogicalModelCandidates(settings, "audio", body.config?.model || settings.defaultModels.audioModel).map((resolved) => ({ ...toSystemGenerationChannel(resolved), channelId: resolved.channelId }));
        const prompt = String(body.prompt || "").trim();
        const selection = normalizeVoiceSelection(body.config?.voiceSelection);
        const supportedChannels = channels.filter((channel) => channel.apiFormat !== "gemini" && (channel.generationParameters?.audioOperation || "speech") === "speech");
        if (!supportedChannels.length || !prompt) return NextResponse.json({ error: "音频任务参数不完整或渠道不支持" }, { status: 400 });
        if (!selection) return NextResponse.json({ error: "请选择有效的预设音色或声音档案" }, { status: 400 });
        const promptLength = unicodeCodePointCount(prompt);
        const withinCharacterLimit = supportedChannels.filter((channel) => !channel.generationParameters?.maxCharacters || promptLength <= channel.generationParameters.maxCharacters);
        if (!withinCharacterLimit.length) {
            const limit = Math.max(...supportedChannels.map((channel) => channel.generationParameters?.maxCharacters || 0));
            return NextResponse.json({ error: `文本超过当前模型最多 ${limit} 个字符的限制` }, { status: 400 });
        }
        const capability = resolveAudioGenerationCandidates(withinCharacterLimit, { ...(body.config || {}), voiceSelection: selection }, settings.generationDefaults);
        if (!capability.candidates.length) return NextResponse.json({ error: capability.error?.message || "当前模型不支持所选生成参数" }, { status: 400 });
        let voiced: AudioTaskConfig[];
        try {
            voiced = await resolveAudioVoiceCandidates({ userId: user.id, selection, candidates: capability.candidates, origin: resolveInternalOrigin(new URL(request.url).origin), cookie: request.headers.get("cookie") || "" });
        } catch (error) {
            if (error instanceof AudioVoiceError) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
        if (!voiced.length) return NextResponse.json({ error: selection.type === "preset" ? `当前模型不支持音色 ${selection.voiceId}` : "声音档案与当前模型渠道不兼容" }, { status: 400 });
        const configs: AudioTaskConfig[] = voiced.map((channel) => ({ ...channel, instructions: clean(body.config?.instructions, 2_000) }));
        const requestId = body.context?.clientRequestId?.trim();
        if (requestId) {
            const existing = await getStoredGenerationTaskByRequest<AudioTask>("audio", user.id, requestId, body.context?.attemptNo);
            if (existing) {
                const retried = await retryAudioTaskAfterCapabilityChange(existing, configs[0], configs.slice(1));
                if (retried) {
                    const origin = resolveInternalOrigin(new URL(request.url).origin);
                    after(() => runGenerationTaskRecoveryBatch({ origin, cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [retried.id] }));
                }
                return NextResponse.json({ task: publicTask(retried || existing) });
            }
        }
        const task = await createAudioTask({
            ...(body.context || {}),
            userId: user.id,
            config: configs[0],
            candidateConfigs: configs.slice(1),
            prompt,
            source: resolveAudioTaskSource(body.source, selection) || mediaTaskSource(body.source, body.context, "audio-task"),
        });
        await linkStoredGenerationTask("audio", task.id, body.context || {});
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        const cookie = request.headers.get("cookie") || "";
        await scheduleGenerationTask("audio", task.id, { executionPhase: "created", channelId: task.config.channelId, provider: task.config.advancedConfig?.protocol || task.config.apiFormat, nextPollAt: Date.now(), lastUpstreamStatus: "created" });
        after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [task.id] }));
        return NextResponse.json({ task: publicTask(task) });
    });
    return response || NextResponse.json({ error: "当前用户音频任务已达到并发上限" }, { status: 429 });
}

function publicTask(task: AudioTask) {
    return { id: task.id, status: task.status, model: generationModelId(task.config), result: task.result, error: publicAudioTaskError(task) };
}

function clean(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
