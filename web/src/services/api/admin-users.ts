import type { AdminPermission } from "@/lib/admin-permissions";
import type { PublicUser, PublicUserSummary, UserRole, UserStatus } from "@/lib/auth/store";

type AdminUserPatch = Partial<Pick<PublicUser, "displayName" | "email" | "role" | "adminPermissions" | "status" | "settledBalance">> & { password?: string };
type AdminUserCreate = AdminUserPatch & { username: string; password: string; role?: UserRole; status?: UserStatus; adminPermissions?: AdminPermission[] };

export function listAdminUsers(input: { page?: number; pageSize?: number; keyword?: string; role?: UserRole; status?: UserStatus } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") params.set(key, String(value));
    return requestAdminUsers<{ users: PublicUser[]; total: number; page: number; pageSize: number; summary: PublicUserSummary; currentUser: PublicUser }>(`/api/admin/users?${params.toString()}`);
}

export async function updateAdminUser(userId: string, patch: AdminUserPatch) {
    return (await requestAdminUsers<{ user: PublicUser }>(`/api/admin/users/${encodeURIComponent(userId)}`, jsonRequest("PATCH", patch))).user;
}

export async function createAdminUser(input: AdminUserCreate) {
    return (await requestAdminUsers<{ user: PublicUser }>("/api/admin/users", jsonRequest("POST", input))).user;
}

export function deleteAdminUser(userId: string) {
    return requestAdminUsers<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function requestAdminUsers<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...init });
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: T | null; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0 || payload.data == null) throw new Error(payload?.msg || "用户请求失败");
    return payload.data;
}
