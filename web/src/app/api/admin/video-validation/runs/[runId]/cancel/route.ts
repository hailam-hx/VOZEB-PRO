import { NextResponse } from "next/server";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { cancelVideoValidationRun } from "@/lib/server/video-validation-service";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.manage") || !hasAdminPermission(user, "upstream.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要生成管理与上游配置权限" }, { status: 403 });
    const data = await cancelVideoValidationRun((await context.params).runId, user.id);
    return NextResponse.json({ code: 0, data, msg: "已请求取消视频验收" });
}
