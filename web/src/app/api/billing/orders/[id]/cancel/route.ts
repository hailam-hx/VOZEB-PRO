import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { cancelTopUpOrderForUser } from "@/lib/server/top-up-commerce-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const { id } = await params;
        const order = await cancelTopUpOrderForUser(user.id, id);
        await safeRecordAuditLog({
            action: "billing.order.cancel",
            actor: auditActorFromRequest(request, user),
            target: { type: "billing_order", id: order.id, label: order.orderNo },
        });
        return NextResponse.json({ code: 0, data: { order }, msg: "订单已取消" });
    } catch (error) {
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Cancel billing order failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "取消订单失败" }, { status: 500 });
    }
}
