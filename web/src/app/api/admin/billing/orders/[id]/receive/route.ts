import { hasAdminPermission } from "@/lib/admin-permissions";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { receiveManualTopUpOrder } from "@/lib/server/top-up-admin-order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务管理权限" }, { status: 403 });

    const { id } = await context.params;
    try {
        const result = await receiveManualTopUpOrder(id, currentUser.id);
        await safeRecordAuditLog({ action: "admin.billing.order.receive", status: "success", actor: auditActorFromRequest(request, currentUser), target: { type: "top_up_order", id }, metadata: result });
        return NextResponse.json({ code: 0, data: result, msg: "收款已确认" });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.billing.order.receive",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order", id },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin receive manual top-up order failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "确认收款失败" }, { status: 500 });
    }
}
