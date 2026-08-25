import { hasAdminPermission } from "@/lib/admin-permissions";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { isBillingInputError } from "@/lib/server/billing-errors";
import { getTopUpFinancialSummary } from "@/lib/server/top-up-reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.read")) return NextResponse.json({ code: 403, data: null, msg: "需要管理员权限" }, { status: 403 });

    try {
        const params = request.nextUrl.searchParams;
        return NextResponse.json({
            code: 0,
            data: {
                summary: await getTopUpFinancialSummary({
                    startDate: params.get("startDate") || undefined,
                    endDate: params.get("endDate") || undefined,
                }),
            },
            msg: "",
        });
    } catch (error) {
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin billing summary failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "获取充值财务摘要失败" }, { status: 500 });
    }
}
