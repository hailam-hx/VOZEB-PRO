import { NextResponse } from "next/server";

import { commerceError, commerceOk } from "@/app/api/billing/commerce-response";
import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { syncTopUpOrderForUser } from "@/lib/server/top-up-payment-sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const { id } = await context.params;
    try {
        const result = await syncTopUpOrderForUser(currentUser.id, id);
        await safeRecordAuditLog({
            action: "top_up.order.sync",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order", id: result.order.id, label: result.order.orderNo },
            metadata: { provider: result.order.provider, outcome: result.syncStatus },
        });
        return commerceOk(result);
    } catch (error) {
        await safeRecordAuditLog({
            action: "top_up.order.sync",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order", id },
            metadata: { provider: "zalopay", outcome: "failure", status: isBillingInputError(error) ? error.status : 500 },
        });
        return commerceError(error, "同步充值订单失败", "Sync top-up order failed");
    }
}
