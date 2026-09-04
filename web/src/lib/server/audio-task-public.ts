import type { VoiceSelection } from "@/lib/voice-selection";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";

export function publicAudioTaskError(task: { error?: string; config?: { voice?: string; voiceSelection?: VoiceSelection } }) {
    if (!task.error) return undefined;
    const safe = toSafeGenerationErrorMessage(task.error, "音频生成失败");
    const providerVoiceId = task.config?.voiceSelection?.type === "profile" ? task.config.voice?.trim() : "";
    if (!providerVoiceId) return safe;
    return safe.replaceAll(` ${providerVoiceId}`, "所选声音档案").replaceAll(providerVoiceId, "所选声音档案");
}
