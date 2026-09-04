import type { VoiceSelection } from "@/lib/voice-selection";
import type { AudioGenerationTask } from "@/services/api/audio";

export type PublicVoiceProfile = {
    id: string;
    name: string;
    status: "pending" | "ready" | "failed" | "deleting" | "deleted";
    source: { mimeType: string; durationSeconds: number };
    hasPreview: boolean;
    error?: string;
    lastUsedAt?: string;
    createdAt: string;
    updatedAt: string;
};

type Envelope<T> = { code: number; data: T; msg: string };

export async function fetchVoiceProfiles(params: { page?: number; pageSize?: number; status?: PublicVoiceProfile["status"] } = {}) {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.pageSize) search.set("pageSize", String(params.pageSize));
    if (params.status) search.set("status", params.status);
    const response = await fetch(`/api/voice-profiles${search.size ? `?${search}` : ""}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as Envelope<{ items: PublicVoiceProfile[]; total: number; page: number; pageSize: number }> | null;
    if (!response.ok || !payload || payload.code !== 0) throw new Error(payload?.msg || "获取声音档案失败");
    return { ...payload.data, retryAfterSeconds: positiveNumber(response.headers.get("retry-after")) };
}

export async function createVoiceProfile(input: { name: string; sourceAssetToken: string; clientRequestId: string; consentConfirmed: boolean }) {
    return request<{ profile: PublicVoiceProfile }>("/api/voice-profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}

export async function renameVoiceProfile(id: string, name: string) {
    return request<{ profile: PublicVoiceProfile }>(`/api/voice-profiles/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
}

export async function deleteVoiceProfile(id: string) {
    return request<{ profile: PublicVoiceProfile }>(`/api/voice-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchPresetVoices(model: string) {
    return request<{ voices: Array<{ id: string; name: string }> }>(`/api/audio-voices/presets?model=${encodeURIComponent(model)}`);
}

export async function fetchVoicePreview(id: string, locale: "zh-CN" | "en" | "vi") {
    return request<{ cached: boolean; url?: string; text?: string; locale?: string; estimatedPoints?: number | null }>(`/api/voice-profiles/${encodeURIComponent(id)}/preview?locale=${encodeURIComponent(locale)}`);
}

export async function createVoicePreview(id: string, locale: "zh-CN" | "en" | "vi") {
    return request<{ cached: boolean; url?: string; task?: AudioGenerationTask }>(`/api/voice-profiles/${encodeURIComponent(id)}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale, confirmed: true }),
    });
}

export function voiceSelectionKey(selection: VoiceSelection) {
    return selection.type === "preset" ? `preset:${selection.voiceId}` : `profile:${selection.voiceProfileId}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as Envelope<T> | null;
    if (!response.ok || !payload || payload.code !== 0) throw new Error(payload?.msg || "请求失败");
    return payload.data;
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}
