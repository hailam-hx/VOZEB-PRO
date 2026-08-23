import { hasAdminPermission } from "@/lib/admin-permissions";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { NextResponse } from "next/server";

import { isBillingInputError } from "@/lib/server/billing-errors";
import { listTopUpPresets, saveTopUpPreset } from "@/lib/server/top-up-commerce-service";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return response(401, null, "请先登录");
    if (!hasAdminPermission(user, "billing.read")) return response(403, null, "需要管理员权限");
    try {
        return response(0, { presets: await listTopUpPresets(true) }, "");
    } catch (error) {
        return commerceError(error, "获取充值预设失败");
    }
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return response(401, null, "请先登录");
    if (!hasAdminPermission(user, "billing.manage")) return response(403, null, "需要管理员权限");
    try {
        const preset = await saveTopUpPreset(await readJsonBody(request));
        await safeRecordAuditLog({ action: "admin.top_up_preset.save", actor: auditActorFromRequest(request, user), target: { type: "top_up_preset", id: preset.id } });
        return response(0, { preset }, "充值预设已保存");
    } catch (error) {
        return commerceError(error, "保存充值预设失败");
    }
}

function commerceError(error: unknown, fallback: string) {
    return isBillingInputError(error) ? response(error.status, null, error.message) : response(500, null, fallback);
}
function response(code: number, data: unknown, msg: string) {
    return NextResponse.json({ code, data, msg }, { status: code || 200 });
}
