import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { probeAdminDflopModelCapability, type AdminDflopCapabilityProbeInput } from "@/lib/server/admin-model-pricing-service";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError } from "@/lib/server/billing-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.manage") || !hasAdminPermission(user, "upstream.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务与上游配置权限" }, { status: 403 });
    try {
        const input = await readJsonBody<AdminDflopCapabilityProbeInput>(request);
        const data = await probeAdminDflopModelCapability(input);
        await safeRecordAuditLog({
            action: "admin.billing.provider_capability.probe",
            actor: auditActorFromRequest(request, user),
            target: { type: "logical_model", id: input.modelId },
            metadata: {
                modelId: input.modelId,
                bindingId: input.bindingId,
                operationScope: data.probe.operationScope,
                outcome: data.probe.outcome,
                statusCode: data.probe.statusCode,
                upstreamErrorCode: data.probe.upstreamErrorCode,
                requestId: data.probe.requestId,
                probedAt: data.probe.probedAt,
            },
        });
        return NextResponse.json({ code: 0, data, msg: "DFLOP 能力验证完成" });
    } catch (error) {
        if (isBillingInputError(error) || isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("DFLOP capability probe failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "DFLOP 能力验证失败" }, { status: 500 });
    }
}
