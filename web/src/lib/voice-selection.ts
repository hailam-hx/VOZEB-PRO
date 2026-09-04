export type VoiceSelection = { type: "preset"; voiceId: string } | { type: "profile"; voiceProfileId: string };

export function normalizeVoiceSelection(value: unknown): VoiceSelection | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (input.type === "preset") {
        const voiceId = text(input.voiceId, 500);
        return voiceId ? { type: "preset", voiceId } : null;
    }
    if (input.type === "profile") {
        const voiceProfileId = text(input.voiceProfileId, 160);
        return voiceProfileId ? { type: "profile", voiceProfileId } : null;
    }
    return null;
}

export function unicodeCodePointCount(value: string) {
    return Array.from(value).length;
}

export function resolveAudioTaskSource(value: unknown, selection: VoiceSelection) {
    if (selection.type !== "profile" || typeof value !== "string") return "";
    const source = value.trim();
    return source === `voice-profile-preview:${selection.voiceProfileId}` ? source : "";
}

function text(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
