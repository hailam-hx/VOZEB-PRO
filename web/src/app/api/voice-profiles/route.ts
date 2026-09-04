import { after } from "next/server";

import { apiError, apiSuccess } from "@/app/api/_shared/api-response";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolvePublicRequestOrigin } from "@/lib/server/public-request-origin";
import { createVoiceProfile, VoiceProfileServiceError } from "@/lib/server/voice-profile-service";
import { getActiveVoiceCloneTaskForProfile, getVoiceCloneTask, getVoiceProfileByClientRequestId, getVoiceProfileForUser, listVoiceProfilesForUser, publicVoiceProfile, type VoiceProfileStatus } from "@/lib/server/voice-profile-store";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return apiError(401, "请先登录");
    const rate = await checkGenerationRateLimit(user.id, request, "audio");
    if (!rate.allowed) return apiError(429, "声音克隆请求过于频繁，请稍后重试", { headers: rateLimitHeaders(rate) });
    try {
        const body = await readJsonBody<{ name?: unknown; sourceAssetToken?: unknown; clientRequestId?: unknown; consentConfirmed?: unknown }>(request);
        const settings = await getAuthSettings();
        const requestId = typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : "";
        const existing = requestId ? await getVoiceProfileByClientRequestId(user.id, requestId) : null;
        const response = await withGenerationConcurrencyLimit(
            user.id,
            "voice-clone",
            10 * 60 * 1_000,
            settings.generationConcurrency.audio,
            async () => {
                const profile = await createVoiceProfile(user.id, body);
                const stored = await getVoiceProfileForUser(user.id, profile.id);
                if (stored) {
                    const publicOrigin = resolvePublicRequestOrigin(request);
                    const origin = resolveInternalOrigin(publicOrigin);
                    after(() => runGenerationTaskRecoveryBatch({ origin, publicOrigin, limit: 1, taskIds: [stored.cloneTaskId] }));
                }
                return apiSuccess({ profile }, "声音克隆任务已创建");
            },
            existing?.cloneTaskId,
        );
        return response || apiError(429, "当前用户声音克隆任务已达到并发上限");
    } catch (error) {
        if (error instanceof VoiceProfileServiceError) return apiError(error.status, error.message);
        return apiError(500, toSafeGenerationErrorMessage(error, "创建声音档案失败"));
    }
}

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return apiError(401, "请先登录");
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status") || undefined;
    if (statusValue && !isVoiceProfileStatus(statusValue)) return apiError(400, "声音状态筛选无效");
    const status = statusValue as VoiceProfileStatus | undefined;
    const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get("pageSize")) || 20)));
    const result = await listVoiceProfilesForUser(user.id, { page, pageSize, status });
    const active = result.items.filter((profile) => profile.status === "pending" || profile.status === "deleting");
    const tasks = await Promise.all(active.map((profile) => (profile.status === "deleting" ? getActiveVoiceCloneTaskForProfile(user.id, profile.id, "delete") : getVoiceCloneTask(profile.cloneTaskId))));
    return apiSuccess({ ...result, items: result.items.map(publicVoiceProfile) }, "", { headers: retryAfterHeaders(tasks.map((task) => task?.nextPollAt)) });
}

function retryAfterHeaders(values: Array<number | undefined>) {
    const next = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0).sort((a, b) => a - b)[0];
    return next ? { "Retry-After": String(Math.max(1, Math.ceil((next - Date.now()) / 1_000))) } : undefined;
}

function isVoiceProfileStatus(value: string): value is VoiceProfileStatus {
    return value === "pending" || value === "ready" || value === "failed" || value === "deleting" || value === "deleted";
}
