import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { inspectPersistedUsageHold, recoverOrphanUsageHolds } from "@/lib/server/usage-billing-runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务管理权限" }, { status: 403 });
    try {
        const settings = await getAuthSettings();
        const result = await recoverOrphanUsageHolds({ limit: settings.dataLifecycle.maintenanceBatchSize, inspect: inspectPersistedUsageHold });
        await safeRecordAuditLog({ action: "admin.usage_hold.recover", actor: auditActorFromRequest(request, user), target: { type: "usage_holds" }, metadata: result });
        return NextResponse.json({ code: 0, data: result, msg: result.inspected ? `已检查 ${result.inspected} 个用量预留` : "没有待检查的用量预留" });
    } catch (error) {
        console.error("Admin usage recovery failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "用量预留恢复失败" }, { status: 500 });
    }
}
