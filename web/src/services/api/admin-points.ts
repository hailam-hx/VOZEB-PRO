"use client";

import type { AdminPointDirection, AdminPointLedgerResult, AdminPointRecordType, AdminPointUserOption } from "@/lib/admin-points-types";

export function listAdminPoints(input: { page?: number; pageSize?: number; userId?: string; type?: AdminPointRecordType | ""; direction?: AdminPointDirection | ""; startAt?: string; endBefore?: string } = {}) {
    return requestAdminPoints<AdminPointLedgerResult>(`/api/admin/points?${query(input)}`);
}

export function searchAdminPointsUsers(keyword = "") {
    return requestAdminPoints<{ users: AdminPointUserOption[]; total: number; page: number; pageSize: number }>(`/api/admin/points/users?${query({ keyword, page: 1, pageSize: 20 })}`);
}

export function adjustAdminPoints(input: { userId: string; operation: "increase" | "decrease"; amount: string; reason: string; requestId: string }) {
    return requestAdminPoints<{ applied: boolean; record: { id: string; amount: string; balanceAfter: string }; snapshot: { settledBalance: string; heldBalance: string; availableBalance: string } }>("/api/admin/points/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

function query(input: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") params.set(key, String(value));
    return params.toString();
}

async function requestAdminPoints<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: T; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0 || payload.data === undefined) throw new Error(payload?.msg || "积分账务请求失败");
    return payload.data;
}
