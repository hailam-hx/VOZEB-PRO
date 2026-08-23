import { hasAdminPermission } from "@/lib/admin-permissions";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { listAdminTopUpOrders } from "@/lib/server/top-up-commerce-service";
import type { TopUpOrder } from "@/lib/server/top-up-payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.read")) return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });

    try {
        const params = request.nextUrl.searchParams;
        const result = await listAdminTopUpOrders({
            page: Number(params.get("page")) || 1,
            pageSize: Number(params.get("pageSize")) || 20,
            status: parseOrderStatus(params.get("status")),
            userId: params.get("userId") || undefined,
            keyword: params.get("keyword") || undefined,
        });
        return NextResponse.json({ code: 0, data: { orders: result.items, total: result.total, page: result.page, pageSize: result.pageSize }, msg: "" });
    } catch (error) {
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin list billing orders failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "获取充值订单失败" }, { status: 500 });
    }
}

function parseOrderStatus(value: string | null): TopUpOrder["status"] | undefined {
    return value === "pending" || value === "paid" || value === "canceled" || value === "refunding" || value === "refunded" ? value : undefined;
}
