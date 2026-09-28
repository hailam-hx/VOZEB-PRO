import { NextResponse } from "next/server";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { listVideoValidationRuns, startVideoValidationRun, VideoValidationServiceError } from "@/lib/server/video-validation-service";
import { parseStartRequest } from "../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.read") || !hasAdminPermission(user, "upstream.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要生成查看与上游配置权限" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Number(params.get("page") || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") || 20) || 20));
    const data = await listVideoValidationRuns({ page, pageSize });
    return NextResponse.json({ code: 0, data, msg: "OK" });
}

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.manage") || !hasAdminPermission(user, "upstream.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要生成管理与上游配置权限" }, { status: 403 });
    try {
        const data = await startVideoValidationRun(parseStartRequest(await readJsonBody(request)), user.id);
        return NextResponse.json({ code: 0, data, msg: "视频验收任务已创建" });
    } catch (error) {
        const status = error instanceof VideoValidationServiceError ? error.status : 400;
        return NextResponse.json({ code: status, data: null, msg: error instanceof Error ? error.message : "创建验收任务失败" }, { status });
    }
}
