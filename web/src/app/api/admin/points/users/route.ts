import { NextResponse } from "next/server";

import { hasAnyAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { searchAdminPointUsers } from "@/lib/server/admin-points-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAnyAdminPermission(currentUser, ["billing.read", "billing.manage"])) return NextResponse.json({ code: 403, data: null, msg: "需要财务查看权限" }, { status: 403 });
    try {
        const params = new URL(request.url).searchParams;
        const data = await searchAdminPointUsers({ keyword: params.get("keyword") || "", page: Number(params.get("page") || 1), pageSize: Number(params.get("pageSize") || 20) });
        return NextResponse.json({ code: 0, data, msg: "" });
    } catch (error) {
        console.error("Admin points users lookup failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "搜索积分用户失败" }, { status: 500 });
    }
}
