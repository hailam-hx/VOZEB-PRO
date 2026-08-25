import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { getBillingReconciliationRun, importBillingStatement, listBillingReconciliationRuns } from "@/lib/server/payment-reconciliation-service";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { commerceError, commerceOk } from "@/app/api/billing/commerce-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.read")) return NextResponse.json({ code: 403, data: null, msg: "当前管理员没有查看对账数据的职责权限" }, { status: 403 });

    try {
        const params = request.nextUrl.searchParams;
        const runId = params.get("runId");
        if (runId) {
            const reconciliation = await getBillingReconciliationRun(runId);
            if (!reconciliation) return NextResponse.json({ code: 404, data: null, msg: "对账批次不存在" }, { status: 404 });
            return commerceOk({ reconciliation });
        }
        const result = await listBillingReconciliationRuns({
            page: params.get("page") || undefined,
            pageSize: params.get("pageSize") || undefined,
            provider: params.get("provider") || undefined,
        });
        return commerceOk({ runs: result.items, total: result.total, page: result.page, pageSize: result.pageSize });
    } catch (error) {
        console.error("Admin billing reconciliation list failed", error);
        return commerceError(error, "获取支付对账记录失败", "List top-up reconciliations failed");
    }
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "billing.manage")) return NextResponse.json({ code: 403, data: null, msg: "当前管理员没有导入对账数据的职责权限" }, { status: 403 });

    try {
        const body = await readJsonBody<{ provider?: unknown; csvText?: unknown; fileName?: unknown; note?: unknown }>(request);
        const result = await importBillingStatement(body, { userId: currentUser.id, username: currentUser.username });
        await safeRecordAuditLog({
            action: "admin.billing.reconciliation.import",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "billing_reconciliation", id: result.runId || result.provider },
            metadata: {
                runId: result.runId,
                provider: result.provider,
                totalRows: result.totalRows,
                matchedRows: result.matchedRows,
                issueRows: result.issueRows,
                statementPaidAmount: result.totals.statementPaidAmount,
                statementRefundedAmount: result.totals.statementRefundedAmount,
            },
        });
        return commerceOk({ reconciliation: result });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.billing.reconciliation.import",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "billing_reconciliation" },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        console.error("Admin billing reconciliation failed", error);
        return commerceError(error, "支付账单对账失败", "Import top-up reconciliation failed");
    }
}
