import { hasAdminPermission } from "@/lib/admin-permissions";
import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthInputError } from "@/lib/auth/store";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { refundTopUpOrder } from "@/lib/server/top-up-refund-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });

    const { id } = await context.params;
    try {
        const body = await readJsonBody<{ reason?: unknown; kind?: unknown }>(request);
        const kind = body.kind === "partial" || body.kind === "chargeback" ? body.kind : "full";
        const result = await refundTopUpOrder(id, { kind, reason: body.reason, operatorUserId: currentUser.id });
        await safeRecordAuditLog({
            action: "admin.billing.order.refund",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order", id },
            metadata: {
                kind,
                reason: body.reason,
                result,
            },
        });
        return NextResponse.json({ code: 0, data: result, msg: result.manualReview ? "已转人工复核" : "退款请求已处理" });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.billing.order.refund",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order", id },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isAuthInputError(error) || isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin refund billing order failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "退款标记失败" }, { status: 500 });
    }
}
