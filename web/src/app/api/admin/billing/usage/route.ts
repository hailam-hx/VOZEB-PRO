import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getAdminUsageAudit } from "@/lib/server/admin-usage-audit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.read")) return NextResponse.json({ code: 403, data: null, msg: "需要财务查看权限" }, { status: 403 });
    try {
        const params = request.nextUrl.searchParams;
        return NextResponse.json({
            code: 0,
            data: await getAdminUsageAudit({
                page: Number(params.get("page")) || 1,
                pageSize: Number(params.get("pageSize")) || 20,
                recoveryPage: Number(params.get("recoveryPage")) || 1,
                recoveryPageSize: Number(params.get("recoveryPageSize")) || 20,
            }),
            msg: "",
        });
    } catch (error) {
        console.error("Admin usage audit failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "获取用量审计失败" }, { status: 500 });
    }
}
