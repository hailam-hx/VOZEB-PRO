import { apiError, apiSuccess } from "@/app/api/_shared/api-response";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { deleteVoiceProfile, renameVoiceProfile, VoiceProfileServiceError } from "@/lib/server/voice-profile-service";
import { getVoiceProfileForUser, publicVoiceProfile } from "@/lib/server/voice-profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
    const user = await getCurrentUser(request);
    if (!user) return apiError(401, "请先登录");
    const profile = await getVoiceProfileForUser(user.id, (await context.params).id);
    if (!profile || profile.status === "deleted") return apiError(404, "声音档案不存在");
    return apiSuccess({ profile: publicVoiceProfile(profile) }, "");
}

export async function PATCH(request: Request, context: Context) {
    const user = await getCurrentUser(request);
    if (!user) return apiError(401, "请先登录");
    try {
        const body = await readJsonBody<{ name?: unknown }>(request);
        const profile = await renameVoiceProfile(user.id, (await context.params).id, body.name);
        return apiSuccess({ profile }, "声音名称已更新");
    } catch (error) {
        return serviceError(error, "更新声音档案失败");
    }
}

export async function DELETE(request: Request, context: Context) {
    const user = await getCurrentUser(request);
    if (!user) return apiError(401, "请先登录");
    try {
        const profile = await deleteVoiceProfile(user.id, (await context.params).id);
        return apiSuccess({ profile }, profile.status === "deleted" ? "声音已删除" : "声音删除已提交");
    } catch (error) {
        return serviceError(error, "删除声音档案失败");
    }
}

function serviceError(error: unknown, fallback: string) {
    return error instanceof VoiceProfileServiceError ? apiError(error.status, error.message) : apiError(500, toSafeGenerationErrorMessage(error, fallback));
}
