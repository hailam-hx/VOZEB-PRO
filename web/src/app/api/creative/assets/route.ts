import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { CREATIVE_UPLOAD_MAX_REQUEST_BYTES } from "@/lib/creative-upload";
import { CreativeRuntimeServiceError, uploadAssetForUser } from "@/lib/server/creative-runtime-service";
import { readRequestFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/server/request-body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("multipart/form-data")) throw new CreativeRuntimeServiceError("上传内容格式不正确", 400);
        let form: FormData;
        try {
            form = await readRequestFormDataWithinLimit(request, CREATIVE_UPLOAD_MAX_REQUEST_BYTES);
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) throw error;
            throw new CreativeRuntimeServiceError("上传内容格式不正确", 400);
        }
        const conversationId = String(form.get("conversationId") || "").trim();
        const file = form.get("file");
        if (!conversationId) throw new CreativeRuntimeServiceError("创作会话不能为空", 400);
        if (!(file instanceof File)) throw new CreativeRuntimeServiceError("请选择上传文件", 400);
        const asset = await uploadAssetForUser(user.id, conversationId, file);
        return NextResponse.json({ code: 0, data: { asset }, msg: "素材已上传" });
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ code: error.status, data: null, msg: "上传请求不能超过 200MB" }, { status: error.status });
        if (error instanceof CreativeRuntimeServiceError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        throw error;
    }
}
