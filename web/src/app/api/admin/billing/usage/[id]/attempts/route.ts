import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getAdminUsageAttempts } from "@/lib/server/admin-usage-audit-service";
import { isBillingInputError } from "@/lib/server/billing-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.read")) return NextResponse.json({ code: 403, data: null, msg: "需要财务查看权限" }, { status: 403 });
    try {
        const { id } = await context.params;
        const params = request.nextUrl.searchParams;
        const data = await getAdminUsageAttempts(id, { page: Number(params.get("page")) || 1, pageSize: Number(params.get("pageSize")) || 20 });
        return NextResponse.json({ code: 0, data, msg: "" });
    } catch (error) {
        if (isBillingInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin usage provider attempts failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "获取供应商尝试失败" }, { status: 500 });
    }
}
