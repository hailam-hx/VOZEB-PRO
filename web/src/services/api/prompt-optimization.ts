"use client";

import type { CreativeGenerationMode } from "@/lib/creative-runtime-contract";
import { refreshUserPointsIfSystem } from "@/services/api/points";
import { throwIfClientSessionExpired } from "@/services/api/session-expiration";
import { CreativeApiError } from "@/services/api/creative";

export async function optimizePrompt(input: { requestId: string; prompt: string; mode: "agent" | CreativeGenerationMode }) {
    try {
        const response = await fetch("/api/agent/prompt-optimization", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        throwIfClientSessionExpired(response);
        const payload = (await response.json().catch(() => null)) as { data?: { prompt?: string; publicMessage?: string; errorCode?: string }; msg?: string } | null;
        const prompt = payload?.data?.prompt?.trim();
        if (!response.ok || !prompt) throw new CreativeApiError(payload?.msg || "提示词优化失败", response.status, payload?.data?.errorCode, undefined, payload?.data?.publicMessage);
        return prompt;
    } finally {
        void refreshUserPointsIfSystem("system");
    }
}
