import { hasAdminPermission } from "@/lib/admin-permissions";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { NextResponse } from "next/server";

import { isBillingInputError } from "@/lib/server/billing-errors";
import { getPaymentRuntimeConfig, saveTopUpPricingConfig } from "@/lib/server/payment-config-store";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return result(401, null, "请先登录");
    if (!hasAdminPermission(user, "billing.read")) return result(403, null, "需要管理员权限");
    return result(0, { config: (await getPaymentRuntimeConfig()).topUp || null }, "");
}
export async function PATCH(request: Request) {
    const user = await getCurrentUser();
    if (!user) return result(401, null, "请先登录");
    if (!hasAdminPermission(user, "billing.manage")) return result(403, null, "需要管理员权限");
    try {
        const config = (await saveTopUpPricingConfig(await readJsonBody(request))).topUp;
        await safeRecordAuditLog({
            action: "admin.top_up_pricing.save",
            actor: auditActorFromRequest(request, user),
            target: { type: "top_up_pricing", id: config?.pricingVersion || "current" },
            metadata: { customerFxVersion: config?.customerFxVersion },
        });
        return result(0, { config }, "充值计价配置已保存");
    } catch (error) {
        return isBillingInputError(error) ? result(error.status, null, error.message) : result(500, null, "保存充值计价配置失败");
    }
}
function result(code: number, data: unknown, msg: string) {
    return NextResponse.json({ code, data, msg }, { status: code || 200 });
}
