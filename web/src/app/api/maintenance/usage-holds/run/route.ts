import { NextResponse } from "next/server";

import { getAuthSettings } from "@/lib/auth/store";
import { isAuthorizedWorkerRequest, isWorkerTokenConfigured } from "@/lib/server/maintenance-auth";
import { inspectPersistedUsageHold, recoverOrphanUsageHolds } from "@/lib/server/usage-billing-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (!isWorkerTokenConfigured()) return NextResponse.json({ code: 503, data: null, msg: "Worker 令牌未配置或未与维护令牌分离" }, { status: 503 });
    if (!isAuthorizedWorkerRequest(request)) return NextResponse.json({ code: 401, data: null, msg: "Worker 认证失败" }, { status: 401 });
    try {
        const settings = await getAuthSettings();
        const result = await recoverOrphanUsageHolds({ limit: settings.dataLifecycle.maintenanceBatchSize, inspect: inspectPersistedUsageHold });
        return NextResponse.json({ code: 0, data: result, msg: result.inspected ? `已检查 ${result.inspected} 个用量预留` : "没有待检查的用量预留" });
    } catch (error) {
        console.error("Usage hold recovery failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "用量预留恢复失败" }, { status: 500 });
    }
}
