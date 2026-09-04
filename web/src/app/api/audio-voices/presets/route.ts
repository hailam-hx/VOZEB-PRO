import { apiError, apiSuccess } from "@/app/api/_shared/api-response";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { listAudioPresetVoices } from "@/lib/server/audio-voice-service";
import { toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return apiError(401, "请先登录");
    const settings = await getAuthSettings();
    const url = new URL(request.url);
    const model = url.searchParams.get("model")?.trim() || settings.defaultModels.audioModel;
    const candidates = resolveLogicalModelCandidates(settings, "audio", model)
        .map(toSystemGenerationChannel)
        .filter((candidate) => candidate.apiFormat !== "gemini" && (candidate.generationParameters?.audioOperation || "speech") === "speech");
    if (!candidates.length) return apiError(400, "当前模型没有可用的语音合成配置");
    const voices = await listAudioPresetVoices({ candidates, origin: resolveInternalOrigin(url.origin), cookie: request.headers.get("cookie") || "", userId: user.id });
    return apiSuccess({ voices }, "");
}
