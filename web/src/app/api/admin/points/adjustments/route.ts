import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthInputError } from "@/lib/auth/store";
import { adjustAdminPointBalance } from "@/lib/server/admin-points-service";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";

export const runtime = "nodejs";

type AdjustmentBody = { userId?: unknown; operation?: unknown; amount?: unknown; reason?: unknown; requestId?: unknown };

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务管理权限" }, { status: 403 });
    let body: AdjustmentBody = {};
    try {
        body = await readJsonBody<AdjustmentBody>(request);
        const input = {
            actorUserId: currentUser.id,
            targetUserId: typeof body.userId === "string" ? body.userId : "",
            operation: body.operation === "decrease" ? ("decrease" as const) : body.operation === "increase" ? ("increase" as const) : (body.operation as never),
            amount: typeof body.amount === "string" ? body.amount : "",
            reason: typeof body.reason === "string" ? body.reason : "",
            requestId: typeof body.requestId === "string" ? body.requestId : "",
        };
        const data = await adjustAdminPointBalance(input);
        await safeRecordAuditLog({
            action: "admin.points.adjust",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "user", id: input.targetUserId },
            metadata: { pointRecordId: data.record.id, operation: input.operation, amount: input.amount, balanceAfter: data.record.balanceAfter, reason: input.reason, applied: data.applied },
        });
        return NextResponse.json({ code: 0, data, msg: "" });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.points.adjust",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "user", id: typeof body.userId === "string" ? body.userId : undefined },
            metadata: { operation: body.operation, amount: body.amount, reason: body.reason, error: error instanceof Error ? error.message : "unknown" },
        });
        if (isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin points adjustment failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "调整积分失败" }, { status: 500 });
    }
}
