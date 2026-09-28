import { NextResponse } from "next/server";

import { hasAdminPermission } from "@/lib/admin-permissions";
import { isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { applySuggestedSalePrices, getAdminModelPricing, saveAdminModelPricing, type AdminModelPricingCommandInput, type ApplySuggestedSalePricesInput } from "@/lib/server/admin-model-pricing-service";
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
        const data = await saveAdminModelPricing(await readJsonBody<AdminModelPricingCommandInput>(request));
        await safeRecordAuditLog({
            action: data.audit?.action || "admin.billing.model_pricing.update",
            actor: auditActorFromRequest(request, user),
            target: { type: "logical_model", id: data.model.id },
            metadata: data.audit?.metadata || { bindings: data.model.bindings.map((binding) => binding.id) },
        });
        return NextResponse.json({ code: 0, data, msg: "模型计价已保存" });
    } catch (error) {
        if (isBillingInputError(error) || isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin model pricing update failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "保存模型计价失败" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(user, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "需要财务管理权限" }, { status: 403 });
    try {
        const actor = auditActorFromRequest(request, user);
        const data = await applySuggestedSalePrices(await readJsonBody<ApplySuggestedSalePricesInput>(request), { id: user.id, username: user.username, role: user.role, ip: actor.ip, userAgent: actor.userAgent });
        return NextResponse.json({ code: 0, data, msg: `建议售价已应用：${data.applied.length} 个，跳过：${data.skipped.length} 个` });
    } catch (error) {
        if (isBillingInputError(error) || isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Suggested sale price approval failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "应用建议售价失败" }, { status: 500 });
    }
}
