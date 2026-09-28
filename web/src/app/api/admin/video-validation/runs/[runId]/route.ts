import { NextResponse } from "next/server";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getVideoValidationRun } from "@/lib/server/video-validation-service";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.read") || !hasAdminPermission(user, "upstream.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要生成查看与上游配置权限" }, { status: 403 });
    const data = await getVideoValidationRun((await context.params).runId);
    return data ? NextResponse.json({ code: 0, data, msg: "OK" }) : NextResponse.json({ code: 404, data: null, msg: "验收任务不存在" }, { status: 404 });
}
