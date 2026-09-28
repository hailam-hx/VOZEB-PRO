import { NextResponse } from "next/server";

import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { isAuthorizedWorkerRequest, isWorkerTokenConfigured } from "@/lib/server/maintenance-auth";
import { getInstallStatus } from "@/lib/server/install-status";
import { isGenerationWorkerCompatible, readGenerationWorkerCompatibility } from "@/lib/server/generation-worker-compatibility";
import { processVideoValidationBatch } from "@/lib/server/video-validation-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400;

export async function POST(request: Request) {
    if (!isWorkerTokenConfigured()) return NextResponse.json({ code: 503, data: null, msg: "Worker 令牌未配置或未与维护令牌分离" }, { status: 503 });
    if (!isAuthorizedWorkerRequest(request)) return NextResponse.json({ code: 401, data: null, msg: "Worker 认证失败" }, { status: 401 });
    if (!isGenerationWorkerCompatible(readGenerationWorkerCompatibility(request))) return NextResponse.json({ code: 409, data: null, msg: "Worker 与当前应用版本不兼容" }, { status: 409 });
    try {
        if (!(await getInstallStatus()).database.schemaReady) return NextResponse.json({ code: 0, data: { claimed: 0, processed: 0, skippedBudget: 0 }, msg: "等待初始化数据库" });
        const workerId = request.headers.get("x-vozeb-pro-worker-id")?.trim() || "video-validation-worker";
        const result = await processVideoValidationBatch({ origin: resolveInternalOrigin(new URL(request.url).origin), workerId, limit: 1 });
        return NextResponse.json({ code: 0, data: result, msg: result.claimed ? `已处理 ${result.claimed} 个视频验收任务` : "没有到期的视频验收任务" });
    } catch (error) {
        console.error("Video validation batch failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "视频验收任务处理失败" }, { status: 500 });
    }
}
