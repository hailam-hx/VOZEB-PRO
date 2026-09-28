import { NextResponse } from "next/server";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { previewVideoValidation, VideoValidationServiceError } from "@/lib/server/video-validation-service";
import { parsePreviewRequest } from "../request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "generation.read") || !hasAdminPermission(user, "upstream.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要生成查看与上游配置权限" }, { status: 403 });
    try {
        const data = await previewVideoValidation(parsePreviewRequest(await readJsonBody(request)));
        return NextResponse.json({ code: 0, data, msg: "视频验收预览已生成" });
    } catch (error) {
        const status = error instanceof VideoValidationServiceError ? error.status : 400;
        return NextResponse.json({ code: status, data: null, msg: error instanceof Error ? error.message : "验收预览失败" }, { status });
    }
}
