import { NextResponse } from "next/server";

import { hasAnyAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthInputError } from "@/lib/auth/store";
import { listAdminPointLedger } from "@/lib/server/admin-points-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAnyAdminPermission(currentUser, ["billing.read", "billing.manage"])) return NextResponse.json({ code: 403, data: null, msg: "需要财务查看权限" }, { status: 403 });
    try {
        const params = new URL(request.url).searchParams;
        const type = params.get("type");
        const direction = params.get("direction");
        const data = await listAdminPointLedger({
            page: Number(params.get("page") || 1),
            pageSize: Number(params.get("pageSize") || 20),
            userId: params.get("userId") || undefined,
            type: type === "consume" || type === "refund" || type === "credit" || type === "admin-adjust" ? type : undefined,
            direction: direction === "credit" || direction === "debit" ? direction : undefined,
            startAt: params.get("startAt") || undefined,
            endBefore: params.get("endBefore") || undefined,
        });
        return NextResponse.json({ code: 0, data, msg: "" });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin points ledger failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "加载积分流水失败" }, { status: 500 });
    }
}
