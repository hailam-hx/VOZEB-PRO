import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { createTopUpOrder, listTopUpOrdersForUser } from "@/lib/server/top-up-commerce-service";
import { commerceError, commerceOk } from "../../commerce-response";
import { assertTopUpRequestContract } from "../request-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    try {
        const params = request.nextUrl.searchParams;
        const result = await listTopUpOrdersForUser(currentUser.id, { page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || 20 });
        return commerceOk({ orders: result.items, total: result.total, page: result.page, pageSize: result.pageSize });
    } catch (error) {
        return commerceError(error, "获取充值订单失败", "List top-up orders failed");
    }
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    try {
        const body = assertTopUpRequestContract(await readJsonBody<Record<string, unknown>>(request), "order");
        const order = await createTopUpOrder({ ...body, userId: currentUser.id });
        await safeRecordAuditLog({
            action: "top_up.order.create",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order", id: order.id, label: order.orderNo },
            metadata: { presetId: order.presetId, paymentAmount: order.paymentAmount, currency: order.currency, provider: order.provider, userCouponId: order.userCouponId },
        });
        return commerceOk({ order }, 201);
    } catch (error) {
        await safeRecordAuditLog({
            action: "top_up.order.create",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "top_up_order" },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        return commerceError(error, "创建充值订单失败", "Create top-up order failed");
    }
}
