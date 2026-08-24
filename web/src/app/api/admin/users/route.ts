import { NextResponse } from "next/server";

import { createUserByAdmin, isAuthInputError, listPublicUsersPage, type UserRole, type UserStatus } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { hasAdminPermission, hasAnyAdminPermission, normalizeAdminPermissions } from "@/lib/admin-permissions";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAdminPermission(currentUser, "users.read")) return NextResponse.json({ code: 403, data: null, msg: "当前管理员没有查看用户的职责权限" }, { status: 403 });

    try {
        const params = new URL(request.url).searchParams;
        const role = params.get("role");
        const status = params.get("status");
        const result = await listPublicUsersPage({
            page: Number(params.get("page") || 1),
            pageSize: Number(params.get("pageSize") || 20),
            keyword: params.get("keyword") || "",
            role: role === "admin" || role === "user" ? role : undefined,
            status: status === "active" || status === "disabled" ? status : undefined,
        });
        return NextResponse.json({ code: 0, data: { ...result, currentUser: serializeCurrentUser(currentUser) }, msg: "" });
    } catch (error) {
        console.error("Admin users read failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "加载用户失败" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    if (!hasAnyAdminPermission(currentUser, ["users.manage", "administrators.manage"])) return NextResponse.json({ code: 403, data: null, msg: "当前管理员没有创建用户的职责权限" }, { status: 403 });

    let body: { username?: unknown; displayName?: unknown; email?: unknown; password?: unknown; role?: unknown; adminPermissions?: unknown; status?: unknown } = {};
    try {
        body = await readJsonBody<typeof body>(request);
        const role = body.role === "admin" ? "admin" : "user";
        const status = body.status === "disabled" ? "disabled" : "active";
        const user = await createUserByAdmin({
            actorId: currentUser.id,
            username: typeof body.username === "string" ? body.username : "",
            displayName: typeof body.displayName === "string" ? body.displayName : "",
            email: typeof body.email === "string" ? body.email : "",
            password: typeof body.password === "string" ? body.password : "",
            role: role as UserRole,
            adminPermissions: normalizeAdminPermissions(body.adminPermissions),
            status: status as UserStatus,
        });
        await safeRecordAuditLog({
            action: "admin.user.create",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "user", id: user.id, label: user.username },
            metadata: { role: user.role, adminPermissions: user.adminPermissions, status: user.status, settledBalance: user.settledBalance },
        });
        return NextResponse.json({ code: 0, data: { user: serializeCurrentUser(user) }, msg: "" });
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.user.create",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "user", label: typeof body.username === "string" ? body.username : "" },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Admin user create failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "新增用户失败" }, { status: 500 });
    }
}
