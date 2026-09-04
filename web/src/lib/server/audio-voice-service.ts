import type { AudioTaskConfig } from "@/lib/server/audio-task-store";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { maintenanceWorkerHeaders } from "@/lib/server/maintenance-auth";
import { systemAiBillingHeaders } from "@/lib/server/system-ai-billing";
import { getVoiceProfileForUser } from "@/lib/server/voice-profile-store";
import type { VoiceSelection } from "@/lib/voice-selection";

export type AudioPresetVoice = { id: string; name: string };

type VoiceCandidate = Pick<AudioTaskConfig, "apiSource" | "baseUrl" | "apiKey" | "apiFormat" | "model" | "channelId" | "logicalModel"> & {
    advancedConfig?: Pick<NonNullable<AudioTaskConfig["advancedConfig"]>, "catalogPath">;
    generationParameters?: { audioOperation?: unknown; voiceCatalog?: unknown; supportsClonedVoices?: boolean; voices?: string[]; formats?: string[] };
};

export async function resolveAudioVoiceCandidates(input: { userId: string; selection: VoiceSelection; candidates: VoiceCandidate[]; origin: string; cookie?: string; workerUserId?: string }): Promise<AudioTaskConfig[]> {
    const candidates = speechCandidates(input.candidates);
    if (input.selection.type === "profile") {
        const profile = await getVoiceProfileForUser(input.userId, input.selection.voiceProfileId);
        if (!profile) throw new AudioVoiceError("声音档案不存在或无权访问", 404, "VOICE_PROFILE_NOT_FOUND");
        if (profile.status !== "ready" || !profile.channelId || !profile.providerVoiceId) throw new AudioVoiceError("声音档案尚未就绪", 409, "VOICE_PROFILE_NOT_READY");
        const providerVoiceId = profile.providerVoiceId;
        return candidates
            .filter((candidate) => candidate.channelId === profile.channelId && candidate.generationParameters?.supportsClonedVoices === true)
            .map((candidate) => ({ ...candidate, voice: providerVoiceId, voiceSelection: input.selection, voiceDisplayName: profile.name }) as AudioTaskConfig);
    }

    const results: AudioTaskConfig[] = [];
    const voiceId = input.selection.voiceId;
    for (const candidate of candidates) {
        const voices = await candidateVoices(candidate, input);
        const preset = voices.find((voice) => voice.id === voiceId);
        if (preset) results.push({ ...candidate, voice: preset.id, voiceSelection: input.selection, voiceDisplayName: preset.name } as AudioTaskConfig);
    }
    return results;
}

export async function listAudioPresetVoices(input: { candidates: VoiceCandidate[]; origin: string; cookie?: string; userId: string; workerUserId?: string }) {
    const voices = (await Promise.all(speechCandidates(input.candidates).map((candidate) => candidateVoices(candidate, input)))).flat();
    const unique = new Map<string, AudioPresetVoice>();
    for (const voice of voices) if (!unique.has(voice.id)) unique.set(voice.id, voice);
    return [...unique.values()];
}

async function candidateVoices(candidate: VoiceCandidate, input: { origin: string; cookie?: string; userId: string; workerUserId?: string }) {
    if ((candidate.generationParameters?.voiceCatalog || "static") !== "provider") return staticVoices(candidate.generationParameters?.voices || []);
    const path = normalizePath(candidate.advancedConfig?.catalogPath);
    if (!path) return [];
    const headers = new Headers({ ...systemAiBillingHeaders(candidate.logicalModel || candidate.model, undefined, candidate.model) });
    if (input.cookie) headers.set("cookie", input.cookie);
    else if (input.workerUserId) Object.entries(maintenanceWorkerHeaders(input.workerUserId)).forEach(([name, value]) => headers.set(name, value));
    try {
        const response = await fetchInternalApi(`${input.origin}${candidate.baseUrl.replace(/\/+$/, "")}${path}`, { headers, cache: "no-store" });
        if (!response.ok) return [];
        return providerVoices(await response.json().catch(() => null));
    } catch {
        return [];
    }
}

function staticVoices(values: string[]): AudioPresetVoice[] {
    return values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((id) => ({ id, name: id }));
}

function providerVoices(payload: unknown): AudioPresetVoice[] {
    const root = record(payload);
    const candidates = [root?.presets, record(root?.data)?.presets].find((value): value is unknown[] => Array.isArray(value)) || [];
    return candidates.flatMap((item: unknown) => {
        const voice = record(item);
        if (!voice) return [];
        const id = text(voice.id || voice.voice_id || voice.voiceId || voice.value || voice.key);
        if (!id) return [];
        return [{ id, name: text(voice.name || voice.label || voice.title) || id }];
    });
}

function speechCandidates(candidates: VoiceCandidate[]) {
    return candidates.filter((candidate) => (candidate.generationParameters?.audioOperation || "speech") === "speech");
}

function normalizePath(value: unknown) {
    const path = text(value);
    return path ? (path.startsWith("/") ? path : `/${path}`) : "";
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export class AudioVoiceError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
    }
}
