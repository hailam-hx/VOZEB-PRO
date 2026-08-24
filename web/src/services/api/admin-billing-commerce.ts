import type { AdminBillingSummary, AdminRecoveryItem, AdminTopUpConfig, AdminUsageAuditItem } from "@/lib/admin-billing-types";
import type { TopUpOrder, TopUpOrderStatus, TopUpPreset } from "./billing";

type PageResult<T, K extends string> = Record<K, T[]> & { total: number; page: number; pageSize: number };
export type AdminTopUpOrder = TopUpOrder & { user?: { accountId?: string; username?: string; displayName?: string; avatarUrl?: string } };
export type AdminTopUpRefundResult = {
    orderId: string;
    applied?: boolean;
    duplicate?: boolean;
    failed?: boolean;
    manualReview?: boolean;
    recoveredCreditAmount?: string;
    recoveryState?: "recovered" | "released";
    reason?: string;
    providerRefund?: { status: "succeeded" | "failed" | "manual"; providerRefundId?: string };
};

export function listAdminTopUpOrders(input: { page?: number; pageSize?: number; status?: TopUpOrderStatus | ""; keyword?: string } = {}) {
    return requestCommerce<PageResult<AdminTopUpOrder, "orders">>(`/api/admin/billing/orders?${query(input)}`);
}

export function refundAdminTopUpOrder(id: string, reason: string) {
    return requestCommerce<AdminTopUpRefundResult>(`/api/admin/billing/orders/${encodeURIComponent(id)}/refund`, jsonRequest("POST", { reason }));
}

export function getAdminTopUpSummary(input: { startDate?: string; endDate?: string } = {}) {
    return requestCommerce<{ summary: AdminBillingSummary }>(`/api/admin/billing/summary?${query(input)}`);
}

export function listAdminTopUpPresets() {
    return requestCommerce<{ presets: TopUpPreset[] }>("/api/admin/billing/top-up-presets");
}

export function saveAdminTopUpPreset(input: Partial<TopUpPreset>) {
    return requestCommerce<{ preset: TopUpPreset }>(input.id ? `/api/admin/billing/top-up-presets/${encodeURIComponent(input.id)}` : "/api/admin/billing/top-up-presets", jsonRequest(input.id ? "PATCH" : "POST", input));
}

export function deleteAdminTopUpPreset(id: string) {
    return requestCommerce<{ id: string }>(`/api/admin/billing/top-up-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getAdminTopUpConfig() {
    return requestCommerce<{ config: AdminTopUpConfig | null }>("/api/admin/billing/top-up-config");
}

export function saveAdminTopUpConfig(input: AdminTopUpConfig) {
    return requestCommerce<{ config: AdminTopUpConfig }>("/api/admin/billing/top-up-config", jsonRequest("PATCH", input));
}

export function getAdminUsageAudit(input: { page?: number; pageSize?: number } = {}) {
    return requestCommerce<{ items: AdminUsageAuditItem[]; recovery: AdminRecoveryItem[]; total: number; page: number; pageSize: number; zeroUsage: number; negativeMargin: number }>(`/api/admin/billing/usage?${query(input)}`);
}

export function recoverAdminUsageHolds() {
    return requestCommerce<{ inspected: number; retained: number; settled: number; released: number; needsReview: number }>("/api/admin/billing/usage/recovery", { method: "POST" });
}

function query(input: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") params.set(key, String(value));
    return params.toString();
}

function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function requestCommerce<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...init });
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: T; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0 || payload.data === undefined) throw new Error(payload?.msg || "请求失败");
    return payload.data;
}
