import { hasAdminPermission } from "@/lib/admin-permissions";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { NextResponse } from "next/server";

import { isBillingInputError } from "@/lib/server/billing-errors";
import { deleteTopUpPreset, saveTopUpPreset } from "@/lib/server/top-up-commerce-service";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
    return mutate(request, context, false);
}
export async function DELETE(request: Request, context: Context) {
    return mutate(request, context, true);
}
async function mutate(request: Request, context: Context, remove: boolean) {
    const user = await getCurrentUser();
    if (!user) return result(401, null, "请先登录");
    if (!hasAdminPermission(user, "billing.manage")) return result(403, null, "需要管理员权限");
    const { id } = await context.params;
    try {
        if (remove) {
            await deleteTopUpPreset(id);
            await safeRecordAuditLog({ action: "admin.top_up_preset.delete", actor: auditActorFromRequest(request, user), target: { type: "top_up_preset", id } });
            return result(0, { id }, "充值预设已删除");
        }
        const preset = await saveTopUpPreset({ ...(await readJsonBody<Record<string, unknown>>(request)), id });
        await safeRecordAuditLog({ action: "admin.top_up_preset.save", actor: auditActorFromRequest(request, user), target: { type: "top_up_preset", id } });
        return result(0, { preset }, "充值预设已保存");
    } catch (error) {
        return isBillingInputError(error) ? result(error.status, null, error.message) : result(500, null, remove ? "删除充值预设失败" : "保存充值预设失败");
    }
}
function result(code: number, data: unknown, msg: string) {
    return NextResponse.json({ code, data, msg }, { status: code || 200 });
}
