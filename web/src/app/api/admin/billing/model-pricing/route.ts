import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAdminModelPricing, saveAdminModelPricing, type AdminModelPricingInput } from "@/lib/server/admin-model-pricing-service";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError } from "@/lib/server/billing-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务管理权限" }, { status: 403 });
    try {
        return NextResponse.json({ code: 0, data: await getAdminModelPricing(), msg: "" });
    } catch (error) {
        console.error("Admin model pricing read failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "获取模型计价失败" }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务管理权限" }, { status: 403 });
    try {
        const data = await saveAdminModelPricing(await readJsonBody<AdminModelPricingInput>(request));
        await safeRecordAuditLog({
            action: "admin.billing.model_pricing.update",
            actor: auditActorFromRequest(request, user),
            target: { type: "logical_model", id: data.model.id },
            metadata: { bindings: data.model.bindings.map((binding) => binding.id) },
        });
        return NextResponse.json({ code: 0, data, msg: "模型计价已保存" });
    } catch (error) {
        if (isBillingInputError(error) || isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin model pricing update failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "保存模型计价失败" }, { status: 500 });
    }
}
